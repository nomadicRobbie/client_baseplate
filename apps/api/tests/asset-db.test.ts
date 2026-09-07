import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { query, closePool } from '../src/db/pool'
import {
  createAsset, getAsset, listAssets, updateAsset, softDeleteAsset,
  createFault, getFault, updateFault, addFaultStep, closeFault,
  upsertAssignment, listAssignments, deleteAssignment,
  createLog, listLogs,
  createComponent, listComponents,
  createAssetType, listAssetTypes,
} from '../src/db/queries/asset'

// Integration tests for the Asset module.
// Require a real PostgreSQL database with asset migrations applied.
// Skipped automatically when DATABASE_URL is unreachable.
//
// Run: node --import tsx --test tests/asset-db.test.ts

const DB_URL = process.env.DATABASE_URL ?? 'postgres://ting-test:ting-test@localhost:5435/ting-test'

async function dbReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 })
  try { await pool.query('SELECT 1'); return true }
  catch { return false }
  finally { await pool.end() }
}

after(async () => { await closePool() })

const tag = () => `ASSETTEST-${randomUUID().slice(0, 8)}`

// ── Assets ───────────────────────────────────────────────────────────────────

test('createAsset + getAsset: round-trip preserves fields', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const name = `${tag()} Vessel`
  const asset = await createAsset({ name, notes: 'test notes' }, null)
  assert.ok(asset, 'asset created')
  assert.equal(asset!.name, name)
  assert.equal(asset!.notes, 'test notes')

  const fetched = await getAsset(asset!.id)
  assert.ok(fetched, 'getAsset returns the row')
  assert.equal(fetched!.id, asset!.id)

  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

test('listAssets: soft-deleted assets do not appear', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const a = await createAsset({ name: `${tag()} Active` }, null)
  const b = await createAsset({ name: `${tag()} ToDelete` }, null)
  assert.ok(a && b)

  await softDeleteAsset(b!.id, null)

  const all = await listAssets()
  assert.ok(all.some(x => x.id === a!.id),  'active asset in list')
  assert.ok(!all.some(x => x.id === b!.id), 'soft-deleted asset excluded')

  await query('DELETE FROM assets WHERE id = ANY($1)', [[a!.id, b!.id]])
})

