import assert from 'node:assert/strict';

// Self-check for the outbox flush algorithm in ../src/lib/outbox.ts. That file
// imports React Native via ./storage, so it can't run under node — the flush core
// is mirrored here by hand (kept in sync). Run: node scripts/outbox.check.mjs
//
// Proves the offline model's correctness property: a LogFault captured offline
// replays EXACTLY ONCE even when an ack is lost, because the key is stable and the
// server dedupes on it.

// ── mirrored flush core (matches outbox.ts) ─────────────────────────────────
function makeQueue(initial = []) {
  let cmds = [...initial];
  return {
    enqueue: (key, payload) => cmds.push({ key, payload }),
    pending: () => cmds.length,
    async flush(send) {
      let sent = 0;
      while (cmds.length) {
        try { await send(cmds[0]); } catch { break; }
        cmds = cmds.slice(1); sent++;
      }
      return { sent, remaining: cmds.length };
    },
  };
}

// A deduping "server": applies a command once per idempotency key.
function makeServer() {
  const applied = new Map();
  return {
    applied,
    apply: (key, payload) => { if (!applied.has(key)) applied.set(key, payload); },
    count: () => applied.size,
  };
}

// 1. Offline — transport always throws: nothing sent, nothing lost.
{
  const qm = makeQueue();
  qm.enqueue('a', 1); qm.enqueue('b', 2);
  const r = await qm.flush(async () => { throw new Error('offline'); });
  assert.deepEqual(r, { sent: 0, remaining: 2 }, 'offline: captured, nothing sent');
  assert.equal(qm.pending(), 2);
}

// 2. Reconnect — all succeed, FIFO, queue drains.
{
  const qm = makeQueue(); const srv = makeServer();
  qm.enqueue('a', 1); qm.enqueue('b', 2); qm.enqueue('c', 3);
  const order = [];
  const r = await qm.flush(async (c) => { order.push(c.key); srv.apply(c.key, c.payload); });
  assert.deepEqual(r, { sent: 3, remaining: 0 }, 'reconnect: all sent');
  assert.deepEqual(order, ['a', 'b', 'c'], 'FIFO order preserved');
  assert.equal(srv.count(), 3);
}

// 3. Stop-on-failure — fails at the 2nd, keeps the rest in order.
{
  const qm = makeQueue();
  qm.enqueue('a', 1); qm.enqueue('b', 2); qm.enqueue('c', 3);
  const r = await qm.flush(async (c) => { if (c.key === 'b') throw new Error('down'); });
  assert.deepEqual(r, { sent: 1, remaining: 2 }, 'sent only up to the failure');
  // b and c remain, in order — a retry re-sends b first.
  const seen = [];
  await qm.flush(async (c) => { seen.push(c.key); });
  assert.deepEqual(seen, ['b', 'c'], 'remaining replay in original order');
}

// 4. THE MONEY CASE — lost ack: server applies but the client sees a failure, so
//    the command stays queued and replays with the SAME key. Server dedupes →
//    exactly one effect despite two sends.
{
  const qm = makeQueue(); const srv = makeServer();
  qm.enqueue('x', 42);
  let sends = 0;
  // First flush: server applies, then the ack is "lost" (throw after apply).
  const r1 = await qm.flush(async (c) => { sends++; srv.apply(c.key, c.payload); throw new Error('ack lost'); });
  assert.deepEqual(r1, { sent: 0, remaining: 1 }, 'client thinks it failed');
  assert.equal(srv.count(), 1, 'but the server already applied it');
  // Second flush: succeeds. Same key replays; server dedupes.
  const r2 = await qm.flush(async (c) => { sends++; srv.apply(c.key, c.payload); });
  assert.deepEqual(r2, { sent: 1, remaining: 0 }, 'retry drains the queue');
  assert.equal(sends, 2, 'command was sent twice');
  assert.equal(srv.count(), 1, 'EXACTLY ONCE — deduped on the stable key');
}

console.log('outbox.check OK — offline capture, FIFO, stop-on-failure, exactly-once replay');
