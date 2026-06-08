import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { verifyBlnkAuth } from '../../../blnk/auth';
import { createSubscriptionCheckout, listMySubscriptions, cancelMySubscription, listPlans } from './service';

function bearer(req: FastifyRequest): string {
  return (req.headers.authorization ?? '').slice(7);
}

const subscriptionsPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /payments/plans ───────────────────────────────────────────────────
  // The client's subscription plans, from their Stripe catalogue (source of truth).
  fastify.get('/payments/plans', { preHandler: [verifyBlnkAuth] }, async (_req, reply) => {
    return reply.status(200).send({ plans: await listPlans() });
  });

  // ── POST /payments/subscriptions/checkout ─────────────────────────────────
  fastify.post('/payments/subscriptions/checkout', {
    preHandler: [verifyBlnkAuth],
    schema: {
      body: {
        type: 'object',
        required: ['price_id', 'success_url', 'cancel_url'],
        additionalProperties: false,
        properties: {
          price_id: { type: 'string', minLength: 1 },
          success_url: { type: 'string', format: 'uri' },
          cancel_url: { type: 'string', format: 'uri' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as { price_id: string; success_url: string; cancel_url: string };
    const { url } = await createSubscriptionCheckout({
      userId: req.user!.userId, userToken: bearer(req),
      priceId: b.price_id, successUrl: b.success_url, cancelUrl: b.cancel_url,
    });
    return reply.status(200).send({ url });
  });

  // ── GET /payments/subscriptions ───────────────────────────────────────────
  fastify.get('/payments/subscriptions', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    return reply.status(200).send({ subscriptions: await listMySubscriptions(req.user!.userId) });
  });

  // ── PATCH /payments/subscriptions/:id/cancel ──────────────────────────────
  fastify.patch('/payments/subscriptions/:id/cancel', {
    preHandler: [verifyBlnkAuth],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await cancelMySubscription(req.user!.userId, id);
    return reply.status(204).send();
  });
};

export default subscriptionsPlugin;
