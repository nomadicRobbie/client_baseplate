import type { FastifyPluginAsync } from 'fastify'
import type { FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { v2 as cloudinary } from 'cloudinary'
import { verifyBlnkAuth, requireRole, requireModule } from '../../blnk/auth'
import { Errors } from '../../utils/errors'
import { config } from '../../config'
import { getPersonByUserId, getPushTokensForModules } from '../../db/queries/people'
import { sendPush } from '../../utils/push'
import { buildUpcoming } from './upcoming'
import * as q from '../../db/queries/asset'

const UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB

// Asset management module. Guard policy mirrors compliance:
//   member = anyone assigned to the asset module (admins bypass) — view + log
//   admin  = platform admin/super — fleet setup & config
const assetPlugin: FastifyPluginAsync = async (fastify) => {
  const member = [verifyBlnkAuth, requireModule('asset')]
  const admin = [verifyBlnkAuth, requireRole('admin', 'super')]

  // ── Document upload ────────────────────────────────────────────────────────
  // PDF or image (WOF sheets, inspection reports, etc.) stored in Cloudinary.
  await fastify.register(async (sub) => {
    await sub.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })
    cloudinary.config({ cloud_name: config.cloudinary.cloudName, api_key: config.cloudinary.apiKey, api_secret: config.cloudinary.apiSecret })
    sub.post('/asset/documents/upload', { preHandler: admin }, async (req, reply) => {
      const data = await req.file()
      if (!data) throw Errors.badRequest('no file received')
      if (!UPLOAD_MIME.has(data.mimetype)) throw Errors.badRequest('only PDF and images are accepted')
      const buffer = await data.toBuffer()
      const result = await new Promise<{ secure_url: string }>((resolve, reject) =>
        cloudinary.uploader.upload_stream(
          { folder: `${config.tenantSlug}/asset-docs`, resource_type: 'auto' },
          (err, res) => err || !res ? reject(err ?? new Error('upload failed')) : resolve(res as { secure_url: string }),
        ).end(buffer),
      )
      return reply.status(201).send({ url: result.secure_url })
    })
  })
  const uid = (req: { user?: { userId: string } | null }) => req.user?.userId ?? null
  // The caller's people.id (person FKs like reported_by/completed_by point at
  // people, NOT the blnk user id). Null when the signed-in user isn't on the roster.
  const myPersonId = async (req: FastifyRequest): Promise<string | null> => {
    const id = req.user?.userId
    return id ? (await getPersonByUserId(id))?.id ?? null : null
  }

  // ── Asset types ────────────────────────────────────────────────────────────
  fastify.get('/asset/asset-types', { preHandler: member }, async (_req, reply) =>
    reply.send({ asset_types: await q.listAssetTypes() }))
  fastify.post('/asset/asset-types', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, image_url: { type: ['string', 'null'] }, roles: { type: 'array', items: { type: 'string' } }, fields: { type: 'array' } } } },
  }, async (req, reply) => reply.status(201).send({ asset_type: await q.createAssetType(req.body as never) }))
  fastify.patch('/asset/asset-types/:id', { preHandler: admin }, async (req, reply) => {
    const at = await q.updateAssetType((req.params as { id: string }).id, req.body as object)
    if (!at) throw Errors.notFound('asset type')
    return reply.send({ asset_type: at })
  })
  fastify.delete('/asset/asset-types/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (await q.assetTypeInUse(id)) throw Errors.badRequest('asset type is in use — reassign or delete its assets first')
    await q.deleteAssetType(id)
    return reply.status(204).send()
  })

  // ── Assets ─────────────────────────────────────────────────────────────────
  fastify.get('/asset/assets', { preHandler: member }, async (_req, reply) =>
    reply.send({ assets: await q.listAssets() }))
  fastify.get('/asset/assets/:id', { preHandler: member }, async (req, reply) => {
    const asset = await q.getAsset((req.params as { id: string }).id)
    if (!asset) throw Errors.notFound('asset')
    return reply.send({ asset })
  })
  fastify.post('/asset/assets', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['asset_type_id', 'name'], properties: {
      asset_type_id: { type: 'string' }, name: { type: 'string', minLength: 1 }, parent_asset_id: { type: ['string', 'null'] },
      mnz_number: {}, mmsi: {}, call_sign: {}, fuel_capacity: {}, refuel_threshold: {}, location: {}, condition: {}, supplier: {}, date_purchased: {}, image_url: {}, notes: {}, particulars: { type: 'object' },
    } } },
  }, async (req, reply) => reply.status(201).send({ asset: await q.createAsset(req.body as never, uid(req)) }))
  fastify.patch('/asset/assets/:id', { preHandler: admin }, async (req, reply) => {
    const asset = await q.updateAsset((req.params as { id: string }).id, req.body as object, uid(req))
    if (!asset) throw Errors.notFound('asset')
    return reply.send({ asset })
  })
  fastify.delete('/asset/assets/:id', { preHandler: admin }, async (req, reply) => {
    const asset = await q.getAsset((req.params as { id: string }).id)
    if (!asset || asset.status === 'deleted') throw Errors.notFound('asset')
    await q.softDeleteAsset(asset.id, uid(req))
    return reply.status(204).send()
  })

  // ── Components ─────────────────────────────────────────────────────────────
  fastify.get('/asset/components', { preHandler: member }, async (req, reply) =>
    reply.send({ components: await q.listComponents((req.query as { asset_id?: string }).asset_id) }))
  fastify.post('/asset/components', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['asset_id', 'name'], properties: {
      asset_id: { type: 'string' }, name: { type: 'string', minLength: 1 }, parent_component_id: { type: ['string', 'null'] },
      category: {}, quantity: {}, serial_number: {}, model: {}, manufacturer: {}, install_date: {}, critical_component: {}, notes: {},
    } } },
  }, async (req, reply) => reply.status(201).send({ component: await q.createComponent(req.body as never, uid(req)) }))
  fastify.patch('/asset/components/:id', { preHandler: admin }, async (req, reply) => {
    const c = await q.updateComponent((req.params as { id: string }).id, req.body as object, uid(req))
    if (!c) throw Errors.notFound('component')
    return reply.send({ component: c })
  })

  // ── Assignments (person ↔ asset) ───────────────────────────────────────────
  fastify.get('/asset/assignments', { preHandler: member }, async (req, reply) => {
    const { asset_id, person_id } = req.query as { asset_id?: string; person_id?: string }
    return reply.send({ assignments: await q.listAssignments({ asset_id, person_id }) })
  })
  fastify.put('/asset/assignments', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['person_id', 'asset_id'], properties: {
      person_id: { type: 'string' }, asset_id: { type: 'string' }, role: { type: ['string', 'null'] },
    } } },
  }, async (req, reply) => reply.send({ assignment: await q.upsertAssignment(req.body as never) }))
  fastify.delete('/asset/assignments/:id', { preHandler: admin }, async (req, reply) => {
    const ok = await q.deleteAssignment((req.params as { id: string }).id)
    if (!ok) throw Errors.notFound('assignment')
    return reply.status(204).send()
  })

  // ── Faults ─────────────────────────────────────────────────────────────────
  fastify.get('/asset/faults', { preHandler: member }, async (req, reply) => {
    const { asset_id, status } = req.query as { asset_id?: string; status?: string }
    return reply.send({ faults: await q.listFaults({ asset_id, status }) })
  })
  fastify.get('/asset/faults/:id', { preHandler: member }, async (req, reply) => {
    const fault = await q.getFault((req.params as { id: string }).id)
    if (!fault) throw Errors.notFound('fault')
    return reply.send({ fault })
  })
  // Log Fault — reported_by defaults to the caller's person id if not given.
  fastify.post('/asset/faults', {
    preHandler: member,
    schema: { body: { type: 'object', required: ['asset_id', 'name'], properties: {
      asset_id: { type: 'string' }, name: { type: 'string', minLength: 1 }, component_id: { type: ['string', 'null'] },
      description: {}, image_urls: { type: 'array', items: { type: 'string' } }, urgency: {}, reported_by: {}, assigned_to: {},
      idempotency_key: { type: 'string' },   // offline outbox replay key (optional)
    } } },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    if (body.reported_by === undefined) body.reported_by = await myPersonId(req)
    const fault = await q.createFault(body as never, uid(req))
    if (fault) {
      const [asset, reporter, tokens] = await Promise.all([
        q.getAsset(fault.asset_id),
        getPersonByUserId(req.user!.userId),
        getPushTokensForModules(['asset']),
      ])
      sendPush(
        tokens,
        'New fault logged',
        `${reporter?.name ?? 'Someone'} logged "${fault.name}" on ${asset?.name ?? 'an asset'}`,
        { route: `/dashboard/asset/${fault.asset_id}/faults` },
      )
    }
    return reply.status(201).send({ fault })
  })
  // Triage only (assign / urgency). Closing is a deliberate action — use /close
  // (with a note) or a maintenance record; you can't just flip status to closed.
  fastify.patch('/asset/faults/:id', { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { status?: string }
    if (body.status === 'closed') {
      throw Errors.badRequest('close a fault with a note (POST /close) or a maintenance record')
    }
    const fault = await q.updateFault(id, body, uid(req))
    if (!fault) throw Errors.notFound('fault')
    return reply.send({ fault })
  })

  // Add a resolution step — a progress note (e.g. "part ordered"). Fault stays open.
  fastify.post('/asset/faults/:id/steps', {
    preHandler: member,
    schema: { body: { type: 'object', required: ['note'], properties: {
      note: { type: 'string', minLength: 1 }, idempotency_key: { type: 'string' },
    } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { note: string; idempotency_key?: string };
    if (!(await q.getFault(id))) throw Errors.notFound('fault');
    const step = await q.addFaultStep({ fault_id: id, note: b.note, kind: 'step', idempotency_key: b.idempotency_key }, uid(req));
    return reply.status(201).send({ step });
  })

  // Close a fault WITH A NOTE — no maintenance record required. Records a 'close'
  // step. (Closing with a maintenance record still goes via POST /maintenance-logs;
  // an incident-based close lands when the incidents module ships.)
  fastify.post('/asset/faults/:id/close', {
    preHandler: member,
    schema: { body: { type: 'object', required: ['resolution_notes'], properties: {
      resolution_notes: { type: 'string', minLength: 1 }, idempotency_key: { type: 'string' },
    } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { resolution_notes: string; idempotency_key?: string };
    if (!(await q.getFault(id))) throw Errors.notFound('fault');
    await q.addFaultStep({ fault_id: id, note: b.resolution_notes, kind: 'close', idempotency_key: b.idempotency_key }, uid(req));
    const fault = await q.closeFault(id, b.resolution_notes, uid(req));
    return reply.send({ fault });
  })

  // ── Coming up — derived due/overdue services for the dashboard ─────────────
  fastify.get('/asset/upcoming', { preHandler: member }, async (req, reply) => {
    const { asset_id, as_of } = req.query as { asset_id?: string; as_of?: string }
    return reply.send({ items: await buildUpcoming(asset_id, as_of) })
  })

  // ── Maintenance schedules ──────────────────────────────────────────────────
  fastify.get('/asset/maintenance-schedules', { preHandler: member }, async (req, reply) =>
    reply.send({ schedules: await q.listSchedules((req.query as { asset_id?: string }).asset_id) }))
  fastify.post('/asset/maintenance-schedules', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['asset_id', 'task_name'], properties: {
      asset_id: { type: 'string' }, task_name: { type: 'string', minLength: 1 }, component_id: { type: ['string', 'null'] },
      interval_type: {}, interval_value: {}, initial_due_date: {}, alert_days: {}, alert_hours: {},
      alerts: { type: 'array', items: { type: 'object', properties: { value: { type: 'number' }, unit: { type: 'string' } } } },
      task_notes: { type: ['string', 'null'] },
      document_urls: { type: 'array', items: { type: 'string' } },
      form_schema: { type: ['object', 'null'] },
    } } },
  }, async (req, reply) => reply.status(201).send({ schedule: await q.createSchedule(req.body as never, uid(req)) }))
  fastify.patch('/asset/maintenance-schedules/:id', { preHandler: admin }, async (req, reply) => {
    const s = await q.updateSchedule((req.params as { id: string }).id, req.body as object, uid(req))
    if (!s) throw Errors.notFound('maintenance schedule')
    return reply.send({ schedule: s })
  })

  // ── Maintenance logs — Complete Maintenance ────────────────────────────────
  // Append-only evidence. If it resolves a fault, that fault is closed here — the
  // maintenance log IS the closure evidence the fault-close guard looks for.
  fastify.get('/asset/maintenance-logs', { preHandler: member }, async (req, reply) => {
    const { asset_id, fault_id } = req.query as { asset_id?: string; fault_id?: string }
    return reply.send({ logs: await q.listLogs({ asset_id, fault_id }) })
  })
  fastify.post('/asset/maintenance-logs', {
    preHandler: member,
    schema: { body: { type: 'object', required: ['asset_id'], properties: {
      asset_id: { type: 'string' }, schedule_id: { type: ['string', 'null'] }, fault_id: { type: ['string', 'null'] }, component_id: { type: ['string', 'null'] },
      task_name: {}, maintenance_type: {}, completed_date: {}, usage_at_service: {}, supplier: {},
      image_urls: { type: 'array', items: { type: 'string' } }, resolves_fault: { type: 'boolean' }, resolution_notes: {}, notes: {}, completed_by: {},
      form_data: { type: ['object', 'null'] },
      attachments: { type: 'array', items: { type: 'string' } },
      idempotency_key: { type: 'string' },   // offline outbox replay key (optional)
    } } },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    if (body.completed_by === undefined) body.completed_by = await myPersonId(req)
    const log = await q.createLog(body as never, uid(req))
    if (!log) throw Errors.internal('could not create maintenance log')
    let fault_closed = false
    if (log.resolves_fault && log.fault_id) {
      const ik = body.idempotency_key as string | undefined
      const note = `Resolved via maintenance${log.task_name ? `: ${log.task_name}` : ''}`
      await q.addFaultStep({ fault_id: log.fault_id, note, kind: 'close', idempotency_key: ik ? ik + ':step' : undefined }, uid(req))
      await q.closeFault(log.fault_id, note, uid(req))
      fault_closed = true
    }
    // Notify asset module members of the completed maintenance.
    const [asset, completer, tokens] = await Promise.all([
      q.getAsset(log.asset_id),
      getPersonByUserId(req.user!.userId),
      getPushTokensForModules(['asset']),
    ])
    sendPush(
      tokens,
      'Maintenance completed',
      `${completer?.name ?? 'Someone'} logged maintenance on ${asset?.name ?? 'an asset'}${log.task_name ? `: ${log.task_name}` : ''}`,
      { route: `/dashboard/asset/${log.asset_id}/maintenance` },
    )
    return reply.status(201).send({ log, fault_closed })
  })
}

export default assetPlugin
