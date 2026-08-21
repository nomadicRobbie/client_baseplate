import { query } from '../pool'
import type { ComplianceSchedule, CoolingBatch, FoodControlPlan } from '@blnk/shared'

// ── Types (mirrors the compliance_* tables) ─────────────────────────────────
export interface RecordType {
  jurisdiction: string
  code: string
  label: string
  category: string | null
  tiers: string[]
  frequency: string | null
  mandatory: boolean
  field_schema: unknown
  critical_limit: unknown
  sort_order: number
  active: boolean
}

export interface ComplianceRecord {
  id: string
  jurisdiction: string
  record_type: string
  site_id: string | null
  entered_by: string
  created_by: string | null
  datetime: string
  result: 'pass' | 'fail' | 'na'
  data: Record<string, unknown>
  corrective_action_id: string | null
  attachment_url: string | null
  schedule_id: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  name: string
  contact: string | null
  products: string | null
  registration: string | null
  active: boolean
  created_at: string
}

export interface Site {
  id: string
  name: string
  address: string | null
  is_home_base: boolean
  active: boolean
  created_at: string
}

// ── Record types (registry) ─────────────────────────────────────────────────
export async function listRecordTypes(jurisdiction: string, tier?: string): Promise<RecordType[]> {
  // tier filter uses array containment; $2 is null when no tier requested.
  return query<RecordType>(
    `SELECT * FROM compliance_record_types
     WHERE jurisdiction = $1 AND active = true
       AND ($2::text IS NULL OR $2 = ANY(tiers))
     ORDER BY sort_order, label`,
    [jurisdiction, tier ?? null],
  )
}

export async function getRecordType(jurisdiction: string, code: string): Promise<RecordType | null> {
  const rows = await query<RecordType>(
    `SELECT * FROM compliance_record_types WHERE jurisdiction = $1 AND code = $2`,
    [jurisdiction, code],
  )
  return rows[0] ?? null
}

// ── Records ─────────────────────────────────────────────────────────────────
export interface NewRecord {
  jurisdiction: string
  record_type: string
  site_id?: string | null
  entered_by: string
  created_by?: string | null
  datetime?: string
  result: 'pass' | 'fail' | 'na'
  data: Record<string, unknown>
  corrective_action_id?: string | null
  attachment_url?: string | null
  schedule_id?: string | null
}

export async function createRecord(r: NewRecord): Promise<ComplianceRecord> {
  const rows = await query<ComplianceRecord>(
    `INSERT INTO compliance_records
       (jurisdiction, record_type, site_id, entered_by, created_by, datetime, result, data, corrective_action_id, attachment_url, schedule_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, now()),$7,$8,$9,$10,$11)
     RETURNING *`,
    [r.jurisdiction, r.record_type, r.site_id ?? null, r.entered_by, r.created_by ?? null,
     r.datetime ?? null, r.result, JSON.stringify(r.data), r.corrective_action_id ?? null, r.attachment_url ?? null, r.schedule_id ?? null],
  )
  return rows[0]
}

export async function getRecord(id: string): Promise<ComplianceRecord | null> {
  const rows = await query<ComplianceRecord>(`SELECT * FROM compliance_records WHERE id = $1`, [id])
  return rows[0] ?? null
}

export interface RecordFilters {
  type?: string
  site?: string
  from?: string
  to?: string
  result?: string
}

export async function listRecords(f: RecordFilters): Promise<ComplianceRecord[]> {
  return query<ComplianceRecord>(
    `SELECT * FROM compliance_records
     WHERE voided_at IS NULL
       AND ($1::text IS NULL OR record_type = $1)
       AND ($2::uuid IS NULL OR site_id = $2)
       AND ($3::timestamptz IS NULL OR datetime >= $3)
       AND ($4::timestamptz IS NULL OR datetime <= $4)
       AND ($5::text IS NULL OR result = $5)
     ORDER BY datetime DESC
     LIMIT 500`,
    [f.type ?? null, f.site ?? null, f.from ?? null, f.to ?? null, f.result ?? null],
  )
}

