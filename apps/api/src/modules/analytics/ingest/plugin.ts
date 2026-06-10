import type { FastifyPluginAsync } from 'fastify'
import { insertEvent } from '../../../db/queries/analytics'
import type { AnalyticsEventType } from '@blnk/shared'

const VALID_TYPES: AnalyticsEventType[] = [
  'page_view', 'product_view', 'add_to_cart', 'checkout_start', 'order_complete',
]

const ingestPlugin: FastifyPluginAsync = async (fastify) => {
  // ── POST /public/analytics/event ─────────────────────────────────────────
  // No auth — called by the public site. Rate-limited by the global limiter.
  fastify.post('/public/analytics/event', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'object',
        required: ['event_type', 'session_id', 'url'],
        additionalProperties: false,
        properties: {
          event_type:  { type: 'string' },
          session_id:  { type: 'string', minLength: 1, maxLength: 100 },
          url:         { type: 'string', maxLength: 2000 },
          referrer:    { type: 'string', maxLength: 2000 },
          product_id:  { type: 'string' },
          meta:        { type: 'object' },
          _honey:      { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as {
      event_type: string; session_id: string; url: string
      referrer?: string; product_id?: string; meta?: Record<string, unknown>
      _honey?: string
    }

    if (b._honey) return reply.send({ received: true })

    if (!VALID_TYPES.includes(b.event_type as AnalyticsEventType)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: `unknown event_type: ${b.event_type}`, status: 400 },
      })
    }

    await insertEvent({
      event_type: b.event_type as AnalyticsEventType,
      session_id: b.session_id,
      url: b.url,
      referrer: b.referrer,
      product_id: b.product_id,
      meta: b.meta,
    })

    return reply.send({ received: true })
  })
}

export default ingestPlugin
