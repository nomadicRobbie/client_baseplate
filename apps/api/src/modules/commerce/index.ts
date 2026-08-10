import type { FastifyPluginAsync } from 'fastify'
import { config } from '../../config'
import productsPlugin from './products/plugin'
import ordersPlugin from './orders/plugin'
import enquiriesPlugin from './enquiries/plugin'
import commerceWebhookPlugin from './webhooks/plugin'
import uploadPlugin from './upload/plugin'

// Commerce module — registered only when FEATURE_COMMERCE is on.
// NOT wrapped in fastify-plugin: webhookPlugin must stay encapsulated so its
// raw-body parser does not leak to the rest of the application.
const commercePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(commerceWebhookPlugin)
  await fastify.register(productsPlugin)
  await fastify.register(ordersPlugin)
  if (config.features.commerce) await fastify.register(enquiriesPlugin)
  await fastify.register(uploadPlugin)
}

export default commercePlugin