test('updateAsset: partial patch — only supplied fields change', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} Patch Me`, notes: 'original' }, null)
  assert.ok(asset)

  const updated = await updateAsset(asset!.id, { notes: 'patched' }, null)
  assert.equal(updated!.notes, 'patched')
  assert.equal(updated!.name, asset!.name, 'name unchanged')

  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

// ── Components ───────────────────────────────────────────────────────────────

test('createComponent + listComponents: component scoped to its asset', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} WithComp` }, null)
  assert.ok(asset)

  const comp = await createComponent({ asset_id: asset!.id, name: `${tag()} Engine` }, null)
  assert.ok(comp, 'component created')

  const comps = await listComponents(asset!.id)
  assert.ok(comps.some(c => c.id === comp!.id), 'component listed under its asset')

  await query('DELETE FROM asset_components WHERE id = $1', [comp!.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

// ── Assignments ──────────────────────────────────────────────────────────────

test('upsertAssignment: conflict updates role instead of inserting duplicate', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} AssignMe` }, null)
  const [person] = await query<{ id: string }>(`INSERT INTO people (name) VALUES ($1) RETURNING id`, [`${tag()} Crew`])
  assert.ok(asset && person)

  const first = await upsertAssignment({ person_id: person.id, asset_id: asset!.id, role: 'Crew' })
  assert.equal(first!.role, 'Crew')

  // Upsert with a different role — must update, not insert
  const second = await upsertAssignment({ person_id: person.id, asset_id: asset!.id, role: 'Skipper' })
  assert.equal(second!.id, first!.id, 'same row updated')
  assert.equal(second!.role, 'Skipper')

  const assignments = await listAssignments({ asset_id: asset!.id })
  assert.equal(assignments.filter(a => a.person_id === person.id).length, 1, 'still only one row')

  await deleteAssignment(first!.id)
  await query('DELETE FROM people WHERE id = $1', [person.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

// ── Faults ───────────────────────────────────────────────────────────────────

test('createFault + addFaultStep + closeFault: full fault lifecycle', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} FaultyVessel` }, null)
  assert.ok(asset)

  const fault = await createFault({ asset_id: asset!.id, name: 'Fuel leak', urgency: 'high' }, null)
  assert.ok(fault, 'fault created')
  assert.equal(fault!.status, 'open')

  const step = await addFaultStep({ fault_id: fault!.id, note: 'Investigated' }, null)
  assert.ok(step)

  const fetched = await getFault(fault!.id)
  assert.equal(fetched!.steps.length, 1, 'step appears in fault read')

  const closed = await closeFault(fault!.id, 'Repaired fuel line', null)
  assert.equal(closed!.status, 'closed')
  assert.ok(closed!.resolution_notes)

  await query('DELETE FROM asset_fault_steps WHERE fault_id = $1', [fault!.id])
  await query('DELETE FROM asset_faults WHERE id = $1', [fault!.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

test('createFault: idempotency_key prevents duplicate faults on replay', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} IdempAsset` }, null)
  assert.ok(asset)
  const key = randomUUID()

  const first = await createFault({ asset_id: asset!.id, name: 'Crack', idempotency_key: key }, null)
  const second = await createFault({ asset_id: asset!.id, name: 'Crack', idempotency_key: key }, null)

  assert.equal(first!.id, second!.id, 'same fault returned on replay')

  await query('DELETE FROM asset_faults WHERE id = $1', [first!.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

test('addFaultStep: idempotency_key prevents duplicate steps', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} StepIdemp` }, null)
  assert.ok(asset)
  const fault = await createFault({ asset_id: asset!.id, name: 'Test fault' }, null)
  const key = randomUUID()

  const s1 = await addFaultStep({ fault_id: fault!.id, note: 'Step A', idempotency_key: key }, null)
  const s2 = await addFaultStep({ fault_id: fault!.id, note: 'Step A', idempotency_key: key }, null)
  assert.equal(s1!.id, s2!.id, 'same step row on replay')

  const fetched = await getFault(fault!.id)
  assert.equal(fetched!.steps.length, 1, 'only one step')

  await query('DELETE FROM asset_fault_steps WHERE fault_id = $1', [fault!.id])
  await query('DELETE FROM asset_faults WHERE id = $1', [fault!.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

// ── Maintenance logs ─────────────────────────────────────────────────────────

test('createLog: idempotency_key prevents duplicate maintenance logs', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const asset = await createAsset({ name: `${tag()} LogIdemp` }, null)
  assert.ok(asset)
  const key = randomUUID()

  const l1 = await createLog({ asset_id: asset!.id, task_name: 'Oil change', idempotency_key: key }, null)
  const l2 = await createLog({ asset_id: asset!.id, task_name: 'Oil change', idempotency_key: key }, null)
  assert.equal(l1!.id, l2!.id, 'replayed log returns existing row')

  const logs = await listLogs({ asset_id: asset!.id })
  assert.equal(logs.filter(l => l.idempotency_key === key).length, 1, 'only one log row')

  await query('DELETE FROM asset_maintenance_logs WHERE id = $1', [l1!.id])
  await query('DELETE FROM assets WHERE id = $1', [asset!.id])
})

// ── Asset types ──────────────────────────────────────────────────────────────

test('createAssetType + listAssetTypes: new type appears in list', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const name = `${tag()} Vessel Type`
  const assetType = await createAssetType({ name, roles: ['Skipper', 'Crew'] })
  assert.ok(assetType)
  assert.equal(assetType!.name, name)

  const types = await listAssetTypes()
  assert.ok(types.some(t => t.id === assetType!.id))

  await query('DELETE FROM asset_types WHERE id = $1', [assetType!.id])
})
