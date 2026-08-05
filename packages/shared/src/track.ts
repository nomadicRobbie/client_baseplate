/// <reference lib="dom" />
// ── Web analytics tracker (browser-only, framework-agnostic) ────────────────
// Drop-in page-view tracker for any client site. Posts to the client_api public
// ingest endpoint. No PII, no cookies — a persistent anonymous id in
// localStorage doubles as the session id (v1). Safe to import anywhere: every
// browser API is guarded so it no-ops during SSR / non-browser environments.
//
// Usage (vanilla):
//   import { createPageViewTracker } from '@blnk/shared/track'
//   const tracker = createPageViewTracker({ apiBase: 'https://web-api.blnk.nz' })
//   tracker.trackPageView()                 // call on every route change
//
// Usage (SPA router):
//   router.afterEach(() => tracker.trackPageView())

const STORAGE_KEY = 'blnk_aid'

function getAnonId(): string {
  if (typeof localStorage === 'undefined') return 'ssr'
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `aid_${Date.now()}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

export interface TrackerOptions {
  apiBase: string
  /** Override the ingest path (defaults to the baseplate route). */
  path?: string
}

export function createPageViewTracker(opts: TrackerOptions) {
  const endpoint = `${opts.apiBase}${opts.path ?? '/public/analytics/event'}`

  async function trackPageView(meta?: Record<string, unknown>): Promise<void> {
    if (typeof window === 'undefined') return // SSR — skip
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // keepalive lets the request survive a route change / tab close.
        keepalive: true,
        body: JSON.stringify({
          event_type: 'page_view',
          session_id: getAnonId(),
          url: window.location.pathname + window.location.search,
          referrer: document.referrer || undefined,
          meta: { title: document.title, ...meta },
        }),
      })
    } catch {
      // analytics is best-effort — never throw into the host app
    }
  }

  return { trackPageView }
}
