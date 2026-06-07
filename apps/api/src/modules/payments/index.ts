import type { FastifyPluginAsync } from 'fastify';
import { config } from '../../config';
import webhookPlugin from './webhooks/plugin';
import oneOffPlugin from './one-off/plugin';
import subscriptionsPlugin from './subscriptions/plugin';

// Payments module — registered only when FEATURE_STRIPE is on. Sub-modules are
// further gated by FEATURE_ONE_OFF / FEATURE_SUBSCRIPTIONS, so a client enables
// exactly what they're provisioned for.
//
// NOT wrapped in fastify-plugin: webhookPlugin must stay encapsulated so its
// raw-body parser doesn't leak. Registering this as a normal plugin preserves
// each child's own encapsulation.
const paymentsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(webhookPlugin);
  if (config.features.oneOff) await fastify.register(oneOffPlugin);
  if (config.features.subscriptions) await fastify.register(subscriptionsPlugin);
};

export default paymentsPlugin;
