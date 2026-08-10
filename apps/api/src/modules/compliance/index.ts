import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole, requireModule } from '../../blnk/auth'
import { Errors } from '../../utils/errors'
import { evaluate } from './engine'
import { isDueOn } from './schedule'
import {
  listRecordTypes, getRecordType,
  createRecord, getRecord, listRecords, updateRecord, voidRecord,
  listSuppliers, createSupplier, updateSupplier,
  listSites, createSite, updateSite,
  listSchedules, listActiveSchedules, createSchedule, updateSchedule, deleteSchedule, scheduleDoneCounts,
  createCoolingBatch, listActiveCoolingBatches, getCoolingBatch, updateCoolingBatch,
  type RecordFilters, type ComplianceRecord,
} from '../../db/queries/compliance'

// Single jurisdiction per deploy for now — the tenant's country.
// ponytail: const, not config; add an env/tenant field when a deploy serves
// multiple countries (registry + engine already handle it via seed data).
const JURISDICTION = 'NZ'

// Log a record: evaluate its limit, persist it, and on a fail auto-raise a
// linked corrective action. Shared by POST /records and cooling finalize.
type LogInput = {
  record_type: string; site_id?: string | null; entered_by: string; created_by?: string | null;
  datetime?: string | null; data?: Record<string, unknown>;
  attachment_url?: string | null; corrective_action_id?: string | null; schedule_id?: string | null;
}
async function logRecord(input: LogInput): Promise<{ record: ComplianceRecord; corrective_action: ComplianceRecord | null }> {
  const type = await getRecordType(JURISDICTION, input.record_type)
  if (!type) throw Errors.notFound('record type')
  const data = input.data ?? {}
  const result = evaluate(type.critical_limit as never, data)
  const record = await createRecord({
    jurisdiction: JURISDICTION,
    record_type: input.record_type,
    site_id: input.site_id ?? null,
    entered_by: input.entered_by,
    created_by: input.created_by ?? null,
    datetime: input.datetime ?? undefined,
    result,
    data,
    corrective_action_id: input.corrective_action_id ?? null,
    attachment_url: input.attachment_url ?? null,
    schedule_id: input.schedule_id ?? null,
  })
  let corrective_action: ComplianceRecord | null = null
  if (result === 'fail' && input.record_type !== 'corrective_action' && !record.corrective_action_id) {
    corrective_action = await createRecord({
      jurisdiction: JURISDICTION, record_type: 'corrective_action', site_id: record.site_id,
      entered_by: input.entered_by, created_by: input.created_by ?? null, result: 'na',
      data: { what_went_wrong: `${type.label} check failed`, affected: '' },
    })
    await updateRecord(record.id, { corrective_action_id: corrective_action.id })
    record.corrective_action_id = corrective_action.id
  }
  return { record, corrective_action }
}

