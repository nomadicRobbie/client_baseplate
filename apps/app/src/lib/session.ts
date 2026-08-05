import { getItem, setItem, removeItem } from './storage';

// Auth token store — thin wrapper over the shared key/value storage.
const ACCESS = 'blnk_access';
const REFRESH = 'blnk_refresh';

export function getAccessToken(): string | null {
  return getItem(ACCESS);
}

export function getRefreshToken(): string | null {
  return getItem(REFRESH);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  setItem(ACCESS, accessToken);
  setItem(REFRESH, refreshToken);
}

export function clearSession(): void {
  removeItem(ACCESS);
  removeItem(REFRESH);
}
