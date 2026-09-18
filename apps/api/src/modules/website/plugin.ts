import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../blnk/auth'
import {
  getActiveContent,
  listContent,
  createContent,
  updateContent,
  deleteContent,
  type WebsiteContentType,
} from '../../db/queries/website'
import { Errors } from '../../utils/errors'

const VALID_TYPES: WebsiteContentType[] = ['banner', 'announcement', 'info']
const isValidType = (t: unknown): t is WebsiteContentType =>
  VALID_TYPES.includes(t as WebsiteContentType)

const contentBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type:        { type: 'string', enum: VALID_TYPES },
    title:       { type: 'string', minLength: 1, maxLength: 300 },
    body:        { type: 'string', maxLength: 5000 },
    image_url:   { type: 'string', maxLength: 1000 },
    cta_label:   { type: 'string', maxLength: 100 },
    cta_url:     { type: 'string', maxLength: 1000 },
    sort_order:  { type: 'integer', minimum: 0 },
    published:   { type: 'boolean' },
    starts_at:   { type: 'string' },
    ends_at:     { type: 'string' },
  },
}

const auth = [verifyBlnkAuth, requireRole('admin', 'super')]

const websitePlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /public/website/content?type= ────────────────────────────────────
  // No auth — called by the client's public website.
  // Returns all active published content of the requested type.
  fastify.get('/public/website/content', {
    config: { rateLimit: { max: 120, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const { type } = req.query as { type?: string }
    if (!isValidType(type)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: `type must be one of: ${VALID_TYPES.join(', ')}`, status: 400 },
      })
    }
    const content = await getActiveContent(type)
    return reply.send({ content })
  })

  // ── GET /website/content?type= ────────────────────────────────────────────
  // Dashboard — all content of a type (including unpublished / future / expired).
  fastify.get('/website/content', {
    preHandler: auth,
  }, async (req, reply) => {
    const { type } = req.query as { type?: string }
    if (!isValidType(type)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: `type must be one of: ${VALID_TYPES.join(', ')}`, status: 400 },
      })
    }
    const content = await listContent(type)
    return reply.send({ content })
  })

  // ── POST /website/content ─────────────────────────────────────────────────
  fastify.post('/website/content', {
    preHandler: auth,
    schema: {
      body: {
        ...contentBody,
        required: ['type', 'title'],
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      type: WebsiteContentType; title: string; body?: string; image_url?: string;
      cta_label?: string; cta_url?: string; sort_order?: number; published?: boolean;
      starts_at?: string; ends_at?: string;
    }
    const item = await createContent({
      type:       body.type,
      title:      body.title,
      body:       body.body ?? null,
      image_url:  body.image_url ?? null,
      cta_label:  body.cta_label ?? null,
      cta_url:    body.cta_url ?? null,
      sort_order: body.sort_order ?? 0,
      published:  body.published ?? true,
      starts_at:  body.starts_at ?? null,
      ends_at:    body.ends_at ?? null,
    })
    return reply.status(201).send({ content: item })
  })

  // ── PATCH /website/content/:id ────────────────────────────────────────────
  fastify.patch('/website/content/:id', {
    preHandler: auth,
    schema: { body: contentBody },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Parameters<typeof updateContent>[1]
    const item = await updateContent(id, patch)
    if (!item) throw Errors.notFound('content item not found')
    return reply.send({ content: item })
  })

  // ── DELETE /website/content/:id ───────────────────────────────────────────
  fastify.delete('/website/content/:id', {
    preHandler: auth,
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const deleted = await deleteContent(id)
    if (!deleted) throw Errors.notFound('content item not found')
    return reply.status(204).send()
  })
}

export default websitePlugin