// Allow-listed partial update — no generic column injection.
export async function updateRecord(
  id: string,
  patch: Partial<Pick<ComplianceRecord, 'entered_by' | 'datetime' | 'result' | 'data' | 'corrective_action_id' | 'attachment_url'>>,
): Promise<ComplianceRecord | null> {
  const cols: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const key of ['entered_by', 'datetime', 'result', 'corrective_action_id', 'attachment_url'] as const) {
    if (patch[key] !== undefined) { cols.push(`${key} = $${i++}`); vals.push(patch[key]) }
  }
  if (patch.data !== undefined) { cols.push(`data = $${i++}`); vals.push(JSON.stringify(patch.data)) }
  if (cols.length === 0) return getRecord(id)
  cols.push(`updated_at = now()`)
  vals.push(id)
  const rows = await query<ComplianceRecord>(
    `UPDATE compliance_records SET ${cols.join(', ')} WHERE id = $${i} RETURNING *`, vals,
  )
  return rows[0] ?? null
}

export async function voidRecord(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE compliance_records SET voided_at = now(), updated_at = now()
     WHERE id = $1 AND voided_at IS NULL RETURNING id`, [id],
  )
  return rows.length > 0
}

// ── Suppliers ───────────────────────────────────────────────────────────────
export async function listSuppliers(): Promise<Supplier[]> {
  return query<Supplier>(`SELECT * FROM compliance_suppliers WHERE active = true ORDER BY name`, [])
}

export async function createSupplier(s: Omit<Supplier, 'id' | 'active' | 'created_at'>): Promise<Supplier> {
  const rows = await query<Supplier>(
    `INSERT INTO compliance_suppliers (name, contact, products, registration)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [s.name, s.contact ?? null, s.products ?? null, s.registration ?? null],
  )
  return rows[0]
}

export async function updateSupplier(id: string, p: Partial<Omit<Supplier, 'id' | 'created_at'>>): Promise<Supplier | null> {
  const rows = await query<Supplier>(
    `UPDATE compliance_suppliers
     SET name = COALESCE($2,name), contact = COALESCE($3,contact), products = COALESCE($4,products),
         registration = COALESCE($5,registration), active = COALESCE($6,active)
     WHERE id = $1 RETURNING *`,
    [id, p.name ?? null, p.contact ?? null, p.products ?? null, p.registration ?? null, p.active ?? null],
  )
  return rows[0] ?? null
}

// ── Sites ───────────────────────────────────────────────────────────────────
export async function listSites(): Promise<Site[]> {
  return query<Site>(`SELECT * FROM compliance_sites WHERE active = true ORDER BY name`, [])
}

export async function createSite(s: Omit<Site, 'id' | 'active' | 'created_at'>): Promise<Site> {
  const rows = await query<Site>(
    `INSERT INTO compliance_sites (name, address, is_home_base)
     VALUES ($1,$2,$3) RETURNING *`,
    [s.name, s.address ?? null, s.is_home_base ?? false],
  )
  return rows[0]
}

export async function updateSite(id: string, p: Partial<Omit<Site, 'id' | 'created_at'>>): Promise<Site | null> {
  const rows = await query<Site>(
    `UPDATE compliance_sites
     SET name = COALESCE($2,name), address = COALESCE($3,address),
         is_home_base = COALESCE($4,is_home_base), active = COALESCE($5,active)
     WHERE id = $1 RETURNING *`,
    [id, p.name ?? null, p.address ?? null, p.is_home_base ?? null, p.active ?? null],
  )
  return rows[0] ?? null
}

// ── Schedules (recurring checks) ─────────────────────────────────────────────
export interface NewSchedule {
  jurisdiction: string
  record_type: string
  label: string
  site_id?: string | null
  cadence: string
  weekdays?: number[]
  day_of_month?: number | null
  interval_days?: number | null
  anchor_date?: string | null
  times_per_day?: number
}

export async function listSchedules(): Promise<ComplianceSchedule[]> {
  return query<ComplianceSchedule>(`SELECT * FROM compliance_schedules ORDER BY created_at`, [])
}

export async function listActiveSchedules(): Promise<ComplianceSchedule[]> {
  return query<ComplianceSchedule>(`SELECT * FROM compliance_schedules WHERE active = true ORDER BY label`, [])
}

