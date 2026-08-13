import { query } from '../pool'

// Vessel module queries (pilot slice — see migration 012_vessel.sql). Person refs
// are people.id. Mirrors the compliance query style: explicit creates, allow-listed
// partial updates, no generic column injection.

// ── Types (mirror the vessel_* tables) ──────────────────────────────────────
export interface AssetType { id: string; name: string; image_url: string | null; created_at: string; updated_at: string }

export interface Asset {
  id: string; asset_type_id: string; parent_asset_id: string | null; name: string
  mnz_number: string | null; mmsi: string | null; call_sign: string | null
  fuel_capacity: string | null; refuel_threshold: string | null
  location: string | null; condition: string | null; supplier: string | null
  date_purchased: string | null; image_url: string | null; notes: string | null; status: string
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
}

export interface Component {
  id: string; asset_id: string; parent_component_id: string | null; name: string
  category: string | null; quantity: string | null; serial_number: string | null
  model: string | null; manufacturer: string | null; install_date: string | null
  critical_component: boolean; notes: string | null; status: string
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
}

export interface Assignment { id: string; person_id: string; asset_id: string; role: string | null; created_at: string }

export interface Fault {
  id: string; asset_id: string; component_id: string | null; name: string; description: string | null
  image_urls: string[]; urgency: string | null; status: string
  reported_by: string | null; reported_date: string; assigned_to: string | null
  resolution_notes: string | null; signed_by: string | null; signed_at: string | null
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
}

export type ScheduleAlert = { value: number; unit: 'hours' | 'days' | 'weeks' }
export interface MaintenanceSchedule {
  id: string; asset_id: string; component_id: string | null; task_name: string
  interval_type: string | null; interval_value: string | null; initial_due_date: string | null
  alert_days: number | null; alert_hours: string | null; alerts: ScheduleAlert[]; active: boolean
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
}

export interface MaintenanceLog {
  id: string; schedule_id: string | null; fault_id: string | null; asset_id: string; component_id: string | null
  task_name: string | null; maintenance_type: string | null; completed_date: string | null
  usage_at_service: string | null; supplier: string | null; image_urls: string[]
  resolves_fault: boolean; resolution_notes: string | null; notes: string | null; status: string
  completed_by: string | null; signed_by: string | null; signed_at: string | null
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
}

// ── Generic allow-listed partial update ─────────────────────────────────────
// `table`/`allowed` are internal string literals (never user input) — safe to
// interpolate. Sets updated_at (+ updated_by when given). Returns the row or null.
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
const one = async <T>(sql: string, params: unknown[]): Promise<T | null> => (await query<T & object>(sql, params))[0] as T ?? null

// ── Asset types ─────────────────────────────────────────────────────────────
export const listAssetTypes = () => query<AssetType>(`SELECT * FROM vessel_asset_types ORDER BY name`)
export const createAssetType = (d: { name: string; image_url?: string | null }) =>
  one<AssetType>(`INSERT INTO vessel_asset_types (name, image_url) VALUES ($1,$2) RETURNING *`, [d.name, d.image_url ?? null])
export const updateAssetType = (id: string, body: object) => patch<AssetType>('vessel_asset_types', id, ['name', 'image_url'], body as never)

