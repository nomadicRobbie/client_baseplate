import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { createPaymentIntent, submitOrder, fetchOrders, markPacked, markFulfilled } from './service'
import type { OrderItem, ShippingAddress } from '@blnk/shared'

const ordersPlugin: FastifyPluginAsync = async (fastify) => {
  // ── POST /commerce/orders/intent ──────────────────────────────────────────
  // Create a Stripe PaymentIntent; client uses the clientSecret to confirm.
  fastify.post('/commerce/orders/intent', {
    schema: {
      body: {
        type: 'object',
        required: ['amount_cents'],
        additionalProperties: false,
        properties: {
          amount_cents: { type: 'integer', minimum: 1 },
          currency:     { type: 'string', maxLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { amount_cents, currency } = req.body as { amount_cents: number; currency?: string }
    const result = await createPaymentIntent(amount_cents, currency ?? '')
    return reply.send(result)
  })

  // ── POST /commerce/orders ─────────────────────────────────────────────────
  // Storefront calls this after Stripe confirms payment.
  fastify.post('/commerce/orders', {
    schema: {
      body: {
        type: 'object',
        required: ['order_ref', 'email', 'name', 'shipping_address', 'items', 'total_cents', 'payment_intent_id'],
        additionalProperties: false,
        properties: {
          order_ref:        { type: 'string', minLength: 1 },
          email:            { type: 'string', format: 'email' },
          name:             { type: 'string', minLength: 1 },
          phone:            { type: 'string' },
          shipping_address: { type: 'object' },
          items:            { type: 'array', minItems: 1 },
          total_cents:      { type: 'integer', minimum: 0 },
          payment_intent_id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as {
      order_ref: string
      email: string
      name: string
      phone?: string
      shipping_address: ShippingAddress
      items: OrderItem[]
      total_cents: number
      payment_intent_id: string
    }
    const order = await submitOrder(b)
    return reply.status(201).send({ order })
  })

  // ── GET /commerce/admin/orders ────────────────────────────────────────────
  fastify.get('/commerce/admin/orders', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { status } = req.query as { status?: string }
    const orders = await fetchOrders(status)
    return reply.send({
      orders,
      counts: {
        total:     orders.length,
        pending:   orders.filter(o => o.fulfillment_status === 'pending').length,
        packed:    orders.filter(o => o.fulfillment_status === 'packed').length,
        fulfilled: orders.filter(o => o.fulfillment_status === 'fulfilled').length,
      },
    })
  })

  // ── POST /commerce/admin/orders/:id/pack ─────────────────────────────────
  fastify.post('/commerce/admin/orders/:id/pack', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const order = await markPacked(id, req.user!.userId)
    return reply.send({ order })
  })

  // ── POST /commerce/admin/orders/:id/fulfill ───────────────────────────────
  fastify.post('/commerce/admin/orders/:id/fulfill', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const order = await markFulfilled(id, req.user!.userId)
    return reply.send({ order })
  })
}

export default ordersPlugin
