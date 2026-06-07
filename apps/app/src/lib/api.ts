import type { TokenPair } from '@blnk/shared';

// The frontend talks ONLY to client_api. client_api proxies auth to blnk_auth
// and verifies tokens — the app never sees blnk_auth directly.
export const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TENANT = process.env.EXPO_PUBLIC_TENANT_SLUG ?? 'ting-test';

interface ReqOpts {
  method: 'GET' | 'POST';
  body?: unknown;
  token?: string;
}

async function req<T = unknown>(path: string, { method, body, token }: ReqOpts): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set JSON content-type when there's a body — Fastify rejects an empty
  // JSON body (passkey register/begin sends none).
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ── OTP ─────────────────────────────────────────────────────────────────────
export const otpSend = (email: string) =>
  req('/auth/otp/send', { method: 'POST', body: { tenant_slug: TENANT, email } });

export const otpVerify = (email: string, code: string) =>
  req<TokenPair>('/auth/otp/verify', { method: 'POST', body: { tenant_slug: TENANT, email, code } });

// ── Passkey (ceremonies proxied to blnk_auth) ───────────────────────────────
export const passkeyLoginBegin = (email: string) =>
  req('/auth/passkey/login/begin', { method: 'POST', body: { tenant_slug: TENANT, email } });

export const passkeyLoginComplete = (email: string, response: unknown) =>
  req<TokenPair>('/auth/passkey/login/complete', { method: 'POST', body: { tenant_slug: TENANT, email, response } });

export const passkeyRegisterBegin = (token: string) =>
  req('/auth/passkey/register/begin', { method: 'POST', token }); // no body

export const passkeyRegisterComplete = (token: string, response: unknown) =>
  req('/auth/passkey/register/complete', { method: 'POST', body: { response }, token });

// ── Session ──────────────────────────────────────────────────────────────────
export const me = (token: string) => req('/me', { method: 'GET', token });
