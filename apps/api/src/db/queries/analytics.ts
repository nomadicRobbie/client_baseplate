import { query } from '../pool'
import type { AnalyticsEvent, AnalyticsSummary, AnalyticsTopProduct } from '@blnk/shared'

export async function insertEvent(e: AnalyticsEvent): Promise<void> {
  await query(
    `INSERT INTO analytics_events (event_type, session_id, url, referrer, product_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.event_type, e.session_id, e.url, e.referrer ?? null, e.product_id ?? null, e.meta ?? {}],
  )
}

export async function getSummary(from: Date, to: Date): Promise<AnalyticsSummary> {
  const [counts, revenue, topProducts] = await Promise.all([
    query<{ event_type: string; cnt: string }>(
      `SELECT event_type, COUNT(*) AS cnt
       FROM analytics_events
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY event_type`,
      [from, to],
    ),

    query<{ total: string }>(
      `SELECT COALESCE(SUM((meta->>'total_cents')::int), 0) AS total
       FROM analytics_events
       WHERE event_type = 'order_complete' AND created_at >= $1 AND created_at < $2`,
      [from, to],
    ),

    query<{ product_id: string; title: string; units: string; revenue: string }>(
      `SELECT
         product_id::text,
         meta->>'title'     AS title,
         SUM((meta->>'quantity')::int)    AS units,
         SUM((meta->>'total_cents')::int) AS revenue
       FROM analytics_events
       WHERE event_type = 'order_complete'
         AND product_id IS NOT NULL
         AND created_at >= $1 AND created_at < $2
       GROUP BY product_id, meta->>'title'
       ORDER BY units DESC
       LIMIT 10`,
      [from, to],
    ),
  ])

  const countMap = Object.fromEntries(counts.map(r => [r.event_type, parseInt(r.cnt, 10)]))
  const sessions = await query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT session_id) AS cnt FROM analytics_events WHERE created_at >= $1 AND created_at < $2`,
    [from, to],
  )
  const uniqueSessions = parseInt(sessions[0]?.cnt ?? '0', 10)
  const checkoutStarts = countMap['checkout_start'] ?? 0

  return {
    revenue_cents: parseInt(revenue[0]?.total ?? '0', 10),
    order_count: countMap['order_complete'] ?? 0,
    unique_sessions: uniqueSessions,
    page_views: countMap['page_view'] ?? 0,
    conversion_rate: uniqueSessions > 0 ? checkoutStarts / uniqueSessions : 0,
    top_products: topProducts.map(r => ({
      product_id: r.product_id,
      title: r.title ?? '',
      units_sold: parseInt(r.units, 10),
      revenue_cents: parseInt(r.revenue, 10),
    })) as AnalyticsTopProduct[],
    period_start: from.toISOString(),
    period_end: to.toISOString(),
  }
}