// ── Assets ──────────────────────────────────────────────────────────────────
export const listAssets = () => query<Asset>(`SELECT * FROM vessel_assets WHERE status <> 'deleted' ORDER BY name`)
export const getAsset = (id: string) => one<Asset>(`SELECT * FROM vessel_assets WHERE id = $1`, [id])
const ASSET_COLS = ['asset_type_id', 'parent_asset_id', 'name', 'mnz_number', 'mmsi', 'call_sign', 'fuel_capacity', 'refuel_threshold', 'location', 'condition', 'supplier', 'date_purchased', 'image_url', 'notes', 'status'] as const
export const createAsset = (d: Record<string, unknown>, createdBy: string | null) =>
  one<Asset>(
    `INSERT INTO vessel_assets (asset_type_id, name, parent_asset_id, mnz_number, mmsi, call_sign, fuel_capacity, refuel_threshold, location, condition, supplier, date_purchased, image_url, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [d.asset_type_id, d.name, d.parent_asset_id ?? null, d.mnz_number ?? null, d.mmsi ?? null, d.call_sign ?? null, d.fuel_capacity ?? null, d.refuel_threshold ?? null, d.location ?? null, d.condition ?? null, d.supplier ?? null, d.date_purchased ?? null, d.image_url ?? null, d.notes ?? null, createdBy],
  )
export const updateAsset = (id: string, body: object, updatedBy: string | null) => patch<Asset>('vessel_assets', id, ASSET_COLS, body as never, updatedBy)

// ── Components ──────────────────────────────────────────────────────────────
export const listComponents = (assetId?: string) =>
  assetId ? query<Component>(`SELECT * FROM vessel_components WHERE asset_id = $1 AND status <> 'deleted' ORDER BY name`, [assetId])
          : query<Component>(`SELECT * FROM vessel_components WHERE status <> 'deleted' ORDER BY name`)
const COMPONENT_COLS = ['asset_id', 'parent_component_id', 'name', 'category', 'quantity', 'serial_number', 'model', 'manufacturer', 'install_date', 'critical_component', 'notes', 'status'] as const
export const createComponent = (d: Record<string, unknown>, createdBy: string | null) =>
  one<Component>(
    `INSERT INTO vessel_components (asset_id, name, parent_component_id, category, quantity, serial_number, model, manufacturer, install_date, critical_component, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,false),$11,$12) RETURNING *`,
    [d.asset_id, d.name, d.parent_component_id ?? null, d.category ?? null, d.quantity ?? null, d.serial_number ?? null, d.model ?? null, d.manufacturer ?? null, d.install_date ?? null, d.critical_component ?? null, d.notes ?? null, createdBy],
  )
export const updateComponent = (id: string, body: object, updatedBy: string | null) => patch<Component>('vessel_components', id, COMPONENT_COLS, body as never, updatedBy)

// ── Assignments (person ↔ asset) ────────────────────────────────────────────
export const listAssignments = (f: { asset_id?: string; person_id?: string }) =>
  query<Assignment>(
    `SELECT * FROM vessel_asset_assignments
     WHERE ($1::uuid IS NULL OR asset_id = $1) AND ($2::uuid IS NULL OR person_id = $2)`,
    [f.asset_id ?? null, f.person_id ?? null],
  )
export const upsertAssignment = (d: { person_id: string; asset_id: string; role?: string | null }) =>
  one<Assignment>(
    `INSERT INTO vessel_asset_assignments (person_id, asset_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (person_id, asset_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
    [d.person_id, d.asset_id, d.role ?? null],
  )
export const deleteAssignment = async (id: string): Promise<boolean> =>
  (await query<{ id: string }>(`DELETE FROM vessel_asset_assignments WHERE id = $1 RETURNING id`, [id])).length > 0

// ── Faults ──────────────────────────────────────────────────────────────────
export const listFaults = (f: { asset_id?: string; status?: string }) =>
  query<Fault>(
    `SELECT * FROM vessel_faults
     WHERE ($1::uuid IS NULL OR asset_id = $1) AND ($2::text IS NULL OR status = $2)
     ORDER BY reported_date DESC LIMIT 500`,
    [f.asset_id ?? null, f.status ?? null],
  )
export const getFault = (id: string) => one<Fault>(`SELECT * FROM vessel_faults WHERE id = $1`, [id])
// Idempotent on idempotency_key: replaying a queued LogFault returns the existing
// fault instead of duplicating it (ON CONFLICT no-op update + RETURNING). NULL key
// (online request) never conflicts.
export const createFault = (d: Record<string, unknown>, createdBy: string | null) =>
  one<Fault>(
    `INSERT INTO vessel_faults (asset_id, component_id, name, description, image_urls, urgency, reported_by, assigned_to, created_by, idempotency_key)
     VALUES ($1,$2,$3,$4,COALESCE($5::text[],'{}'),$6,$7,$8,$9,$10)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = vessel_faults.updated_at
     RETURNING *`,
    [d.asset_id, d.component_id ?? null, d.name, d.description ?? null, d.image_urls ?? null, d.urgency ?? null, d.reported_by ?? null, d.assigned_to ?? null, createdBy, d.idempotency_key ?? null],
  )
const FAULT_COLS = ['component_id', 'name', 'description', 'image_urls', 'urgency', 'status', 'assigned_to', 'resolution_notes', 'signed_by', 'signed_at'] as const
export const updateFault = (id: string, body: object, updatedBy: string | null) => patch<Fault>('vessel_faults', id, FAULT_COLS, body as never, updatedBy)
export const setFaultStatus = (id: string, status: string, updatedBy: string | null) =>
  patch<Fault>('vessel_faults', id, ['status'], { status }, updatedBy)
// Closure evidence: does this fault have at least one linked maintenance log?
export const faultHasMaintenance = async (faultId: string): Promise<boolean> =>
  (await query<{ id: string }>(`SELECT id FROM vessel_maintenance_logs WHERE fault_id = $1 LIMIT 1`, [faultId])).length > 0

// ── Maintenance schedules ───────────────────────────────────────────────────
export const listSchedules = (assetId?: string) =>
  assetId ? query<MaintenanceSchedule>(`SELECT * FROM vessel_maintenance_schedules WHERE asset_id = $1 AND active ORDER BY task_name`, [assetId])
          : query<MaintenanceSchedule>(`SELECT * FROM vessel_maintenance_schedules WHERE active ORDER BY task_name`)
// Each active schedule + the date it was last completed (max completed_date of its
// maintenance logs). Drives the "next due" derivation for the Coming-up feed.
export interface ScheduleDueRow extends MaintenanceSchedule { last_completed: string | null }
export const schedulesWithLastCompleted = (assetId?: string) =>
  query<ScheduleDueRow>(
    `SELECT s.*, (SELECT max(completed_date) FROM vessel_maintenance_logs l WHERE l.schedule_id = s.id) AS last_completed
     FROM vessel_maintenance_schedules s
     WHERE s.active AND ($1::uuid IS NULL OR s.asset_id = $1)
     ORDER BY s.task_name`,
    [assetId ?? null],
  )

export const createSchedule = (d: Record<string, unknown>, createdBy: string | null) =>
  one<MaintenanceSchedule>(
    `INSERT INTO vessel_maintenance_schedules (asset_id, component_id, task_name, interval_type, interval_value, initial_due_date, alert_days, alert_hours, alerts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [d.asset_id, d.component_id ?? null, d.task_name, d.interval_type ?? null, d.interval_value ?? null, d.initial_due_date ?? null, d.alert_days ?? null, d.alert_hours ?? null, JSON.stringify(d.alerts ?? []), createdBy],
  )
const SCHED_COLS = ['component_id', 'task_name', 'interval_type', 'interval_value', 'initial_due_date', 'alert_days', 'alert_hours', 'active'] as const
export const updateSchedule = (id: string, body: object, updatedBy: string | null) => patch<MaintenanceSchedule>('vessel_maintenance_schedules', id, SCHED_COLS, body as never, updatedBy)

// ── Maintenance logs (append-only evidence) ─────────────────────────────────
export const listLogs = (f: { asset_id?: string; fault_id?: string }) =>
  query<MaintenanceLog>(
    `SELECT * FROM vessel_maintenance_logs
     WHERE ($1::uuid IS NULL OR asset_id = $1) AND ($2::uuid IS NULL OR fault_id = $2)
     ORDER BY completed_date DESC NULLS LAST, created_at DESC LIMIT 500`,
    [f.asset_id ?? null, f.fault_id ?? null],
  )
// Idempotent on idempotency_key — replaying a queued CompleteMaintenance returns
// the existing log instead of duplicating it (the route's fault-close side effect
// is itself idempotent).
export const createLog = (d: Record<string, unknown>, createdBy: string | null) =>
  one<MaintenanceLog>(
    `INSERT INTO vessel_maintenance_logs (schedule_id, fault_id, asset_id, component_id, task_name, maintenance_type, completed_date, usage_at_service, supplier, image_urls, resolves_fault, resolution_notes, notes, completed_by, created_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::text[],'{}'),COALESCE($11,false),$12,$13,$14,$15,$16)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = vessel_maintenance_logs.updated_at
     RETURNING *`,
    [d.schedule_id ?? null, d.fault_id ?? null, d.asset_id, d.component_id ?? null, d.task_name ?? null, d.maintenance_type ?? null, d.completed_date ?? null, d.usage_at_service ?? null, d.supplier ?? null, d.image_urls ?? null, d.resolves_fault ?? null, d.resolution_notes ?? null, d.notes ?? null, d.completed_by ?? null, createdBy, d.idempotency_key ?? null],
  )
