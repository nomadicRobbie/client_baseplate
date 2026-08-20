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
const STORE_KEY = 'blnk_outbox_v1';

function read(): OutboxCommand[] {
  try { const raw = getItem(STORE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function write(cmds: OutboxCommand[]): void { setItem(STORE_KEY, JSON.stringify(cmds)); }

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Queue a command. Its key is generated once here and stays fixed across replays.
export function enqueue(kind: string, payload: unknown): OutboxCommand {
  const cmd: OutboxCommand = { key: uuid(), kind, payload, created_at: Date.now() };
  write([...read(), cmd]);
  return cmd;
}

export function pendingCount(): number { return read().length; }
export function pending(): OutboxCommand[] { return read(); }

// Replay pending commands FIFO via `send`. Stops at the first failure (preserving
// order for the append-only domain) and keeps the rest for the next flush. A
// successful send removes the command. Safe to call repeatedly.
export async function flush(send: (c: OutboxCommand) => Promise<void>): Promise<{ sent: number; remaining: number }> {
  let cmds = read();
  let sent = 0;
  while (cmds.length) {
    try { await send(cmds[0]); }
    catch { break; }
    cmds = cmds.slice(1);
    write(cmds);
    sent++;
  }
  return { sent, remaining: cmds.length };
}
