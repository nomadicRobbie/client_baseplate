import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { query, closePool } from '../src/db/pool'
import {
  createRecord, getRecord, listRecords, updateRecord, voidRecord,
  createSchedule, scheduleDoneCounts,
  createPlan, duplicatePlan,
  createCoolingBatch, updateCoolingBatch, getCoolingBatch,
  createSite, listSites,
  createSupplier, listSuppliers,
} from '../src/db/queries/compliance'

// Integration tests for the Compliance module.
// Require a real PostgreSQL database with compliance migrations applied.
// Skipped automatically when DATABASE_URL is unreachable.
//
// Run: node --import tsx --test tests/compliance-db.test.ts

const DB_URL = process.env.DATABASE_URL ?? 'postgres://ting-test:ting-test@localhost:5435/ting-test'

async function dbReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 })
  try { await pool.query('SELECT 1'); return true }
  catch { return false }
  finally { await pool.end() }
}

after(async () => { await closePool() })

// ── Records ──────────────────────────────────────────────────────────────────

test('createRecord + getRecord: round-trip preserves all fields', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const rec = await createRecord({
    jurisdiction: 'nz',
    record_type: 'fridge_temp',
    entered_by: 'Test User',
    result: 'pass',
    data: { temp_c: 3.5 },
  })

  assert.ok(rec.id, 'record has an id')
  assert.equal(rec.jurisdiction, 'nz')
  assert.equal(rec.record_type, 'fridge_temp')
  assert.equal(rec.result, 'pass')
  assert.equal(typeof rec.data, 'object')

  const fetched = await getRecord(rec.id)
  assert.ok(fetched, 'getRecord returns the row')
  assert.equal(fetched!.id, rec.id)
  assert.equal(fetched!.result, 'pass')

  // cleanup
  await query('DELETE FROM compliance_records WHERE id = $1', [rec.id])
})

test('listRecords: result filter excludes non-matching rows', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const pass_ = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: {} })
  const fail_ = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'fail', data: {} })

  const passes = await listRecords({ result: 'pass' })
  const fails  = await listRecords({ result: 'fail' })

  assert.ok(passes.some(r => r.id === pass_.id), 'pass row is in passes list')
  assert.ok(!passes.some(r => r.id === fail_.id), 'fail row is not in passes list')
  assert.ok(fails.some(r => r.id === fail_.id),   'fail row is in fails list')

  await query('DELETE FROM compliance_records WHERE id = ANY($1)', [[pass_.id, fail_.id]])
})

test('listRecords: type filter', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const a = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: {} })
  const b = await createRecord({ jurisdiction: 'nz', record_type: 'hot_hold',    entered_by: 'T', result: 'pass', data: {} })

  const fridges = await listRecords({ type: 'fridge_temp' })
  assert.ok(fridges.some(r => r.id === a.id),  'fridge record appears')
  assert.ok(!fridges.some(r => r.id === b.id), 'hot_hold record excluded')

  await query('DELETE FROM compliance_records WHERE id = ANY($1)', [[a.id, b.id]])
})

test('voidRecord: voided records are excluded from listRecords', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const rec = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: {} })

  const beforeVoid = await listRecords({})
  assert.ok(beforeVoid.some(r => r.id === rec.id), 'record visible before void')

  const voided = await voidRecord(rec.id)
  assert.equal(voided, true)

  const afterVoid = await listRecords({})
  assert.ok(!afterVoid.some(r => r.id === rec.id), 'record excluded after void (voided_at IS NOT NULL)')

  // idempotent — voiding again returns false
  const again = await voidRecord(rec.id)
  assert.equal(again, false)

  await query('DELETE FROM compliance_records WHERE id = $1', [rec.id])
})

test('updateRecord: partial patch — only supplied fields change', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const rec = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: { temp_c: 4 } })

  const updated = await updateRecord(rec.id, { result: 'fail', data: { temp_c: 8 } })
  assert.ok(updated, 'update returns the row')
  assert.equal(updated!.result, 'fail')
  assert.equal((updated!.data as Record<string, unknown>).temp_c, 8)
  assert.equal(updated!.entered_by, 'T', 'unpatched field unchanged')

  await query('DELETE FROM compliance_records WHERE id = $1', [rec.id])
})

// ── Schedules ────────────────────────────────────────────────────────────────

