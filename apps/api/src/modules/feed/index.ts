import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireAppAccess } from '../../blnk/auth'
import { getAuthMe } from '../../blnk/client'
import { getPersonByUserId, listPeople } from '../../db/queries/people'
import { config } from '../../config'
import { createFeedPost, deleteFeedPost, listFeedItems, getVisiblePost, listPostComments, createPostComment } from '../../db/queries/feed'
import { Errors } from '../../utils/errors'

function bearer(req: { headers: { authorization?: string } }): string {
  return (req.headers.authorization ?? '').slice(7)
}

// Resolve the module keys a user has access to (empty array = admin/super, sees all).
async function myModules(userId: string, isAdmin: boolean): Promise<string[]> {
  if (isAdmin) return []
  const person = await getPersonByUserId(userId)
  return person?.modules.map(m => m.module) ?? []
}

// Resolve best-effort author name: people row → blnk_auth → fallback.
async function resolveAuthorName(userId: string, token: string): Promise<string> {
  const person = await getPersonByUserId(userId)
  if (person?.name) return person.name
  try { const me = await getAuthMe(token); return me.name || 'Staff' } catch { return 'Staff' }
}

const feedPlugin: FastifyPluginAsync = async (fastify) => {
  const auth = [verifyBlnkAuth, requireAppAccess]

  // ── GET /feed ─────────────────────────────────────────────────────────────
  // Returns up to 50 items from the last 30 days, newest first.
  // Also returns my_modules so the compose UI can build its "Visible to" selector.
  fastify.get('/feed', { preHandler: auth }, async (req) => {
    const u = req.user!
    const isAdmin = u.role === 'admin' || u.role === 'super'
    const modules = await myModules(u.userId, isAdmin)
    const items = await listFeedItems({ isAdmin, myModules: modules })
    // Modules a post can be scoped to — derived from enabled feature flags, not people assignments.
    const available_modules = (['vessel', 'compliance'] as const).filter(m => config.features[m])
    return { items, my_modules: modules, available_modules }
  })

  // ── POST /feed/posts ──────────────────────────────────────────────────────
  fastify.post('/feed/posts', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body:     { type: 'string', minLength: 1, maxLength: 2000 },
          modules:  { type: 'array', items: { type: 'string' }, default: [] },
          mentions: { type: 'array', items: { type: 'string' }, default: [] },
        },
      },
    },
  }, async (req, reply) => {
    const u = req.user!
    const isAdmin = u.role === 'admin' || u.role === 'super'
    const { body, modules: requestedModules = [], mentions: requestedMentions = [] } = req.body as { body: string; modules: string[]; mentions: string[] }

    // Validate the requested scope is a subset of what the poster can access.
    // Admins can post to any scope (including []); members are limited to their modules.
    if (!isAdmin && requestedModules.length > 0) {
      const allowed = await myModules(u.userId, false)
      const invalid = requestedModules.filter(m => !allowed.includes(m))
      if (invalid.length) throw Errors.badRequest(`not assigned to module(s): ${invalid.join(', ')}`)
    }

    // Validate mentions are real person_ids.
    let validMentions: string[] = []
    if (requestedMentions.length > 0) {
      const people = await listPeople({})
      const knownIds = new Set(people.map(p => p.id))
      validMentions = requestedMentions.filter(id => knownIds.has(id))
    }

    const authorName = await resolveAuthorName(u.userId, bearer(req))
    const post = await createFeedPost(u.userId, authorName, body, requestedModules, validMentions)
    return reply.status(201).send({ post })
  })

  // ── DELETE /feed/posts/:id ─────────────────────────────────────────────────
  // Authors can delete their own posts; admins can delete any.
  fastify.delete('/feed/posts/:id', { preHandler: auth }, async (req, reply) => {
    const u = req.user!
    const { id } = req.params as { id: string }
    const isAdmin = u.role === 'admin' || u.role === 'super'
    const deleted = await deleteFeedPost(id, u.userId, isAdmin)
    if (!deleted) throw Errors.notFound('post')
    return reply.status(204).send()
  })

  // ── GET /feed/posts/:id/comments ──────────────────────────────────────────
  fastify.get('/feed/posts/:id/comments', { preHandler: auth }, async (req) => {
    const u = req.user!
    const { id } = req.params as { id: string }
    const isAdmin = u.role === 'admin' || u.role === 'super'
    const modules = await myModules(u.userId, isAdmin)
    const post = await getVisiblePost(id, isAdmin, modules)
    if (!post) throw Errors.notFound('post')
    return { comments: await listPostComments(id) }
  })

  // ── POST /feed/posts/:id/comments ─────────────────────────────────────────
  fastify.post('/feed/posts/:id/comments', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object',
        required: ['body'],
        properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
      },
    },
  }, async (req, reply) => {
    const u = req.user!
    const { id } = req.params as { id: string }
    const isAdmin = u.role === 'admin' || u.role === 'super'
    const modules = await myModules(u.userId, isAdmin)
    const post = await getVisiblePost(id, isAdmin, modules)
    if (!post) throw Errors.notFound('post')
    const authorName = await resolveAuthorName(u.userId, bearer(req))
    const comment = await createPostComment(id, u.userId, authorName, (req.body as { body: string }).body)
    return reply.status(201).send({ comment })
  })
}

export default feedPlugin
