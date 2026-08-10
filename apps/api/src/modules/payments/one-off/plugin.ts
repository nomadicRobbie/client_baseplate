import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth';
import { createOneOffCheckout, listMyPayments } from './service';

function bearer(req: FastifyRequest): string {
  return (req.headers.authorization ?? '').slice(7);
}

// Billing is a tenant-admin concern — members never manage payments. (Only the
// admin Billing screen uses these; a customer-facing one-off flow would live in
// its own module with its own access rules.)
const admin = [verifyBlnkAuth, requireRole('admin', 'super')];

const oneOffPlugin: FastifyPluginAsync = async (fastify) => {
  // ── POST /payments/one-off/checkout ───────────────────────────────────────
  // Admin starts a one-time payment; returns a Stripe Checkout URL.
  fastify.post('/payments/one-off/checkout', {
    preHandler: admin,
    schema: {
      body: {
        type: 'object',
        required: ['amount_cents', 'description', 'success_url', 'cancel_url'],
        additionalProperties: false,
        properties: {
          amount_cents: { type: 'integer', minimum: 50 },
          description: { type: 'string', minLength: 1, maxLength: 200 },
          success_url: { type: 'string', format: 'uri' },
          cancel_url: { type: 'string', format: 'uri' },
          currency: { type: 'string', maxLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as { amount_cents: number; description: string; success_url: string; cancel_url: string; currency?: string };
    const { url, payment } = await createOneOffCheckout({
      userId: req.user!.userId,
      userToken: bearer(req),
      amountCents: b.amount_cents,
      description: b.description,
      successUrl: b.success_url,
      cancelUrl: b.cancel_url,
      currency: b.currency,
    });
    return reply.status(200).send({ url, payment });
  });

  // ── GET /payments/one-off ─────────────────────────────────────────────────
  fastify.get('/payments/one-off', { preHandler: admin }, async (req, reply) => {
    return reply.status(200).send({ payments: await listMyPayments(req.user!.userId) });
  });
};

export default oneOffPlugin;
