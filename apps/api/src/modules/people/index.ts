import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../blnk/auth'
import { Errors } from '../../utils/errors'
import {
  listPeople, getPerson, getPersonByUserId, createPerson, updatePerson,
  setPersonModule, removePersonModule,
} from '../../db/queries/people'

// People core — always-on canonical human directory. Reads are open to any authed
// user (pick a skipper, resolve "me"); writes are admin/super, same as the team
// surface. Domain roles inside `person_module.role` are validated by the consuming
// module, not here.
const peoplePlugin: FastifyPluginAsync = async (fastify) => {
  // ── Roster (optionally scoped to a module / active state) — admin only, it
  //    exposes everyone's contact details (PII). /people/me stays open below. ──
  fastify.get('/people', { preHandler: [verifyBlnkAuth, requireRole('admin', 'super')] }, async (req, reply) => {
    const q = req.query as { module?: string; active?: string }
    const active = q.active === undefined ? undefined : q.active === 'true'
    return reply.send({ people: await listPeople({ module: q.module, active }) })
  })

  // ── The current user's own person row (null if none) ──────────────────────
  fastify.get('/people/me', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const userId = req.user?.userId
    return reply.send({ person: userId ? await getPersonByUserId(userId) : null })
  })

  // ── One person (admin only — arbitrary person's PII) ──────────────────────
  fastify.get('/people/:id', { preHandler: [verifyBlnkAuth, requireRole('admin', 'super')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const person = await getPerson(id)
    if (!person) throw Errors.notFound('person')
    return reply.send({ person })
  })

  // ── Create a person (login-less unless user_id is supplied) ───────────────
  fastify.post('/people', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: {
      type: 'object', required: ['name'], additionalProperties: false,
      properties: {
        name:    { type: 'string', minLength: 1, maxLength: 200 },
        email:   { type: ['string', 'null'] },
        phone:   { type: ['string', 'null'] },
        user_id: { type: ['string', 'null'] },
      },
    } },
  }, async (req, reply) => {
    return reply.status(201).send({ person: await createPerson(req.body as never) })
  })

  // ── Edit a person (name/contact, link a login, activate/deactivate) ───────
  fastify.patch('/people/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: {
      type: 'object', additionalProperties: false,
      properties: {
        name:    { type: 'string', minLength: 1, maxLength: 200 },
        email:   { type: ['string', 'null'] },
        phone:   { type: ['string', 'null'] },
        user_id: { type: ['string', 'null'] },
        active:  { type: 'boolean' },
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const person = await updatePerson(id, req.body as never)
    if (!person) throw Errors.notFound('person')
    return reply.send({ person })
  })

  // ── Assign to a module / set role there (upsert) ──────────────────────────
  fastify.put('/people/:id/modules/:module', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: {
      type: 'object', required: ['role'], additionalProperties: false,
      properties: { role: { type: 'string', minLength: 1, maxLength: 50 } },
    } },
  }, async (req, reply) => {
    const { id, module } = req.params as { id: string; module: string }
    const { role } = req.body as { role: string }
    if (!(await getPerson(id))) throw Errors.notFound('person')
    await setPersonModule(id, module, role)
    return reply.send({ person: await getPerson(id) })
  })

  // ── Remove from a module ──────────────────────────────────────────────────
  fastify.delete('/people/:id/modules/:module', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id, module } = req.params as { id: string; module: string }
    const ok = await removePersonModule(id, module)
    if (!ok) throw Errors.notFound('module assignment')
    return reply.status(204).send()
  })
}

export default peoplePlugin
