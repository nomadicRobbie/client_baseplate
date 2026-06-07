import { Platform } from 'react-native';

// Minimal cross-platform token store.
// Web: localStorage (persistent). Native: in-memory for now — swap for
// expo-secure-store when the native app build lands (Phase: native).
const ACCESS = 'blnk_access';
const REFRESH = 'blnk_refresh';

const mem: Record<string, string> = {};

function getItem(key: string): string | null {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return mem[key] ?? null;
}

function setItem(key: string, value: string): void {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* ignore */ }
  } else {
    mem[key] = value;
  }
}

function removeItem(key: string): void {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
  } else {
    delete mem[key];
  }
}

export function getAccessToken(): string | null {
  return getItem(ACCESS);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  setItem(ACCESS, accessToken);
  setItem(REFRESH, refreshToken);
}

export function clearSession(): void {
  removeItem(ACCESS);
  removeItem(REFRESH);
}
