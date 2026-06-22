import { query } from '../pool'
import type {
  AnalyticsEvent, AnalyticsSummary, AnalyticsTopProduct,
  WebTrafficOverview, TimeSeriesPoint, TopPage, TopReferrer,
} from '@blnk/shared'

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

// ── Web traffic (generic, page_view based) ───────────────────────────────────

export async function getWebTraffic(from: Date, to: Date): Promise<{ page_views: number; unique_visitors: number; sessions: number }> {
  const rows = await query<{ page_views: string; visitors: string }>(
    `SELECT COUNT(*) AS page_views, COUNT(DISTINCT session_id) AS visitors
     FROM analytics_events
     WHERE event_type = 'page_view' AND created_at >= $1 AND created_at < $2`,
    [from, to],
  )
  const pv = parseInt(rows[0]?.page_views ?? '0', 10)
  const visitors = parseInt(rows[0]?.visitors ?? '0', 10)
  // v1: anonymous id doubles as session id, so sessions == unique_visitors.
  return { page_views: pv, unique_visitors: visitors, sessions: visitors }
}

export async function getTimeSeries(from: Date, to: Date): Promise<TimeSeriesPoint[]> {
  const rows = await query<{ day: string; page_views: string; visitors: string }>(
    `SELECT date_trunc('day', created_at) AS day,
            COUNT(*) AS page_views,
            COUNT(DISTINCT session_id) AS visitors
     FROM analytics_events
     WHERE event_type = 'page_view' AND created_at >= $1 AND created_at < $2
     GROUP BY day
     ORDER BY day ASC`,
    [from, to],
  )
  return rows.map(r => ({
    date: new Date(r.day).toISOString().slice(0, 10),
    page_views: parseInt(r.page_views, 10),
    visitors: parseInt(r.visitors, 10),
  }))
}

export async function getTopPages(from: Date, to: Date, limit = 10): Promise<TopPage[]> {
  const rows = await query<{ url: string; views: string; visitors: string }>(
    `SELECT url, COUNT(*) AS views, COUNT(DISTINCT session_id) AS visitors
     FROM analytics_events
     WHERE event_type = 'page_view' AND created_at >= $1 AND created_at < $2
     GROUP BY url
     ORDER BY views DESC
     LIMIT $3`,
    [from, to, limit],
  )
  return rows.map(r => ({
    url: r.url,
    views: parseInt(r.views, 10),
    visitors: parseInt(r.visitors, 10),
  }))
}

export async function getTopReferrers(from: Date, to: Date, limit = 10): Promise<TopReferrer[]> {
  const rows = await query<{ referrer: string; cnt: string }>(
    `SELECT COALESCE(NULLIF(referrer, ''), 'direct') AS referrer, COUNT(*) AS cnt
     FROM analytics_events
     WHERE event_type = 'page_view' AND created_at >= $1 AND created_at < $2
     GROUP BY 1
     ORDER BY cnt DESC
     LIMIT $3`,
    [from, to, limit],
  )
  return rows.map(r => ({ referrer: r.referrer, count: parseInt(r.cnt, 10) }))
}

export async function getWebOverview(from: Date, to: Date): Promise<WebTrafficOverview> {
  const [traffic, timeseries, topPages, topReferrers] = await Promise.all([
    getWebTraffic(from, to),
    getTimeSeries(from, to),
    getTopPages(from, to),
    getTopReferrers(from, to),
  ])
  return {
    page_views: traffic.page_views,
    unique_visitors: traffic.unique_visitors,
    sessions: traffic.sessions,
    timeseries,
    top_pages: topPages,
    top_referrers: topReferrers,
    period_start: from.toISOString(),
    period_end: to.toISOString(),
  }
}
