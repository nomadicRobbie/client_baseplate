import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../blnk/auth'
import { getBlnkBillingStatus, createBlnkCheckout, createBlnkPortal } from '../blnk/client'

// Proxy blnk platform billing through to blnk_api.
// Admin-only — members have no reason to see or change the billing relationship with blnk.
const admin = [verifyBlnkAuth, requireRole('admin', 'super')]

const billingPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /billing/me ───────────────────────────────────────────────────────
  fastify.get('/billing/me', { preHandler: admin }, async (_req, reply) => {
    return reply.status(200).send(await getBlnkBillingStatus())
  })

  // ── POST /billing/checkout ────────────────────────────────────────────────
  fastify.post('/billing/checkout', {
    preHandler: admin,
    schema: {
      body: {
        type: 'object', required: ['success_url', 'cancel_url'], additionalProperties: false,
        properties: { success_url: { type: 'string', format: 'uri' }, cancel_url: { type: 'string', format: 'uri' } },
      },
    },
  }, async (req, reply) => {
    const { success_url, cancel_url } = req.body as { success_url: string; cancel_url: string }
    return reply.status(200).send({ url: await createBlnkCheckout(success_url, cancel_url) })
  })

  // ── POST /billing/portal ──────────────────────────────────────────────────
  fastify.post('/billing/portal', {
    preHandler: admin,
    schema: {
      body: {
        type: 'object', required: ['return_url'], additionalProperties: false,
        properties: { return_url: { type: 'string', format: 'uri' } },
      },
    },
  }, async (req, reply) => {
    const { return_url } = req.body as { return_url: string }
    return reply.status(200).send({ url: await createBlnkPortal(return_url) })
  })
}

export default billingPlugin
