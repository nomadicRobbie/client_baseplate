import * as SQLite from 'expo-sqlite';

// Native (iOS/Android) durable key/value store — expo-sqlite. Persists across
// app-kill, which is what makes the offline outbox reliable on roaming mobiles
// (the primary field device). Metro resolves this file on native; web uses
// storage.ts (localStorage). Same synchronous signatures, so callers (outbox,
// pins-context) are identical on every platform. DB opened lazily on first use.

let _db: SQLite.SQLiteDatabase | null = null;
function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('blnk.db');
    _db.execSync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  }
  return _db;
}

export function getItem(key: string): string | null {
  const row = db().getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export function setItem(key: string, value: string): void {
  db().runSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  );
}

export function removeItem(key: string): void {
  db().runSync('DELETE FROM kv WHERE key = ?', key);
}