test('createSchedule + scheduleDoneCounts: completed records are counted per schedule', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const sched = await createSchedule({
    jurisdiction: 'nz', record_type: 'fridge_temp', label: 'Test daily fridge check',
    cadence: 'daily', weekdays: [],
  })
  assert.ok(sched.id)
  assert.equal(sched.cadence, 'daily')

  // No records yet
  const today = new Date().toISOString().slice(0, 10)
  const before = await scheduleDoneCounts(today)
  assert.equal(before[sched.id] ?? 0, 0)

  // Log two completions for this schedule today
  const r1 = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: {}, schedule_id: sched.id })
  const r2 = await createRecord({ jurisdiction: 'nz', record_type: 'fridge_temp', entered_by: 'T', result: 'pass', data: {}, schedule_id: sched.id })

  const after = await scheduleDoneCounts(today)
  assert.ok(after[sched.id] >= 2, 'both completions counted')

  await query('DELETE FROM compliance_records WHERE id = ANY($1)', [[r1.id, r2.id]])
  await query('DELETE FROM compliance_schedules WHERE id = $1', [sched.id])
})

// ── Plans ────────────────────────────────────────────────────────────────────

test('createPlan + duplicatePlan: copies metadata and active schedules', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const plan = await createPlan({ name: `Test Plan ${randomUUID().slice(0, 8)}` })
  assert.ok(plan.id)

  // Add a schedule to the source plan
  await createSchedule({
    jurisdiction: 'nz', record_type: 'fridge_temp',
    label: 'Fridge check', cadence: 'daily', weekdays: [],
  })
  // Create a schedule linked to the plan via plan_id (direct SQL — the typed function doesn't expose plan_id)
  await query(
    `INSERT INTO compliance_schedules (jurisdiction, record_type, label, cadence, weekdays, plan_id)
     VALUES ('nz','fridge_temp','Plan sched','daily','{}', $1)`,
    [plan.id],
  )

  const copy = await duplicatePlan(plan.id, `${plan.name} (copy)`, null)
  assert.ok(copy, 'duplicate returns the new plan')
  assert.notEqual(copy!.id, plan.id, 'copy has a new id')
  assert.match(copy!.name, /copy/)

  // The copy should have a cloned schedule
  const copyScheds = await query<{ id: string }>(`SELECT id FROM compliance_schedules WHERE plan_id = $1`, [copy!.id])
  assert.ok(copyScheds.length >= 1, 'schedules were copied to the new plan')

  await query('DELETE FROM compliance_schedules WHERE plan_id = ANY($1)', [[plan.id, copy!.id]])
  await query('DELETE FROM food_control_plans WHERE id = ANY($1)', [[plan.id, copy!.id]])
})

// ── Cooling batches ──────────────────────────────────────────────────────────

test('createCoolingBatch + updateCoolingBatch: in-progress → completed lifecycle', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const batch = await createCoolingBatch({
    jurisdiction: 'nz', product: 'Test soup', started_by: 'Chef T',
  })
  assert.ok(batch.id)
  assert.equal(batch.status, 'in_progress')

  const midway = await updateCoolingBatch(batch.id, { reached_21_at: new Date().toISOString() })
  assert.ok(midway!.reached_21_at, 'reached_21_at set')
  assert.equal(midway!.status, 'in_progress', 'still in progress')

  const done = await updateCoolingBatch(batch.id, { reached_5_at: new Date().toISOString(), status: 'completed' })
  assert.ok(done!.reached_5_at)
  assert.equal(done!.status, 'completed')

  const fetched = await getCoolingBatch(batch.id)
  assert.equal(fetched!.status, 'completed')

  await query('DELETE FROM compliance_cooling_batches WHERE id = $1', [batch.id])
})

// ── Sites + Suppliers ────────────────────────────────────────────────────────

test('createSite + listSites: new site appears in active list', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const site = await createSite({ name: `Test Site ${randomUUID().slice(0, 8)}`, address: '1 Test St', is_home_base: false })
  assert.ok(site.id)

  const sites = await listSites()
  assert.ok(sites.some(s => s.id === site.id), 'new site in active list')

  await query('DELETE FROM compliance_sites WHERE id = $1', [site.id])
})

test('createSupplier + listSuppliers: new supplier appears in list', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const supplier = await createSupplier({ name: `Test Supplier ${randomUUID().slice(0, 8)}`, contact: null, products: null, registration: null })
  assert.ok(supplier.id)

  const suppliers = await listSuppliers()
  assert.ok(suppliers.some(s => s.id === supplier.id))

  await query('DELETE FROM compliance_suppliers WHERE id = $1', [supplier.id])
})
