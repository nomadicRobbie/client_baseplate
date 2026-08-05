import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../blnk/auth'
import { Errors } from '../../utils/errors'
import { evaluate } from './engine'
import { isDueOn } from './schedule'
import {
  listRecordTypes, getRecordType,
  createRecord, getRecord, listRecords, updateRecord, voidRecord,
  listSuppliers, createSupplier, updateSupplier,
  listSites, createSite, updateSite,
  listSchedules, listActiveSchedules, createSchedule, updateSchedule, deleteSchedule, scheduleDoneCounts,
  type RecordFilters,
} from '../../db/queries/compliance'

// Single jurisdiction per deploy for now — the tenant's country.
// ponytail: const, not config; add an env/tenant field when a deploy serves
// multiple countries (registry + engine already handle it via seed data).
const JURISDICTION = 'NZ'

const compliancePlugin: FastifyPluginAsync = async (fastify) => {
  // ── Record types — drives the forms (any authed staff) ────────────────────
  fastify.get('/compliance/record-types', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const { tier } = req.query as { tier?: string }
    return reply.send({ record_types: await listRecordTypes(JURISDICTION, tier) })
  })

  // ── Create a record — engine sets pass/fail; a fail spawns a linked CA ─────
  fastify.post('/compliance/records', {
    preHandler: [verifyBlnkAuth],
    schema: {
      body: {
        type: 'object',
        required: ['record_type', 'entered_by'],
        additionalProperties: false,
        properties: {
          record_type:          { type: 'string', minLength: 1 },
          site_id:              { type: ['string', 'null'] },
          entered_by:           { type: 'string', minLength: 1, maxLength: 200 },
          datetime:             { type: ['string', 'null'] },
          data:                 { type: 'object', additionalProperties: true },
          attachment_url:       { type: ['string', 'null'] },
          corrective_action_id: { type: ['string', 'null'] },
          schedule_id:          { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as {
      record_type: string; site_id?: string | null; entered_by: string
      datetime?: string | null; data?: Record<string, unknown>
      attachment_url?: string | null; corrective_action_id?: string | null; schedule_id?: string | null
    }
    const type = await getRecordType(JURISDICTION, b.record_type)
    if (!type) throw Errors.notFound('record type')

    const data = b.data ?? {}
    const result = evaluate(type.critical_limit as never, data)

    const record = await createRecord({
      jurisdiction: JURISDICTION,
      record_type: b.record_type,
      site_id: b.site_id ?? null,
      entered_by: b.entered_by,
      created_by: req.user?.userId ?? null,
      datetime: b.datetime ?? undefined,
      result,
      data,
      corrective_action_id: b.corrective_action_id ?? null,
      attachment_url: b.attachment_url ?? null,
      schedule_id: b.schedule_id ?? null,
    })

    // A failed check auto-spawns a blank corrective_action record, linked both
    // ways, for staff to fill in ("when something goes wrong"). Skip if the
    // failing record IS a corrective action, or one was already supplied.
    let corrective_action = null
    if (result === 'fail' && b.record_type !== 'corrective_action' && !record.corrective_action_id) {
      corrective_action = await createRecord({
        jurisdiction: JURISDICTION,
        record_type: 'corrective_action',
        site_id: record.site_id,
        entered_by: b.entered_by,
        created_by: req.user?.userId ?? null,
        result: 'na',
        data: { what_went_wrong: `${type.label} check failed`, affected: '' },
      })
      await updateRecord(record.id, { corrective_action_id: corrective_action.id })
      record.corrective_action_id = corrective_action.id
    }

    return reply.status(201).send({ record, corrective_action })
  })

  // ── List / filter records ─────────────────────────────────────────────────
  fastify.get('/compliance/records', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const q = req.query as RecordFilters
    return reply.send({ records: await listRecords(q) })
  })

  // ── One record ────────────────────────────────────────────────────────────
  fastify.get('/compliance/records/:id', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getRecord(id)
    if (!record) throw Errors.notFound('record')
    return reply.send({ record })
  })

  // ── Edit a record (e.g. fill in a corrective action). Re-evaluates result ──
  fastify.patch('/compliance/records/:id', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await getRecord(id)
    if (!existing) throw Errors.notFound('record')
    const b = req.body as { entered_by?: string; datetime?: string; data?: Record<string, unknown>; attachment_url?: string }

    const patch: Parameters<typeof updateRecord>[1] = { ...b }
    // If the payload changed the data, re-run the engine against the type's limit.
    if (b.data !== undefined) {
      const type = await getRecordType(JURISDICTION, existing.record_type)
      patch.result = evaluate(type?.critical_limit as never, b.data)
    }
    const record = await updateRecord(id, patch)
    return reply.send({ record })
  })

  // ── Soft-void a record (never hard-delete — retention) — admin only ───────
  fastify.post('/compliance/records/:id/void', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = await voidRecord(id)
    if (!ok) throw Errors.notFound('record')
    return reply.send({ voided: true })
  })

  // ── Suppliers (trusted supplier list) ─────────────────────────────────────
  fastify.get('/compliance/suppliers', { preHandler: [verifyBlnkAuth] }, async (_req, reply) => {
    return reply.send({ suppliers: await listSuppliers() })
  })
  fastify.post('/compliance/suppliers', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', minLength: 1 }, contact: { type: 'string' },
      products: { type: 'string' }, registration: { type: 'string' } } } },
  }, async (req, reply) => {
    return reply.status(201).send({ supplier: await createSupplier(req.body as never) })
  })
  fastify.patch('/compliance/suppliers/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const supplier = await updateSupplier(id, req.body as never)
    if (!supplier) throw Errors.notFound('supplier')
    return reply.send({ supplier })
  })

  // ── Sites (multi-site / mobile home base) ─────────────────────────────────
  fastify.get('/compliance/sites', { preHandler: [verifyBlnkAuth] }, async (_req, reply) => {
    return reply.send({ sites: await listSites() })
  })
  fastify.post('/compliance/sites', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', minLength: 1 }, address: { type: 'string' },
      is_home_base: { type: 'boolean' } } } },
  }, async (req, reply) => {
    return reply.status(201).send({ site: await createSite(req.body as never) })
  })
  fastify.patch('/compliance/sites/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await updateSite(id, req.body as never)
    if (!site) throw Errors.notFound('site')
    return reply.send({ site })
  })

  // ── Schedules (recurring checks that populate "Today") ────────────────────
  fastify.get('/compliance/schedules', { preHandler: [verifyBlnkAuth] }, async (_req, reply) => {
    return reply.send({ schedules: await listSchedules() })
  })

  // What's due on a given local date (?on=YYYY-MM-DD, defaults to server today),
  // with how many of each are already done that day.
  fastify.get('/compliance/schedules/due', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const { on } = req.query as { on?: string }
    const dateStr = on ?? new Date().toISOString().slice(0, 10)
    const date = new Date(dateStr + 'T00:00:00')
    const [schedules, done] = await Promise.all([listActiveSchedules(), scheduleDoneCounts(dateStr)])
    const due = schedules
      .filter((sc) => isDueOn(sc, date))
      .map((sc) => {
        const done_count = done[sc.id] ?? 0
        return { schedule: sc, done_count, remaining: Math.max(0, sc.times_per_day - done_count) }
      })
    return reply.send({ due })
  })

  fastify.post('/compliance/schedules', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: { body: { type: 'object', required: ['record_type', 'label', 'cadence'], properties: {
      record_type:   { type: 'string', minLength: 1 },
      label:         { type: 'string', minLength: 1, maxLength: 200 },
      site_id:       { type: ['string', 'null'] },
      cadence:       { type: 'string', enum: ['daily', 'weekly', 'monthly', 'interval'] },
      weekdays:      { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
      day_of_month:  { type: ['integer', 'null'], minimum: 1, maximum: 31 },
      interval_days: { type: ['integer', 'null'], minimum: 1 },
      anchor_date:   { type: ['string', 'null'] },
      times_per_day: { type: 'integer', minimum: 1 },
    } } },
  }, async (req, reply) => {
    const schedule = await createSchedule({ jurisdiction: JURISDICTION, ...(req.body as object) } as never)
    return reply.status(201).send({ schedule })
  })

  fastify.patch('/compliance/schedules/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const schedule = await updateSchedule(id, req.body as never)
    if (!schedule) throw Errors.notFound('schedule')
    return reply.send({ schedule })
  })

  fastify.delete('/compliance/schedules/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = await deleteSchedule(id)
    if (!ok) throw Errors.notFound('schedule')
    return reply.status(204).send()
  })
}

export default compliancePlugin
