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

// ── Email config (notification recipients — blnk_api is source of truth) ──────
// Where inbound replies are forwarded. Set by the client admin at onboarding;
// client_api proxies to blnk_api (server-to-server ApiKey).
export interface EmailRecipients {
  notification_email: string | null
  backup_email: string | null
}

export async function getEmailConfig(): Promise<EmailRecipients> {
  if (config.env === 'development' && !config.blnkApi.apiKey) {
    return { notification_email: null, backup_email: null }
  }
  const res = await blnkApiFetch('/email/config', { method: 'GET' })
  if (!res.ok) throw Errors.badGateway(`blnk_api get email config failed: ${res.status}`)
  return res.json() as Promise<EmailRecipients>
}

export async function setEmailConfig(patch: Partial<EmailRecipients>): Promise<EmailRecipients> {
  if (config.env === 'development' && !config.blnkApi.apiKey) {
    console.log(`[blnk email-config dev] ${JSON.stringify(patch)}`)
    return { notification_email: patch.notification_email ?? null, backup_email: patch.backup_email ?? null }
  }
  const res = await blnkApiFetch('/email/config', { method: 'PATCH', body: JSON.stringify(patch) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Errors.badGateway(`blnk_api set email config failed: ${res.status} ${body}`)
  }
  return res.json() as Promise<EmailRecipients>
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

// ── blnk platform billing ────────────────────────────────────────────────────
// blnk_api is the authority — it holds the Stripe subscription on blnk's account.
// Auth is ApiKey (server-to-server); tenant resolved from the key, no slug needed.

export interface BlnkBillingStatus {
  status: string
  plan_name: string | null
  current_period_end: string | null
  next_invoice_cents: number | null
  currency: string | null
  interval: 'month' | 'year' | null
  card_last4: string | null
  cancel_at_period_end: boolean
  modules: string[]
}

export async function getBlnkBillingStatus(): Promise<BlnkBillingStatus> {
  const res = await blnkApiFetch('/billing/me', { method: 'GET' })
  if (!res.ok) throw Errors.badGateway(`blnk_api billing status failed: ${res.status}`)
  const data = await res.json() as BlnkBillingStatus
  // Normalise lookup keys to shared manifest keys before returning
  return { ...data, modules: (data.modules ?? []).map(fromApiKey) }
}

export async function createBlnkCheckout(successUrl: string, cancelUrl: string): Promise<string> {
  const res = await blnkApiFetch('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ success_url: successUrl, cancel_url: cancelUrl }),
  })
  if (!res.ok) throw Errors.badGateway(`blnk_api billing checkout failed: ${res.status}`)
  const json = await res.json() as { url: string }
  return json.url
}

// ponytail: 'asset' (shared manifest key) ↔ 'assets' (blnk_api/Stripe lookup key)
const TO_API: Record<string, string> = { asset: 'assets' }
const FROM_API: Record<string, string> = { assets: 'asset' }
const toApiKey = (k: string) => TO_API[k] ?? k
const fromApiKey = (k: string) => FROM_API[k] ?? k

export async function createModuleCheckout(
  modules: string[], interval: 'month' | 'year', successUrl: string, cancelUrl: string
): Promise<string> {
  const res = await blnkApiFetch('/billing/modules/checkout', {
    method: 'POST',
    body: JSON.stringify({ modules: modules.map(toApiKey), interval, success_url: successUrl, cancel_url: cancelUrl }),
  })
  if (!res.ok) throw Errors.badGateway(`blnk_api module checkout failed: ${res.status}`)
  const json = await res.json() as { url: string }
  return json.url
}

export async function updateModulePlan(modules: string[], interval: 'month' | 'year'): Promise<void> {
  const res = await blnkApiFetch('/billing/modules/plan', {
    method: 'PATCH',
    body: JSON.stringify({ modules: modules.map(toApiKey), interval }),
  })
  if (!res.ok) throw Errors.badGateway(`blnk_api update module plan failed: ${res.status}`)
}

export async function createBlnkPortal(returnUrl: string): Promise<string> {
  const res = await blnkApiFetch('/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ return_url: returnUrl }),
  })
  if (!res.ok) throw Errors.badGateway(`blnk_api billing portal failed: ${res.status}`)
  const json = await res.json() as { url: string }
  return json.url
}
