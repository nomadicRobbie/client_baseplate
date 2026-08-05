import { Platform } from 'react-native';

// Minimal cross-platform key/value store — the one place the app persists
// small values. Web: localStorage (persistent). Native: in-memory for now —
// swap for expo-secure-store when the native app build lands (Phase: native).

const mem: Record<string, string> = {};

export function getItem(key: string): string | null {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return mem[key] ?? null;
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
