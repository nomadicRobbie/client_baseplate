import { query, getPool } from '../pool'
import type {
  ServiceTemplate, ScheduledService, ServiceAssignment,
  ServiceManifest, AvailabilitySlot, FeedItem, RecurrencePattern, RequiredRole,
} from '@blnk/shared'

// ── Generic allow-listed partial update (mirrors asset.ts pattern) ────────────
async function patch<T>(
  table: string, id: string, allowed: readonly string[], body: Record<string, unknown>, updatedBy?: string | null,
): Promise<T | null> {
  const cols: string[] = []; const vals: unknown[] = []; let i = 1
  for (const k of allowed) if (body[k] !== undefined) { cols.push(`${k} = $${i++}`); vals.push(body[k]) }
  if (updatedBy !== undefined) { cols.push(`updated_by = $${i++}`); vals.push(updatedBy) }
  if (cols.length === 0) { const r = await query<T & { id: string }>(`SELECT * FROM ${table} WHERE id = $1`, [id]); return (r[0] as T) ?? null }
  cols.push('updated_at = now()'); vals.push(id)
  const r = await query<T & { id: string }>(`UPDATE ${table} SET ${cols.join(', ')} WHERE id = $${i} RETURNING *`, vals)
  return (r[0] as T) ?? null
}
const one = async <T>(sql: string, params: unknown[]): Promise<T | null> =>
  (await query<T & object>(sql, params))[0] as T ?? null

// ── Templates ─────────────────────────────────────────────────────────────────
export const listTemplates = (active?: boolean) =>
  query<ServiceTemplate>(
    `SELECT * FROM service_templates WHERE ($1::boolean IS NULL OR active = $1) ORDER BY name`,
    [active ?? null],
  )

export const getTemplate = (id: string) =>
  one<ServiceTemplate>(`SELECT * FROM service_templates WHERE id = $1`, [id])

export const createTemplate = (d: Record<string, unknown>, createdBy: string | null) =>
  one<ServiceTemplate>(
    `INSERT INTO service_templates
       (name, duration_minutes, default_capacity, location_label, timezone,
        required_roles, required_asset_types, recurrence, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),$10) RETURNING *`,
    [d.name, d.duration_minutes, d.default_capacity ?? 0, d.location_label ?? null,
     d.timezone, JSON.stringify(d.required_roles ?? []), JSON.stringify(d.required_asset_types ?? []),
     d.recurrence ? JSON.stringify(d.recurrence) : null, d.active ?? null, createdBy],
  )

const TEMPLATE_COLS = ['name', 'duration_minutes', 'default_capacity', 'location_label', 'timezone', 'required_roles', 'required_asset_types', 'recurrence', 'active'] as const
export const updateTemplate = (id: string, body: object) =>
  patch<ServiceTemplate>('service_templates', id, TEMPLATE_COLS, body as never)

// ── Services ──────────────────────────────────────────────────────────────────
export interface ServiceFilters {
  from: string; to: string; status?: string[]; template_id?: string
  // When set, restricts to services where this person has an active assignment.
  person_id?: string
}

export const listServices = (f: ServiceFilters) =>
  query<ScheduledService>(
    `SELECT * FROM scheduled_services s
     WHERE starts_at >= $1 AND starts_at < $2
       AND ($3::text[] IS NULL OR status = ANY($3::service_status_enum[]))
       AND ($4::uuid IS NULL OR template_id = $4)
       AND ($5::uuid IS NULL OR EXISTS (
         SELECT 1 FROM service_assignments sa
         WHERE sa.service_id = s.id AND sa.subject_id = $5
           AND sa.subject_type = 'person' AND sa.removed_at IS NULL
       ))
     ORDER BY starts_at`,
    [f.from, f.to, f.status?.length ? f.status : null, f.template_id ?? null, f.person_id ?? null],
  )

export const getService = (id: string) =>
  one<ScheduledService>(`SELECT * FROM scheduled_services WHERE id = $1`, [id])

export const createService = (d: Record<string, unknown>, createdBy: string | null) =>
  one<ScheduledService>(
    `INSERT INTO scheduled_services
       (id, template_id, name, starts_at, ends_at, timezone, location_label,
        capacity, required_roles, status, external_ref, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'draft')::service_status_enum,$11,COALESCE($12,''),$13) RETURNING *`,
    [d.id, d.template_id ?? null, d.name, d.starts_at, d.ends_at, d.timezone,
     d.location_label ?? null, d.capacity ?? 0, JSON.stringify(d.required_roles ?? []),
     d.status ?? null, d.external_ref ?? null, d.notes ?? null, createdBy],
  )

