import { router } from 'expo-router';
import type { TokenPair, ProfileResponse, TeamUser, ClientSubscription, WebTrafficOverview, ComplianceRecordType, ComplianceRecord, ComplianceSchedule, ScheduleDue } from '@blnk/shared';
import { getAccessToken, getRefreshToken, setTokens, clearSession } from './session';

// The frontend talks ONLY to client_api. client_api proxies auth to blnk_auth
// and verifies tokens — the app never sees blnk_auth directly.
export const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TENANT = process.env.EXPO_PUBLIC_TENANT_SLUG ?? 'ting-test';

interface ReqOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  _retried?: boolean; // internal: guards the single silent-refresh retry
}

// Access tokens live 15 min; refresh tokens 7 days. When an authenticated call
// 401s we silently exchange the refresh token for a new pair and retry once.
// Direct fetch (not req) so it can't recurse.
async function trySilentRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin(): void {
  clearSession();
  router.replace('/login');
}

async function req<T = unknown>(path: string, { method, body, token, _retried }: ReqOpts): Promise<T> {
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

  // Session expired mid-use: refresh once and retry; if that fails, the session
  // is truly over (refresh expired/revoked) → send them to login, not an error.
  // Only for authenticated calls — login/OTP 401s must surface to the caller.
  if (res.status === 401 && token && !_retried) {
    if (await trySilentRefresh()) {
      return req<T>(path, { method, body, token: getAccessToken() ?? undefined, _retried: true });
    }
    redirectToLogin();
  }

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
  // Forwarded by client_api to blnk_api (inbound forwarding recipients).
  notification_email?: string; backup_email?: string | null;
}) => req('/profile/org', { method: 'PUT', body: data, token });

// ── Team management ──────────────────────────────────────────────────────────
export const listTeam = (token: string) =>
  req<{ users: TeamUser[] }>('/team', { method: 'GET', token });

export const addTeamUser = (token: string, data: { email: string; role: 'admin' | 'member' }) =>
  req<{ user: TeamUser }>('/team', { method: 'POST', body: data, token });

export const setTeamUserActive = (token: string, id: string, active: boolean) =>
  req<{ user: TeamUser }>(`/team/${id}/active`, { method: 'PATCH', body: { active }, token });

// ── Payments (client charges end users via Stripe Checkout) ──────────────────
export const subscribeCheckout = (token: string, data: { price_id: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/subscriptions/checkout', { method: 'POST', body: data, token });

export const listMySubscriptions = (token: string) =>
  req<{ subscriptions: ClientSubscription[] }>('/payments/subscriptions', { method: 'GET', token });

export const cancelSubscription = (token: string, id: string) =>
  req(`/payments/subscriptions/${id}/cancel`, { method: 'PATCH', token });

export const oneOffCheckout = (token: string, data: { amount_cents: number; description: string; success_url: string; cancel_url: string }) =>
  req<{ url: string }>('/payments/one-off/checkout', { method: 'POST', body: data, token });

// ── Analytics (web traffic — requires FEATURE_ANALYTICS) ─────────────────────
export const getAnalyticsOverview = (token: string, range?: { from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const q = qs.toString();
  return req<{ overview: WebTrafficOverview }>(`/analytics/overview${q ? `?${q}` : ''}`, { method: 'GET', token });
};

// ── Locations ────────────────────────────────────────────────────────────────
export interface LocationEntry {
  id: string;
  location: string;
  starts_at: string;
  note: string | null;
  created_at: string;
}

export const getLocations = (token: string) =>
  req<{ locations: LocationEntry[] }>('/locations', { method: 'GET', token });

export const createLocation = (token: string, data: { location: string; starts_at: string; note?: string }) =>
  req<{ location: LocationEntry }>('/locations', { method: 'POST', body: data, token });

export const deleteLocation = (token: string, id: string) =>
  req<void>(`/locations/${id}`, { method: 'DELETE', token });

// ── Compliance (food safety records — requires FEATURE_COMPLIANCE) ───────────
export const getRecordTypes = (token: string, tier?: string) =>
  req<{ record_types: ComplianceRecordType[] }>(
    `/compliance/record-types${tier ? `?tier=${tier}` : ''}`, { method: 'GET', token });

export const getComplianceRecords = (token: string, filters?: { type?: string; result?: string; from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (filters?.type) qs.set('type', filters.type);
  if (filters?.result) qs.set('result', filters.result);
  if (filters?.from) qs.set('from', filters.from);
  if (filters?.to) qs.set('to', filters.to);
  const q = qs.toString();
  return req<{ records: ComplianceRecord[] }>(`/compliance/records${q ? `?${q}` : ''}`, { method: 'GET', token });
};

export const createComplianceRecord = (token: string, body: {
  record_type: string; entered_by: string; data: Record<string, unknown>; site_id?: string | null; schedule_id?: string | null;
}) => req<{ record: ComplianceRecord; corrective_action: ComplianceRecord | null }>(
  '/compliance/records', { method: 'POST', body, token });

export const updateComplianceRecord = (token: string, id: string, body: {
  entered_by?: string; data?: Record<string, unknown>;
}) => req<{ record: ComplianceRecord }>(`/compliance/records/${id}`, { method: 'PATCH', body, token });

// ── Compliance schedules (recurring checks) ──────────────────────────────────
export type NewSchedule = {
  record_type: string; label: string; site_id?: string | null; cadence: string;
  weekdays?: number[]; day_of_month?: number | null; interval_days?: number | null;
  anchor_date?: string | null; times_per_day?: number;
};

export const getSchedulesDue = (token: string, on: string) =>
  req<{ due: ScheduleDue[] }>(`/compliance/schedules/due?on=${on}`, { method: 'GET', token });

export const listSchedules = (token: string) =>
  req<{ schedules: ComplianceSchedule[] }>('/compliance/schedules', { method: 'GET', token });

export const createSchedule = (token: string, body: NewSchedule) =>
  req<{ schedule: ComplianceSchedule }>('/compliance/schedules', { method: 'POST', body, token });

export const updateSchedule = (token: string, id: string, body: Partial<NewSchedule> & { active?: boolean }) =>
  req<{ schedule: ComplianceSchedule }>(`/compliance/schedules/${id}`, { method: 'PATCH', body, token });

export const deleteSchedule = (token: string, id: string) =>
  req<void>(`/compliance/schedules/${id}`, { method: 'DELETE', token });
