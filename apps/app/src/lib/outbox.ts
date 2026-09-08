import { getItem, setItem } from './storage';

// Offline command outbox (spike — de-risks the asset offline model).
//
// Writes are queued as commands carrying a stable, client-generated idempotency
// key and replayed FIFO on reconnect. Because the asset domain is append-oriented
// and the server dedupes on the key (asset_faults.idempotency_key), replay is
// EXACTLY-ONCE: a command that was sent but whose ack was lost re-sends the SAME
// key, and the server returns the existing record instead of creating a duplicate.
// So the client never has to reason about "did that write land?" — it just retries.
//
// Storage: localStorage on web (durable). Native durability needs expo-sqlite — a
// production step; the queue logic here is storage-agnostic. The flush algorithm is
// mirrored in scripts/outbox.check.mjs (kept in sync by hand — this file imports
// React Native via ./storage, so it can't run under node).

export type OutboxCommand = { key: string; kind: string; payload: unknown; created_at: number };

// Each domain gets its own store key so asset and compliance flushes never cross-contaminate.
const storeKey = (ns: string) => `blnk_outbox_${ns}_v1`;

function read(ns: string): OutboxCommand[] {
  try { const raw = getItem(storeKey(ns)); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function write(ns: string, cmds: OutboxCommand[]): void { setItem(storeKey(ns), JSON.stringify(cmds)); }

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Queue a command into `ns` namespace. Its key is generated once and stays fixed across replays.
export function enqueue(ns: string, kind: string, payload: unknown): OutboxCommand {
  const cmd: OutboxCommand = { key: uuid(), kind, payload, created_at: Date.now() };
  write(ns, [...read(ns), cmd]);
  return cmd;
}

export function pendingCount(ns: string): number { return read(ns).length; }
export function pending(ns: string): OutboxCommand[] { return read(ns); }

// Replay pending commands FIFO via `send`. Stops at the first failure (preserving
// order for the append-only domain) and keeps the rest for the next flush. A
// successful send removes the command. Safe to call repeatedly.
export async function flush(ns: string, send: (c: OutboxCommand) => Promise<void>): Promise<{ sent: number; remaining: number }> {
  let cmds = read(ns);
  let sent = 0;
  while (cmds.length) {
    try { await send(cmds[0]); }
    catch { break; }
    cmds = cmds.slice(1);
    write(ns, cmds);
    sent++;
  }
  return { sent, remaining: cmds.length };
}