// Version-guarded update — WHERE includes version so a stale version returns null (caller 409s).
export async function updateService(
  id: string,
  body: Partial<Pick<ScheduledService, 'name' | 'starts_at' | 'ends_at' | 'timezone' | 'location_label' | 'capacity' | 'notes' | 'status' | 'external_ref'>>,
  currentVersion: number,
  updatedBy: string | null,
): Promise<ScheduledService | null> {
  const allowed = ['name', 'starts_at', 'ends_at', 'timezone', 'location_label', 'capacity', 'notes', 'status', 'external_ref'] as const
  const cols: string[] = []; const vals: unknown[] = []; let i = 1
  for (const k of allowed) if ((body as Record<string, unknown>)[k] !== undefined) { cols.push(`${k} = $${i++}`); vals.push((body as Record<string, unknown>)[k]) }
  if (cols.length === 0) return getService(id)
  cols.push(`updated_by = $${i++}`, `updated_at = now()`, `version = version + 1`)
  vals.push(updatedBy, id, currentVersion)
  const r = await query<ScheduledService>(
    `UPDATE scheduled_services SET ${cols.join(', ')} WHERE id = $${i++} AND version = $${i} RETURNING *`, vals,
  )
  return r[0] ?? null
}

export const cancelService = (id: string, reason: string, updatedBy: string | null) =>
  one<ScheduledService>(
    `UPDATE scheduled_services
     SET status = 'cancelled', cancellation_reason = $2, updated_by = $3, updated_at = now(), version = version + 1
     WHERE id = $1 AND status <> 'cancelled' RETURNING *`,
    [id, reason, updatedBy],
  )

