import assert from 'node:assert/strict';

// Self-check for the read-through cache in ../src/lib/mirror.ts. That file imports
// React Native via ./storage, so it can't run under node — the read-through core
// is mirrored here by hand (kept in sync). Run: node scripts/mirror.check.mjs
//
// Proves the offline read behaviour: online → fresh + cached; offline with a cache
// → last-known value served (stale); offline with no cache → throws.

function makeMirror() {
  const kv = new Map();
  const writeCache = (key, value) => kv.set(key, { at: Date.now(), value });
  const readCache = (key) => kv.get(key) ?? null;
  async function readThrough(key, fetcher) {
    try {
      const value = await fetcher();
      writeCache(key, value);
      return { value, stale: false, at: Date.now() };
    } catch {
      const c = readCache(key);
      if (c) return { value: c.value, stale: true, at: c.at };
      throw new Error('offline and no cache');
    }
  }
  return { readThrough, kv };
}

// 1. Online — returns fresh and populates the cache.
{
  const m = makeMirror();
  const r = await m.readThrough('vessel:assets', async () => ({ assets: [1, 2] }));
  assert.deepEqual(r.value, { assets: [1, 2] });
  assert.equal(r.stale, false, 'fresh when online');
  assert.ok(m.kv.has('vessel:assets'), 'cached for offline use');
}

// 2. Offline WITH a cache — serves the last-known value, marked stale.
{
  const m = makeMirror();
  await m.readThrough('vessel:faults:a', async () => ({ faults: ['f1'] })); // prime cache online
  const r = await m.readThrough('vessel:faults:a', async () => { throw new Error('offline'); });
  assert.deepEqual(r.value, { faults: ['f1'] }, 'serves last-known faults');
  assert.equal(r.stale, true, 'marked stale when offline');
}

// 3. Offline with NO cache — nothing to show, so it throws.
{
  const m = makeMirror();
  await assert.rejects(
    () => m.readThrough('vessel:new', async () => { throw new Error('offline'); }),
    /offline and no cache/,
  );
}

console.log('mirror.check OK — online caches, offline serves stale, cold offline throws');
