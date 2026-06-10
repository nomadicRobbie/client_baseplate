import type { AnalyticsEventType } from '@blnk/shared'

// Returns typed event-tracking helpers. The page_view baseline is handled
// automatically by plugins/analytics.client.ts — no manual call needed.
export function useAnalytics() {
  assertAnalyticsEnabled()
  const { post } = useApi()
  const sessionId = useAnalyticsSession()

  async function track(
    eventType: AnalyticsEventType,
    meta?: Record<string, unknown>,
    productId?: string,
  ): Promise<void> {
    await post('/public/analytics/event', {
      event_type: eventType,
      session_id: sessionId.value,
      url: import.meta.client ? window.location.href : '',
      referrer: import.meta.client ? document.referrer : undefined,
      product_id: productId,
      meta,
    }).catch(() => {
      // Analytics must never break the user's experience.
    })
  }

  function trackProductView(productId: string, title: string): Promise<void> {
    return track('product_view', { title }, productId)
  }

  function trackAddToCart(productId: string, title: string, priceCents: number, selectedSize?: string | null): Promise<void> {
    return track('add_to_cart', { title, price_cents: priceCents, selected_size: selectedSize }, productId)
  }

  function trackCheckoutStart(totalCents: number): Promise<void> {
    return track('checkout_start', { total_cents: totalCents })
  }

  function trackOrderComplete(orderRef: string, totalCents: number): Promise<void> {
    return track('order_complete', { order_ref: orderRef, total_cents: totalCents })
  }

  return { track, trackProductView, trackAddToCart, trackCheckoutStart, trackOrderComplete }
}

// Stable session ID for the browser session — persisted to sessionStorage.
export function useAnalyticsSession() {
  const id = useState<string>('analytics:session', () => {
    if (import.meta.client) {
      const stored = sessionStorage.getItem('blnk_sid')
      if (stored) return stored
      const next = `sid_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
      sessionStorage.setItem('blnk_sid', next)
      return next
    }
    return `sid_ssr_${Date.now()}`
  })
  return id
}
