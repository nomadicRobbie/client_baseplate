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

// ── Billing status (blnk's subscription with THIS client) ───────────────────
// Surfaces the client's own blnk billing state to their admin dashboard.
// Stub for Phase 3a — wired to blnk_api's tenant-scoped billing endpoints later.
export async function getBlnkBillingStatus(_accessToken: string): Promise<unknown> {
  // Placeholder: in a later phase this calls blnk_api /payments/* with the
  // client's credentials and returns subscription + invoice summaries.
  return { status: 'not_wired', note: 'blnk billing status integration lands with Phase 4' }
}
