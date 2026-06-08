import { config } from '../config'
import { Errors, AppError } from '../utils/errors'

// ── blnk_api client ─────────────────────────────────────────────────────────
// Thin wrapper over blnk_api's authenticated endpoints (email, and later portal
// status / blnk billing). Authenticates with this client's blnk_api ApiKey.
// Kept self-contained so it can graduate to @blnk/sdk later.

async function blnkApiFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${config.blnkApi.url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `ApiKey ${config.blnkApi.apiKey}`,
      ...(init.headers ?? {}),
    },
  })
  return res
}

// ── Email ───────────────────────────────────────────────────────────────────
export async function sendEmail(args: { to: string; subject: string; html: string }): Promise<void> {
  if (config.env === 'development' && !config.blnkApi.apiKey) {
    // No key wired in dev — log instead of failing.
    console.log(`[blnk email dev] to=${args.to} subject=${args.subject}`)
    return
  }
  const res = await blnkApiFetch('/email/send', { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Errors.badGateway(`blnk_api email failed: ${res.status} ${body}`)
  }
}

// ── Identity (blnk_auth) ─────────────────────────────────────────────────────
// client_api orchestrates profile: the display name lives in blnk_auth, so we
// read/write it there using the calling user's own bearer token.
export interface AuthMe { id: string; email: string; name: string | null; type: string; role: string }

export async function getAuthMe(userToken: string): Promise<AuthMe> {
  const res = await fetch(`${config.blnkAuth.url}/auth/me`, {
    headers: { authorization: `Bearer ${userToken}` },
  })
  if (!res.ok) throw Errors.badGateway(`blnk_auth /auth/me failed: ${res.status}`)
  return res.json() as Promise<AuthMe>
}

export async function setAuthName(userToken: string, name: string): Promise<AuthMe> {
  const res = await fetch(`${config.blnkAuth.url}/auth/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw Errors.badGateway(`blnk_auth set name failed: ${res.status}`)
  return res.json() as Promise<AuthMe>
}

// ── Team management (blnk_auth admin endpoints) ─────────────────────────────
// client_api forwards to blnk_auth using the caller's token; blnk_auth enforces
// tenant scope + role rules (defense in depth alongside client_api's guard).
export interface TeamUser {
  id: string; email: string; name: string | null; type: string; role: string;
  active: boolean; last_login_at: string | null;
}

export async function listTenantUsers(userToken: string): Promise<TeamUser[]> {
  const res = await fetch(`${config.blnkAuth.url}/admin/users`, {
    headers: { authorization: `Bearer ${userToken}` },
  })
  if (!res.ok) throw Errors.badGateway(`blnk_auth list users failed: ${res.status}`)
  const json = await res.json() as { users: TeamUser[] }
  return json.users
}

export async function createTenantUser(
  userToken: string,
  body: { email: string; role: 'admin' | 'member'; type?: string }
): Promise<TeamUser> {
  const res = await fetch(`${config.blnkAuth.url}/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({})) as { user?: TeamUser; error?: { message?: string } }
  if (!res.ok) throw new AppError(res.status === 409 ? 'CONFLICT' : 'BAD_GATEWAY', json.error?.message ?? `create user failed: ${res.status}`, res.status)
  return json.user!
}

export async function setTenantUserActive(
  userToken: string, id: string, active: boolean
): Promise<TeamUser> {
  const res = await fetch(`${config.blnkAuth.url}/admin/users/${id}/active`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ active }),
  })
  const json = await res.json().catch(() => ({})) as { user?: TeamUser; error?: { message?: string } }
  if (!res.ok) throw new AppError('BAD_GATEWAY', json.error?.message ?? `update user failed: ${res.status}`, res.status)
  return json.user!
}

// ── blnk platform billing (blnk bills THIS client) ──────────────────────────
// On blnk's Stripe account. Authenticated to blnk_api with this client's ApiKey
// (tenant-scoped). Contract (blnk_api side, pending the payments module on main):
//   GET  /billing/me       → BlnkBillingStatus
//   POST /billing/checkout → { url }   (start/pay the tenant's blnk subscription)
//   POST /billing/portal   → { url }   (Stripe Customer Portal to manage card/invoices)
export interface BlnkBillingStatus {
  status: string; plan_name: string | null; current_period_end: string | null;
  next_invoice_cents: number | null; currency: string | null; card_last4: string | null;
  cancel_at_period_end: boolean;
}

async function blnkApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await blnkApiFetch(path, init)
  const json = await res.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!res.ok) throw Errors.badGateway((json as { error?: { message?: string } })?.error?.message ?? `blnk_api ${path} failed: ${res.status}`)
  return json as T
}

export async function getBlnkBilling(): Promise<BlnkBillingStatus> {
  return blnkApiJson<BlnkBillingStatus>('/billing/me', { method: 'GET' })
}

export async function createBlnkCheckout(successUrl: string, cancelUrl: string): Promise<{ url: string }> {
  return blnkApiJson<{ url: string }>('/billing/checkout', {
    method: 'POST', body: JSON.stringify({ success_url: successUrl, cancel_url: cancelUrl }),
  })
}

export async function createBlnkPortal(returnUrl: string): Promise<{ url: string }> {
  return blnkApiJson<{ url: string }>('/billing/portal', {
    method: 'POST', body: JSON.stringify({ return_url: returnUrl }),
  })
}
