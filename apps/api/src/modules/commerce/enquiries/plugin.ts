import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { submitEnquiry, fetchEnquiries } from './service'

const enquiriesPlugin: FastifyPluginAsync = async (fastify) => {
  // ── POST /commerce/enquiries ──────────────────────────────────────────────
  fastify.post('/commerce/enquiries', {
    schema: {
      body: {
        type: 'object',
        required: ['enquiry_ref', 'name', 'email', 'message'],
        additionalProperties: false,
        properties: {
          enquiry_ref: { type: 'string', minLength: 1 },
          name:        { type: 'string', minLength: 1, maxLength: 200 },
          email:       { type: 'string', format: 'email' },
          subject:     { type: 'string', maxLength: 300 },
          message:     { type: 'string', minLength: 1 },
          _honey:      { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as {
      enquiry_ref: string; name: string; email: string
      subject?: string; message: string; _honey?: string
    }
    // Honeypot — bots fill hidden fields, humans don't.
    if (b._honey) return reply.status(200).send({ received: true })

    const enquiry = await submitEnquiry({
      enquiry_ref: b.enquiry_ref,
      name: b.name,
      email: b.email,
      subject: b.subject ?? '',
      message: b.message,
    })
    return reply.status(201).send({ enquiry })
  })

  // ── GET /commerce/admin/enquiries ─────────────────────────────────────────
  fastify.get('/commerce/admin/enquiries', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (_req, reply) => {
    return reply.send({ enquiries: await fetchEnquiries() })
  })
}

export default enquiriesPlugin
