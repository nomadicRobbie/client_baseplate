import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireAppAccess, requireRole, callerPersonId } from '../../blnk/auth'
import { Errors } from '../../utils/errors'
import {
  listTemplates, getTemplate, createTemplate, updateTemplate,
  listServices, getService, createService, updateService, cancelService, generateInstances,
  getAssignments, addAssignment, removeAssignment,
  getManifest, syncServices, getAvailability, appendEvent,
} from '../../db/queries/schedule'

const schedulePlugin: FastifyPluginAsync = async (fastify) => {
  const member = [verifyBlnkAuth, requireAppAccess]
  const admin  = [verifyBlnkAuth, requireRole('admin', 'super')]

  // ── Templates ───────────────────────────────────────────────────────────────
  fastify.get('/service-templates', { preHandler: admin }, async (req) => {
    const q = req.query as { active?: string }
    const active = q.active === undefined ? undefined : q.active === 'true'
    return { templates: await listTemplates(active) }
  })

  fastify.post('/service-templates', {
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['name', 'duration_minutes', 'timezone'],
      additionalProperties: false,
      properties: {
        name:                 { type: 'string', minLength: 1, maxLength: 200 },
        duration_minutes:     { type: 'integer', minimum: 1 },
        default_capacity:     { type: 'integer', minimum: 0 },
        location_label:       { type: ['string', 'null'] },
        timezone:             { type: 'string', minLength: 1 },
        required_roles:       { type: 'array' },
        required_asset_types: { type: 'array' },
        recurrence:           { type: ['object', 'null'] },
        default_asset_id:     { type: ['string', 'null'], format: 'uuid' },
        active:               { type: 'boolean' },
      },
    } },
  }, async (req, reply) => {
    const userId = req.user!.userId
    const template = await createTemplate(req.body as never, userId)
    return reply.status(201).send({ template })
  })

  fastify.patch('/service-templates/:id', {
    preHandler: admin,
    schema: { body: {
      type: 'object', additionalProperties: false,
      properties: {
        name:                 { type: 'string', minLength: 1, maxLength: 200 },
        duration_minutes:     { type: 'integer', minimum: 1 },
        default_capacity:     { type: 'integer', minimum: 0 },
        location_label:       { type: ['string', 'null'] },
        timezone:             { type: 'string', minLength: 1 },
        required_roles:       { type: 'array' },
        required_asset_types: { type: 'array' },
        recurrence:           { type: ['object', 'null'] },
        default_asset_id:     { type: ['string', 'null'], format: 'uuid' },
        active:               { type: 'boolean' },
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const template = await updateTemplate(id, req.body as never)
    if (!template) throw Errors.notFound('template')
    return reply.send({ template })
  })

  fastify.post('/service-templates/:id/generate', {
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['from', 'to'], additionalProperties: false,
      properties: {
        from: { type: 'string' },  // YYYY-MM-DD
        to:   { type: 'string' },  // YYYY-MM-DD exclusive
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { from, to } = req.body as { from: string; to: string }
    const template = await getTemplate(id)
    if (!template) throw Errors.notFound('template')
    if (!template.recurrence) throw Errors.badRequest('template has no recurrence pattern')
    const result = await generateInstances(id, from, to)
    return reply.send(result)
  })

  // ── Services ────────────────────────────────────────────────────────────────
  fastify.get('/services', {
    preHandler: member,
    schema: { querystring: {
      type: 'object', required: ['from', 'to'],
      properties: {
        from:        { type: 'string' },
        to:          { type: 'string' },
        status:      { type: 'array', items: { type: 'string' } },
        template_id: { type: 'string' },
      },
    } },
  }, async (req) => {
    const u = req.user!
    const q = req.query as { from: string; to: string; status?: string | string[]; template_id?: string }
    const status = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : undefined
    const person_id = await callerPersonId(u.userId, u.role)
    return { services: await listServices({ from: q.from, to: q.to, status, template_id: q.template_id, person_id: person_id ?? undefined }) }
  })

  fastify.get('/services/:id', { preHandler: member }, async (req) => {
    const { id } = req.params as { id: string }
    const u = req.user!
    const person_id = await callerPersonId(u.userId, u.role)
    const [service, assignments] = await Promise.all([getService(id), getAssignments(id)])
    // Members get 404 (not 403) if they're not on this service — don't leak existence.
    if (!service) throw Errors.notFound('service')
    if (person_id && !assignments.some(a => a.subject_id === person_id)) throw Errors.notFound('service')
    return { service, assignments }
  })

  fastify.post('/services', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['id', 'name', 'starts_at', 'ends_at', 'timezone'],
      additionalProperties: false,
      properties: {
        id:             { type: 'string', format: 'uuid' },
        template_id:    { type: ['string', 'null'] },
        name:           { type: 'string', minLength: 1, maxLength: 200 },
        starts_at:      { type: 'string' },
        ends_at:        { type: 'string' },
        timezone:       { type: 'string', minLength: 1 },
        location_label: { type: ['string', 'null'] },
        capacity:       { type: 'integer', minimum: 0 },
        required_roles: { type: 'array' },
        status:         { type: 'string' },
        external_ref:   { type: ['string', 'null'] },
        notes:          { type: 'string' },
        asset_id:       { type: ['string', 'null'], format: 'uuid' },
      },
    } },
  }, async (req, reply) => {
    const userId = req.user!.userId
    const body = req.body as Record<string, unknown>
    const assetId = body.asset_id as string | undefined
    delete body.asset_id
    const service = await createService(body, userId)
    if (assetId && service) {
      await addAssignment({ service_id: service.id, subject_type: 'asset', subject_id: assetId }, userId)
    }
    await appendEvent({ service_id: service!.id, event_type: 'created', actor_id: userId })
    return reply.status(201).send({ service })
  })

  fastify.patch('/services/:id', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['version'], additionalProperties: false,
      properties: {
        version:        { type: 'integer' },
        name:           { type: 'string', minLength: 1, maxLength: 200 },
        starts_at:      { type: 'string' },
        ends_at:        { type: 'string' },
        timezone:       { type: 'string' },
        location_label: { type: ['string', 'null'] },
        capacity:       { type: 'integer', minimum: 0 },
        notes:          { type: 'string' },
        status:         { type: 'string' },
        external_ref:   { type: ['string', 'null'] },
        required_roles: { type: 'array' },
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId
    const body = req.body as Record<string, unknown> & { version: number }

    const existing = await getService(id)
    if (!existing) throw Errors.notFound('service')
    if (existing.status === 'cancelled' || existing.status === 'completed')
      throw Errors.badRequest(`cannot edit a ${existing.status} service`)

    const updated = await updateService(id, body as never, body.version, userId)
    if (!updated) throw Errors.conflict('version conflict — refetch and retry')

    const eventType = body.starts_at || body.ends_at ? 'rescheduled'
      : body.capacity !== undefined ? 'capacity_changed'
      : body.notes !== undefined ? 'note_added'
      : 'rescheduled'
    await appendEvent({ service_id: id, event_type: eventType, payload: { patch: body }, actor_id: userId })

    return reply.send({ service: updated })
  })

  fastify.post('/services/:id/cancel', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['reason'], additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId
    const { reason } = req.body as { reason: string }

    const service = await getService(id)
    if (!service) throw Errors.notFound('service')
    if (service.status === 'cancelled') throw Errors.badRequest('service is already cancelled')

    const cancelled = await cancelService(id, reason, userId)
    await appendEvent({ service_id: id, event_type: 'cancelled', payload: { reason }, actor_id: userId })
    return reply.send({ service: cancelled })
  })

  // ── Assignments ─────────────────────────────────────────────────────────────
  fastify.post('/services/:id/assignments', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['subject_type', 'subject_id'], additionalProperties: false,
      properties: {
        subject_type: { type: 'string', enum: ['person', 'asset'] },
        subject_id:   { type: 'string', format: 'uuid' },
        role:         { type: ['string', 'null'] },
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId
    const body = req.body as { subject_type: string; subject_id: string; role?: string }

    const service = await getService(id)
    if (!service) throw Errors.notFound('service')

    const assignment = await addAssignment({ service_id: id, ...body }, userId)
    await appendEvent({
      service_id: id, event_type: 'assigned',
      payload: { subject_type: body.subject_type, subject_id: body.subject_id, role: body.role ?? null },
      actor_id: userId,
    })
    return reply.status(201).send({ assignment })
  })

  fastify.delete('/services/:id/assignments/:aid', { preHandler: member }, async (req, reply) => {
    const { id, aid } = req.params as { id: string; aid: string }
    const userId = req.user!.userId

    const removed = await removeAssignment(aid, userId)
    if (!removed) throw Errors.notFound('assignment')
    await appendEvent({ service_id: id, event_type: 'unassigned', payload: { assignment_id: aid }, actor_id: userId })
    return reply.status(204).send()
  })

  // ── Manifest ────────────────────────────────────────────────────────────────
  fastify.get('/services/:id/manifest', { preHandler: member }, async (req) => {
    const { id } = req.params as { id: string }
    const u = req.user!
    const person_id = await callerPersonId(u.userId, u.role)
    const manifest = await getManifest(id)
    if (!manifest) throw Errors.notFound('service')
    if (person_id && !manifest.crew.some(c => c.person_id === person_id)) throw Errors.notFound('service')
    return { manifest }
  })

  // ── Availability ────────────────────────────────────────────────────────────
  fastify.get('/availability', {
    preHandler: member,
    schema: { querystring: {
      type: 'object', required: ['from', 'to'],
      properties: { from: { type: 'string' }, to: { type: 'string' } },
    } },
  }, async (req) => {
    const { from, to } = req.query as { from: string; to: string }
    return { slots: await getAvailability(from, to) }
  })

  // ── Sync ────────────────────────────────────────────────────────────────────
  fastify.get('/sync/services', {
    preHandler: member,
    schema: { querystring: {
      type: 'object', required: ['since', 'from', 'to'],
      properties: { since: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
    } },
  }, async (req) => {
    const u = req.user!
    const { since, from, to } = req.query as { since: string; from: string; to: string }
    const person_id = await callerPersonId(u.userId, u.role)
    return { services: await syncServices(since, from, to, person_id ?? undefined) }
  })
}

export default schedulePlugin
