import { Platform } from 'react-native';

// Cross-platform durable key/value store (offline outbox, mobile-bar pins).
// This is the WEB / default implementation — localStorage (persistent on web).
// Native (iOS/Android) resolves storage.native.ts instead, which is backed by
// expo-sqlite so the offline outbox survives app-kill on roaming mobiles. Keeping
// expo-sqlite out of THIS file keeps its wasm web build out of the web bundle.

const mem: Record<string, string> = {};

export function getItem(key: string): string | null {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return mem[key] ?? null;   // non-web without a platform file: in-memory (never hit on iOS/Android)
}

export function setItem(key: string, value: string): void {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* ignore */ }
  } else {
    mem[key] = value;
  }
}

export function removeItem(key: string): void {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
  } else {
    delete mem[key];
  }
}
