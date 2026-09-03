import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../blnk/auth'
import { listPeople } from '../db/queries/people'
import { listAssets } from '../db/queries/asset'
import type { ComplianceRecord } from '../db/queries/compliance'
import { listOrders, listEnquiries } from '../db/queries/commerce'
import { query } from '../db/pool'
import { config } from '../config'
import { Errors } from '../utils/errors'

// RFC 4180 CSV — wrap field in quotes if it contains comma, quote, or newline.
function field(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}
const row  = (cols: (string | number | boolean | null | undefined)[]) => cols.map(field).join(',')
const csv  = (rows: string[]) => rows.join('\r\n')

function notEnabled(): never {
  throw Errors.notFound('module not enabled')
}

const auth = [verifyBlnkAuth, requireRole('admin', 'super')]

const exportPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /export/people ───────────────────────────────────────────────────
  fastify.get('/export/people', { preHandler: auth }, async (_req, reply) => {
    const people = await listPeople({})
    const header = row(['id', 'name', 'email', 'phone', 'active', 'modules', 'created_at'])
    const rows   = people.map(p => row([
      p.id, p.name, p.email, p.phone, p.active,
      p.modules.map(m => `${m.module}:${m.role}`).join(';'),
      p.created_at,
    ]))
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="people.csv"')
      .send(csv([header, ...rows]))
  })

  // ── GET /export/assets ───────────────────────────────────────────────────
  fastify.get('/export/assets', { preHandler: auth }, async (_req, reply) => {
    if (!config.features.asset) notEnabled()
    const assets = await listAssets()
    const header = row(['id', 'name', 'status', 'location', 'condition', 'supplier',
      'date_purchased', 'mnz_number', 'mmsi', 'call_sign', 'notes', 'particulars'])
    const rows = assets.map(a => row([
      a.id, a.name, a.status, a.location, a.condition, a.supplier,
      a.date_purchased, a.mnz_number, a.mmsi, a.call_sign, a.notes,
      JSON.stringify(a.particulars ?? {}),
    ]))
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="assets.csv"')
      .send(csv([header, ...rows]))
  })

  // ── GET /export/compliance ───────────────────────────────────────────────
  fastify.get('/export/compliance', { preHandler: auth }, async (_req, reply) => {
    if (!config.features.compliance) notEnabled()
    // ponytail: raw query — listRecords always excludes voided; export must include them
    const records = await query<ComplianceRecord>('SELECT * FROM compliance_records ORDER BY datetime DESC')
    const header = row(['id', 'datetime', 'record_type', 'jurisdiction', 'result',
      'entered_by', 'site_id', 'schedule_id', 'data', 'attachment_url',
      'voided_at', 'created_at'])
    const rows = records.map(r => row([
      r.id, r.datetime, r.record_type, r.jurisdiction, r.result,
      r.entered_by, r.site_id, r.schedule_id,
      JSON.stringify(r.data),
      r.attachment_url, r.voided_at, r.created_at,
    ]))
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="compliance-records.csv"')
      .send(csv([header, ...rows]))
  })

  // ── GET /export/orders ───────────────────────────────────────────────────
  fastify.get('/export/orders', { preHandler: auth }, async (_req, reply) => {
    if (!config.features.commerce) notEnabled()
    const orders = await listOrders()
    const header = row(['order_ref', 'name', 'email', 'phone',
      'shipping_address', 'items', 'total_cents', 'currency',
      'payment_status', 'fulfillment_status',
      'packed_at', 'fulfilled_at', 'created_at'])
    const rows = orders.map(o => row([
      o.order_ref, o.name, o.email, o.phone,
      JSON.stringify(o.shipping_address),
      JSON.stringify(o.items),
      o.total_cents,
      config.stripe.currency.toUpperCase(),
      o.payment_status, o.fulfillment_status,
      o.packed_at, o.fulfilled_at, o.created_at,
    ]))
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="orders.csv"')
      .send(csv([header, ...rows]))
  })

  // ── GET /export/enquiries ────────────────────────────────────────────────
  fastify.get('/export/enquiries', { preHandler: auth }, async (_req, reply) => {
    if (!config.features.commerce) notEnabled()
    const enquiries = await listEnquiries()
    const header = row(['enquiry_ref', 'name', 'email', 'subject', 'message', 'created_at'])
    const rows = enquiries.map(e => row([
      e.enquiry_ref, e.name, e.email, e.subject, e.message, e.created_at,
    ]))
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="enquiries.csv"')
      .send(csv([header, ...rows]))
  })
}

export default exportPlugin
