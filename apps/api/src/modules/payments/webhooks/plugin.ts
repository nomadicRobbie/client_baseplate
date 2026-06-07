import type { FastifyPluginAsync } from 'fastify';
import { constructWebhookEvent } from '../stripe';
import { handleCheckoutCompleted } from './handlers/checkout';
import { handleSubscriptionUpdated, handleSubscriptionDeleted } from './handlers/subscription';

// Stripe webhook for the CLIENT's account.
// CRITICAL: exported WITHOUT fastify-plugin so it stays ENCAPSULATED — its
// raw-body content-type parser must NOT leak to the rest of the app (that would
// break JSON parsing everywhere). Learned the hard way in blnk_api.
const webhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
    (_req, body, done) => done(null, body)
  );

  fastify.post('/public/webhook/stripe', { config: { rateLimit: false } }, async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'missing stripe-signature', status: 400 } });
    }

    let event;
    try {
      event = constructWebhookEvent(req.body as Buffer, signature);
    } catch (err) {
      req.log.warn(`stripe webhook signature failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'invalid signature', status: 400 } });
    }

    const log = { info: (m: string) => req.log.info(m), warn: (m: string) => req.log.warn(m) };
    try {
      switch (event.type) {
        case 'checkout.session.completed': await handleCheckoutCompleted(event, log); break;
        case 'customer.subscription.updated': await handleSubscriptionUpdated(event, log); break;
        case 'customer.subscription.deleted': await handleSubscriptionDeleted(event, log); break;
        default: req.log.info(`stripe webhook: unhandled ${event.type}`);
      }
    } catch (err) {
      req.log.error({ err, event_type: event.type }, 'stripe webhook handler error');
    }
    return reply.status(200).send({ received: true });
  });
};

export default webhookPlugin; // intentionally NOT wrapped in fp() — keep encapsulated
