import type { TokenPair, ProfileResponse, TeamUser, ClientSubscription, Plan, BlnkBillingStatus } from '@blnk/shared';

// The frontend talks ONLY to client_api. client_api proxies auth to blnk_auth
// and verifies tokens — the app never sees blnk_auth directly.
export const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TENANT = process.env.EXPO_PUBLIC_TENANT_SLUG ?? 'ting-test';

interface ReqOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
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

// ── Profile + onboarding ─────────────────────────────────────────────────────
export const getProfile = (token: string) => req<ProfileResponse>('/profile', { method: 'GET', token });

export const updateMyProfile = (token: string, data: {
  name?: string; contact_email?: string; phone?: string;
  preferred_contact?: string; timezone?: string;
}) => req('/profile/me', { method: 'PUT', body: data, token });

export const updateOrg = (token: string, data: {
  org_name?: string; logo_url?: string; brand_color?: string; accent_color?: string;
  support_email?: string; timezone?: string; locale?: string; currency?: string;
}) => req('/profile/org', { method: 'PUT', body: data, token });

// ── Team management ──────────────────────────────────────────────────────────
export const listTeam = (token: string) =>
  req<{ users: TeamUser[] }>('/team', { method: 'GET', token });

export const addTeamUser = (token: string, data: { email: string; role: 'admin' | 'member' }) =>
  req<{ user: TeamUser }>('/team', { method: 'POST', body: data, token });

export const setTeamUserActive = (token: string, id: string, active: boolean) =>
  req<{ user: TeamUser }>(`/team/${id}/active`, { method: 'PATCH', body: { active }, token });

// ── Payments (client charges end users via Stripe Checkout) ──────────────────
export const listPlans = (token: string) =>
  req<{ plans: Plan[] }>('/payments/plans', { method: 'GET', token });

export const subscribeCheckout = (token: string, data: { price_id: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/subscriptions/checkout', { method: 'POST', body: data, token });

export const listMySubscriptions = (token: string) =>
  req<{ subscriptions: ClientSubscription[] }>('/payments/subscriptions', { method: 'GET', token });

export const cancelSubscription = (token: string, id: string) =>
  req(`/payments/subscriptions/${id}/cancel`, { method: 'PATCH', token });

export const oneOffCheckout = (token: string, data: { amount_cents: number; description: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/one-off/checkout', { method: 'POST', body: data, token });

// ── blnk platform billing (the client's blnk plan; admin only) ───────────────
export const getBlnkBilling = (token: string) =>
  req<{ billing: BlnkBillingStatus }>('/billing', { method: 'GET', token });

export const blnkCheckout = (token: string, data: { success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/billing/checkout', { method: 'POST', body: data, token });

export const blnkPortal = (token: string, data: { return_url: string }) =>
  req<{ url: string }>('/billing/portal', { method: 'POST', body: data, token });