const compliancePlugin: FastifyPluginAsync = async (fastify) => {
  // ── Record types — drives the forms (any authed staff) ────────────────────
  fastify.get('/compliance/record-types', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (req, reply) => {
    const { tier } = req.query as { tier?: string }
    return reply.send({ record_types: await listRecordTypes(JURISDICTION, tier) })
  })

  // ── Create a record — engine sets pass/fail; a fail spawns a linked CA ─────
  fastify.post('/compliance/records', {
    preHandler: [verifyBlnkAuth, requireModule('compliance')],
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
    const b = req.body as LogInput
    const { record, corrective_action } = await logRecord({ ...b, created_by: req.user?.userId ?? null })
    return reply.status(201).send({ record, corrective_action })
  })

  // ── List / filter records ─────────────────────────────────────────────────
  fastify.get('/compliance/records', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (req, reply) => {
    const q = req.query as RecordFilters
    return reply.send({ records: await listRecords(q) })
  })

  // ── One record ────────────────────────────────────────────────────────────
  fastify.get('/compliance/records/:id', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const record = await getRecord(id)
    if (!record) throw Errors.notFound('record')
    return reply.send({ record })
  })

  // ── Edit a record (e.g. fill in a corrective action). Re-evaluates result ──
  fastify.patch('/compliance/records/:id', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (req, reply) => {
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
  fastify.get('/compliance/suppliers', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (_req, reply) => {
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
  fastify.get('/compliance/sites', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (_req, reply) => {
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
  fastify.get('/compliance/schedules', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (_req, reply) => {
    return reply.send({ schedules: await listSchedules() })
  })

  // What's due on a given local date (?on=YYYY-MM-DD, defaults to server today),
  // with how many of each are already done that day.
  fastify.get('/compliance/schedules/due', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (req, reply) => {
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

  // ── Cooling batches (real-time two-stage cooling monitoring) ──────────────
  // Start a batch — clock starts now (food ~60°C). Surfaces live on Today.
  fastify.post('/compliance/cooling', {
    preHandler: [verifyBlnkAuth, requireModule('compliance')],
    schema: { body: { type: 'object', required: ['product', 'started_by'], properties: {
      product:    { type: 'string', minLength: 1, maxLength: 200 },
      started_by: { type: 'string', minLength: 1 },
      site_id:    { type: ['string', 'null'] },
    } } },
  }, async (req, reply) => {
    const b = req.body as { product: string; started_by: string; site_id?: string | null }
    const batch = await createCoolingBatch({
      jurisdiction: JURISDICTION, product: b.product, site_id: b.site_id ?? null,
      started_by: b.started_by, created_by: req.user?.userId ?? null,
    })
    return reply.status(201).send({ batch })
  })

  fastify.get('/compliance/cooling/active', { preHandler: [verifyBlnkAuth, requireModule('compliance')] }, async (_req, reply) => {
    return reply.send({ batches: await listActiveCoolingBatches() })
  })

  // Mark reaching a stage. stage1 = 21°C; stage2 = 5°C, which finalizes the batch
  // into a `cooling` record (engine checks the 2h/4h limits + auto corrective action).
  fastify.post('/compliance/cooling/:id/reach', {
    preHandler: [verifyBlnkAuth, requireModule('compliance')],
    schema: { body: { type: 'object', required: ['stage'], properties: { stage: { type: 'string', enum: ['stage1', 'stage2'] } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { stage } = req.body as { stage: 'stage1' | 'stage2' }
    const batch = await getCoolingBatch(id)
    if (!batch || batch.status !== 'in_progress') throw Errors.notFound('cooling batch')
    const now = new Date().toISOString()

    if (stage === 'stage1') {
      return reply.send({ batch: await updateCoolingBatch(id, { reached_21_at: now }) })
    }

    // stage2 → finalize
    const reached21 = batch.reached_21_at ?? batch.started_at
    const hrs = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 100) / 100
    const { record, corrective_action } = await logRecord({
      record_type: 'cooling', site_id: batch.site_id, entered_by: batch.started_by, created_by: req.user?.userId ?? null,
      data: { food: batch.product, stage1_hours: hrs(batch.started_at, reached21), stage2_hours: hrs(reached21, now) },
    })
    const updated = await updateCoolingBatch(id, { reached_5_at: now, status: 'done', record_id: record.id })
    return reply.send({ batch: updated, record, corrective_action })
  })

  // Discard (thrown out) — raises a corrective action to complete.
  fastify.post('/compliance/cooling/:id/discard', {
    preHandler: [verifyBlnkAuth, requireModule('compliance')],
    schema: { body: { type: 'object', properties: { reason: { type: 'string' }, entered_by: { type: 'string' } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = req.body as { reason?: string; entered_by?: string }
    const batch = await getCoolingBatch(id)
    if (!batch || batch.status !== 'in_progress') throw Errors.notFound('cooling batch')
    const { record: ca } = await logRecord({
      record_type: 'corrective_action', site_id: batch.site_id, entered_by: b.entered_by ?? batch.started_by,
      created_by: req.user?.userId ?? null,
      data: { what_went_wrong: `Cooling problem — "${batch.product}" did not cool safely${b.reason ? ` (${b.reason})` : ''}`, affected: batch.product },
    })
    const updated = await updateCoolingBatch(id, { status: 'discarded', record_id: ca.id })
    return reply.send({ batch: updated, corrective_action: ca })
  })
}

export default compliancePlugin
