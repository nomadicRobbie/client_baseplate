import type { FastifyPluginAsync } from 'fastify'
import { constructWebhookEvent } from '../../payments/stripe'
import { handlePaymentIntentSucceeded, handlePaymentIntentFailed } from './handlers/payment'

// NOT wrapped in fastify-plugin — raw-body content-type parser must stay
// encapsulated and not leak to the rest of the application.
const commerceWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )

  fastify.post('/public/webhook/stripe/commerce', async (req, reply) => {
    const sig = req.headers['stripe-signature']
    if (!sig || typeof sig !== 'string') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'missing stripe-signature', status: 400 } })
    }

    let event
    try {
      event = constructWebhookEvent(req.body as Buffer, sig)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'signature verification failed'
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: msg, status: 400 } })
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event)
        break
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event)
        break
      default:
        break
    }

    return reply.send({ received: true })
  })
}

export default commerceWebhookPlugin
