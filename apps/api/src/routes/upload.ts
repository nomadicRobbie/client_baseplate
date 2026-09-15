import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth } from '../blnk/auth'
import { Errors } from '../utils/errors'
import { presignPut, ALLOWED_MIME } from '../utils/storage'

// POST /upload/presign — returns a presigned S3/MinIO PUT URL.
// Any authenticated user can request a presign; module-level access control
// happens at the endpoint that receives the resulting URL (PATCH product, etc.).
const uploadPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/upload/presign', {
    preHandler: [verifyBlnkAuth],
    schema: {
      body: {
        type: 'object',
        required: ['mimetype'],
        additionalProperties: false,
        properties: {
          mimetype: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { mimetype } = req.body as { mimetype: string }
    if (!ALLOWED_MIME.has(mimetype)) {
      throw Errors.badRequest(`unsupported file type — allowed: ${[...ALLOWED_MIME].join(', ')}`)
    }
    const { presignedUrl, publicUrl } = await presignPut(mimetype)
    return reply.status(200).send({ presigned_url: presignedUrl, public_url: publicUrl })
  })
}

export default uploadPlugin
