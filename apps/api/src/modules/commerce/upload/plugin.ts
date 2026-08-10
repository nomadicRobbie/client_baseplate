import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { v2 as cloudinary } from 'cloudinary'
import { config } from '../../../config'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { Errors } from '../../../utils/errors'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const uploadPlugin: FastifyPluginAsync = async (fastify) => {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key:    config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  })

  // Register multipart scoped to this plugin only — does not affect other routes.
  await fastify.register(multipart, {
    limits: { fileSize: MAX_BYTES, files: 1 },
  })

  // ── POST /commerce/admin/upload ───────────────────────────────────────────
  // Accepts a single image file (multipart/form-data field name: "file").
  // Returns { url } — the Cloudinary secure URL to store on the product.
  fastify.post('/commerce/admin/upload', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) throw Errors.badGateway('no file received')
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.status(400).send({
        error: { code: 'INVALID_FILE_TYPE', message: 'only jpeg, png, webp, and gif are accepted', status: 400 },
      })
    }

    const buffer = await data.toBuffer()

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: config.tenantSlug, resource_type: 'image' },
        (err, res) => {
          if (err || !res) return reject(err ?? new Error('cloudinary upload returned no result'))
          resolve(res as { secure_url: string })
        },
      ).end(buffer)
    })

    return reply.status(201).send({ url: result.secure_url })
  })
}

export default uploadPlugin