// ── Generate instances (idempotent) ──────────────────────────────────────────
// Expands a template's recurrence pattern between from/to (YYYY-MM-DD), inserting
// one row per matching day. ON CONFLICT skips already-existing rows. DST-safe:
// PostgreSQL parses the local datetime string using the stored IANA timezone.
export async function generateInstances(
  templateId: string,
  from: string,
  to: string,
): Promise<{ created: number; skipped: number }> {
  const template = await getTemplate(templateId)
  if (!template || !template.recurrence || !template.active) return { created: 0, skipped: 0 }

  const rec = template.recurrence as RecurrencePattern
  const days = new Set(rec.days)
  const time = rec.time  // 'HH:MM'

  // Build list of matching dates between from (inclusive) and to (exclusive).
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor < end) {
    const dayOfWeek = cursor.getUTCDay()
    if (days.has(dayOfWeek)) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  if (dates.length === 0) return { created: 0, skipped: 0 }

  const client = await getPool().connect()
  let created = 0
  try {
    await client.query('BEGIN')
    for (const date of dates) {
      // DST-safe: cast local datetime string to timestamp then AT TIME ZONE converts
      // to UTC using the IANA zone — so a 9am NZ service stays 9am local even when
      // the clocks move.
      const res = await client.query(
        `INSERT INTO scheduled_services
           (id, template_id, name, starts_at, ends_at, timezone, location_label,
            capacity, required_roles, status)
         VALUES (
           gen_random_uuid(), $1, $2,
           ($3 || ' ' || $4)::timestamp AT TIME ZONE $5,
           ($3 || ' ' || $4)::timestamp AT TIME ZONE $5 + ($6 || ' minutes')::interval,
           $5, $7, $8, $9, 'planned'::service_status_enum
         )
         ON CONFLICT (template_id, starts_at) WHERE template_id IS NOT NULL DO NOTHING`,
        [template.id, template.name, date, time, template.timezone,
         template.duration_minutes.toString(), template.location_label ?? null,
         template.default_capacity, JSON.stringify(template.required_roles)],
      )
      created += res.rowCount ?? 0
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { created, skipped: dates.length - created }
}

// ── Assignments ───────────────────────────────────────────────────────────────
export const getAssignments = (serviceId: string) =>
  query<ServiceAssignment>(
    `SELECT * FROM service_assignments WHERE service_id = $1 AND removed_at IS NULL ORDER BY assigned_at`,
    [serviceId],
  )

export const addAssignment = (d: { service_id: string; subject_type: string; subject_id: string; role?: string | null }, assignedBy: string | null) =>
  one<ServiceAssignment>(
    `INSERT INTO service_assignments (service_id, subject_type, subject_id, role, assigned_by)
     VALUES ($1,$2::service_subject_type_enum,$3,$4,$5) RETURNING *`,
    [d.service_id, d.subject_type, d.subject_id, d.role ?? null, assignedBy],
  )

export const removeAssignment = async (id: string, removedBy: string | null): Promise<boolean> =>
  (await query<{ id: string }>(
    `UPDATE service_assignments SET removed_at = now(), removed_by = $2 WHERE id = $1 AND removed_at IS NULL RETURNING id`,
    [id, removedBy],
  )).length > 0

// ── Events (append-only — no read endpoint at launch) ────────────────────────
export async function appendEvent(d: {
  service_id: string; event_type: string; payload?: Record<string, unknown>; actor_id?: string | null
}): Promise<void> {
  await query(
    `INSERT INTO scheduled_service_events (service_id, event_type, payload, actor_id)
     VALUES ($1,$2::service_event_type_enum,$3,$4)`,
    [d.service_id, d.event_type, JSON.stringify(d.payload ?? {}), d.actor_id ?? null],
  )
}

// ── Manifest ──────────────────────────────────────────────────────────────────
// Assembled read model: service + crew (from people) + assets (from assets).
// Single query — no N+1. Safe to cache on the client.
export async function getManifest(id: string): Promise<ServiceManifest | null> {
  const service = await getService(id)
  if (!service) return null

  const rows = await query<{
    assignment_id: string; subject_type: string; subject_id: string; role: string | null
    name: string
  }>(
    `SELECT
       sa.id AS assignment_id, sa.subject_type, sa.subject_id, sa.role,
       COALESCE(p.name, a.name, 'Unknown') AS name
     FROM service_assignments sa
     LEFT JOIN people p ON sa.subject_type = 'person' AND p.id = sa.subject_id
     LEFT JOIN assets a ON sa.subject_type = 'asset'  AND a.id = sa.subject_id
     WHERE sa.service_id = $1 AND sa.removed_at IS NULL
     ORDER BY sa.assigned_at`,
    [id],
  )

  const crew = rows.filter(r => r.subject_type === 'person').map(r => ({
    assignment_id: r.assignment_id, person_id: r.subject_id, name: r.name, role: r.role,
  }))
  const assets = rows.filter(r => r.subject_type === 'asset').map(r => ({
    assignment_id: r.assignment_id, asset_id: r.subject_id, name: r.name, role: r.role,
  }))

  return { service, crew, assets }
}

// ── Sync ──────────────────────────────────────────────────────────────────────
export const syncServices = (since: string, from: string, to: string, personId?: string) =>
  query<ScheduledService>(
    `SELECT * FROM scheduled_services s
     WHERE updated_at > $1 AND starts_at >= $2 AND starts_at < $3
       AND ($4::uuid IS NULL OR EXISTS (
         SELECT 1 FROM service_assignments sa
         WHERE sa.service_id = s.id AND sa.subject_id = $4
           AND sa.subject_type = 'person' AND sa.removed_at IS NULL
       ))
     ORDER BY starts_at`,
    [since, from, to, personId ?? null],
  )

// ── Availability ──────────────────────────────────────────────────────────────
export async function getAvailability(from: string, to: string): Promise<AvailabilitySlot[]> {
  const rows = await query<{
    service_id: string; starts_at: string; capacity: string; assigned_count: string
  }>(
    `SELECT s.id AS service_id, s.starts_at, s.capacity,
       COUNT(sa.id) FILTER (WHERE sa.removed_at IS NULL) AS assigned_count
     FROM scheduled_services s
     LEFT JOIN service_assignments sa ON sa.service_id = s.id AND sa.subject_type = 'person'
     WHERE s.starts_at >= $1 AND s.starts_at < $2 AND s.status NOT IN ('cancelled','completed')
     GROUP BY s.id
     ORDER BY s.starts_at`,
    [from, to],
  )
  return rows.map(r => ({
    service_id: r.service_id,
    starts_at: r.starts_at,
    capacity: parseInt(r.capacity, 10),
    assigned_count: parseInt(r.assigned_count, 10),
    remaining: Math.max(0, parseInt(r.capacity, 10) - parseInt(r.assigned_count, 10)),
  }))
}

// ── Feed helper ───────────────────────────────────────────────────────────────
// Returns actionable feed cards: services starting within 24h that have unfilled
// required roles. Healthy fully-staffed services do not appear.
export async function buildTodayServices(): Promise<FeedItem[]> {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const services = await query<ScheduledService & { assigned_count: string }>(
    `SELECT s.*,
       COUNT(sa.id) FILTER (WHERE sa.removed_at IS NULL AND sa.subject_type = 'person') AS assigned_count
     FROM scheduled_services s
     LEFT JOIN service_assignments sa ON sa.service_id = s.id
     WHERE s.starts_at >= $1 AND s.starts_at < $2 AND s.status IN ('draft','planned','confirmed')
     GROUP BY s.id
     ORDER BY s.starts_at`,
    [now.toISOString(), in24h.toISOString()],
  )

  const items: FeedItem[] = []
  for (const s of services) {
    const assignedCount = parseInt(s.assigned_count, 10)
    const requiredTotal = (s.required_roles as RequiredRole[]).reduce((n, r) => n + r.count, 0)
    // ponytail: simple check — if total assigned < total required, surface all roles as unfilled
    const unfilledRoles = requiredTotal > assignedCount ? (s.required_roles as RequiredRole[]) : []

    // Only surface if there's a gap or the service is unconfirmed
    if (assignedCount >= requiredTotal && s.status === 'confirmed') continue

    items.push({
      kind: 'service',
      module: 'schedule',
      created_at: s.starts_at,
      data: {
        service_id: s.id,
        name: s.name,
        starts_at: s.starts_at,
        timezone: s.timezone,
        location_label: s.location_label ?? null,
        status: s.status,
        capacity: s.capacity,
        assigned_count: assignedCount,
        unfilled_roles: unfilledRoles,
      },
    })
  }
  return items
}
