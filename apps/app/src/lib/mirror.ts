import { getItem, setItem } from './storage';

// Offline read mirror — a read-through cache over the durable KV (expo-sqlite on
// native, localStorage on web). Online reads are cached; when a read fails
// (offline) the last-known value is served instead, so a user out of coverage
// can still open an asset and see its fleet and faults. Keys are caller-supplied
// (e.g. 'asset:faults:<assetId>'); values are whole response payloads (JSON).
//
// The read-through logic is mirrored in scripts/mirror.check.mjs (kept in sync by
// hand — this file imports ./storage → React Native → can't run under node).

export type CacheEntry<T> = { at: number; value: T };
const k = (key: string) => 'mirror:' + key;

export function writeCache<T>(key: string, value: T): void {
  try { setItem(k(key), JSON.stringify({ at: Date.now(), value })); } catch { /* ignore */ }
}
export function readCache<T>(key: string): CacheEntry<T> | null {
  try { const raw = getItem(k(key)); return raw ? (JSON.parse(raw) as CacheEntry<T>) : null; } catch { return null; }
}

// Try the network; cache on success. On failure serve the cached value marked
// `stale`. Throws only when the fetch fails AND nothing is cached (genuinely
// nothing to show). `at` is the timestamp the served value was fetched.
export async function readThrough<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ value: T; stale: boolean; at: number }> {
  try {
    const value = await fetcher();
    writeCache(key, value);
    return { value, stale: false, at: Date.now() };
  } catch (e) {
    const c = readCache<T>(key);
    if (c) return { value: c.value, stale: true, at: c.at };
    throw e;
  }
}