export async function createSchedule(s: NewSchedule): Promise<ComplianceSchedule> {
  const rows = await query<ComplianceSchedule>(
    `INSERT INTO compliance_schedules
       (jurisdiction, record_type, label, site_id, cadence, weekdays, day_of_month, interval_days, anchor_date, times_per_day)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,1))
     RETURNING *`,
    [s.jurisdiction, s.record_type, s.label, s.site_id ?? null, s.cadence, s.weekdays ?? [],
     s.day_of_month ?? null, s.interval_days ?? null, s.anchor_date ?? null, s.times_per_day ?? null],
  )
  return rows[0]
}

export async function updateSchedule(
  id: string,
  p: Partial<Omit<ComplianceSchedule, 'id' | 'jurisdiction' | 'created_at'>>,
): Promise<ComplianceSchedule | null> {
  const rows = await query<ComplianceSchedule>(
    `UPDATE compliance_schedules SET
       record_type   = COALESCE($2, record_type),
       label         = COALESCE($3, label),
       site_id       = COALESCE($4, site_id),
       cadence       = COALESCE($5, cadence),
       weekdays      = COALESCE($6, weekdays),
       day_of_month  = COALESCE($7, day_of_month),
       interval_days = COALESCE($8, interval_days),
       anchor_date   = COALESCE($9, anchor_date),
       times_per_day = COALESCE($10, times_per_day),
       active        = COALESCE($11, active)
     WHERE id = $1 RETURNING *`,
    [id, p.record_type ?? null, p.label ?? null, p.site_id ?? null, p.cadence ?? null,
     p.weekdays ?? null, p.day_of_month ?? null, p.interval_days ?? null, p.anchor_date ?? null,
     p.times_per_day ?? null, p.active ?? null],
  )
  return rows[0] ?? null
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(`DELETE FROM compliance_schedules WHERE id = $1 RETURNING id`, [id])
  return rows.length > 0
}

// Completions per schedule on a given local date (YYYY-MM-DD).
// ponytail: compares in server time; swap to the business timezone if a client
// spans midnight in a different zone than the server.
export async function scheduleDoneCounts(on: string, from?: string, to?: string): Promise<Record<string, number>> {
  // When the client supplies UTC boundaries for the local day, use them (fixes timezone offset for non-UTC users).
  // Falls back to server-date range when not provided (e.g. direct API calls).
  const rows = from && to
    ? await query<{ schedule_id: string; n: number }>(
        `SELECT schedule_id, COUNT(*)::int AS n
         FROM compliance_records
         WHERE schedule_id IS NOT NULL AND voided_at IS NULL
           AND datetime >= $1::timestamptz AND datetime < $2::timestamptz
         GROUP BY schedule_id`,
        [from, to],
      )
    : await query<{ schedule_id: string; n: number }>(
        `SELECT schedule_id, COUNT(*)::int AS n
         FROM compliance_records
         WHERE schedule_id IS NOT NULL AND voided_at IS NULL
           AND datetime >= $1::date AND datetime < ($1::date + interval '1 day')
         GROUP BY schedule_id`,
        [on],
      )
  const map: Record<string, number> = {}
  for (const r of rows) map[r.schedule_id] = r.n
  return map
}

// ── Food Control Plans ────────────────────────────────────────────────────────
// Admin sees all plans; members see only plans they're assigned to via person_plan.
const assetImageSub = `(SELECT image_url FROM assets WHERE food_control_plan_id = fcp.id AND image_url IS NOT NULL LIMIT 1) AS asset_image_url`

export async function listPlans(opts: { isAdmin: boolean; userId?: string | null }): Promise<FoodControlPlan[]> {
  if (opts.isAdmin) {
    return query<FoodControlPlan>(`SELECT fcp.*, ${assetImageSub} FROM food_control_plans fcp WHERE fcp.active = true ORDER BY fcp.name`, [])
  }
  return query<FoodControlPlan>(
    `SELECT fcp.*, ${assetImageSub} FROM food_control_plans fcp
     JOIN person_plan pp ON pp.plan_id = fcp.id
     JOIN people p ON p.user_id = $1 AND p.id = pp.person_id
     WHERE fcp.active = true ORDER BY fcp.name`,
    [opts.userId ?? null],
  )
}

