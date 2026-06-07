import { config } from '../config'
import { Errors } from '../utils/errors'

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

// ── Billing status (blnk's subscription with THIS client) ───────────────────
// Surfaces the client's own blnk billing state to their admin dashboard.
// Stub for Phase 3a — wired to blnk_api's tenant-scoped billing endpoints later.
export async function getBlnkBillingStatus(_accessToken: string): Promise<unknown> {
  // Placeholder: in a later phase this calls blnk_api /payments/* with the
  // client's credentials and returns subscription + invoice summaries.
  return { status: 'not_wired', note: 'blnk billing status integration lands with Phase 4' }
}