export async function getPlan(id: string): Promise<FoodControlPlan | null> {
  const rows = await query<FoodControlPlan>(`SELECT * FROM food_control_plans WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function createPlan(p: { name: string; tier?: string; created_by?: string | null }): Promise<FoodControlPlan> {
  const rows = await query<FoodControlPlan>(
    `INSERT INTO food_control_plans (name, tier, created_by)
     VALUES ($1, COALESCE($2,'FCP'), $3) RETURNING *`,
    [p.name, p.tier ?? null, p.created_by ?? null],
  )
  return rows[0]
}

export async function updatePlan(
  id: string,
  p: Partial<Pick<FoodControlPlan, 'name' | 'tier' | 'active' | 'image_url'>>,
): Promise<FoodControlPlan | null> {
  const rows = await query<FoodControlPlan>(
    `UPDATE food_control_plans SET
       name      = COALESCE($2, name),
       tier      = COALESCE($3, tier),
       active    = COALESCE($4, active),
       image_url = COALESCE($5, image_url),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, p.name ?? null, p.tier ?? null, p.active ?? null, p.image_url ?? null],
  )
  return rows[0] ?? null
}

// Copy plan metadata + all its schedules in one CTE. Records are not touched.
export async function duplicatePlan(sourceId: string, name: string, createdBy: string | null): Promise<FoodControlPlan | null> {
  const rows = await query<FoodControlPlan>(
    `WITH new_plan AS (
       INSERT INTO food_control_plans (name, tier, created_by)
       SELECT $2, tier, $3 FROM food_control_plans WHERE id = $1
       RETURNING *
     ), _copy AS (
       INSERT INTO compliance_schedules
         (jurisdiction, record_type, label, site_id, cadence, weekdays,
          day_of_month, interval_days, anchor_date, times_per_day, plan_id)
       SELECT cs.jurisdiction, cs.record_type, cs.label, cs.site_id, cs.cadence, cs.weekdays,
              cs.day_of_month, cs.interval_days, cs.anchor_date, cs.times_per_day, np.id
       FROM compliance_schedules cs, new_plan np
       WHERE cs.plan_id = $1 AND cs.active = true
     )
     SELECT * FROM new_plan`,
    [sourceId, name, createdBy],
  )
  return rows[0] ?? null
}

export async function assignPersonToPlan(personId: string, planId: string): Promise<void> {
  await query(
    `INSERT INTO person_plan (person_id, plan_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [personId, planId],
  )
}

export async function removePersonFromPlan(personId: string, planId: string): Promise<boolean> {
  const rows = await query<{ person_id: string }>(
    `DELETE FROM person_plan WHERE person_id = $1 AND plan_id = $2 RETURNING person_id`,
    [personId, planId],
  )
  return rows.length > 0
}

export async function listPlanMembers(planId: string): Promise<{ person_id: string }[]> {
  return query(`SELECT person_id FROM person_plan WHERE plan_id = $1`, [planId])
}

// ── Cooling batches (live tracking) ──────────────────────────────────────────
export async function createCoolingBatch(b: {
  jurisdiction: string; product: string; site_id?: string | null; started_by: string; created_by?: string | null;
}): Promise<CoolingBatch> {
  const rows = await query<CoolingBatch>(
    `INSERT INTO compliance_cooling_batches (jurisdiction, product, site_id, started_by, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.jurisdiction, b.product, b.site_id ?? null, b.started_by, b.created_by ?? null],
  )
  return rows[0]
}

export async function listActiveCoolingBatches(): Promise<CoolingBatch[]> {
  return query<CoolingBatch>(
    `SELECT * FROM compliance_cooling_batches WHERE status = 'in_progress' ORDER BY started_at`, [],
  )
}

export async function getCoolingBatch(id: string): Promise<CoolingBatch | null> {
  const rows = await query<CoolingBatch>(`SELECT * FROM compliance_cooling_batches WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function updateCoolingBatch(
  id: string,
  p: Partial<Pick<CoolingBatch, 'reached_21_at' | 'reached_5_at' | 'status' | 'record_id'>>,
): Promise<CoolingBatch | null> {
  const rows = await query<CoolingBatch>(
    `UPDATE compliance_cooling_batches SET
       reached_21_at = COALESCE($2, reached_21_at),
       reached_5_at  = COALESCE($3, reached_5_at),
       status        = COALESCE($4, status),
       record_id     = COALESCE($5, record_id)
     WHERE id = $1 RETURNING *`,
    [id, p.reached_21_at ?? null, p.reached_5_at ?? null, p.status ?? null, p.record_id ?? null],
  )
  return rows[0] ?? null
}
