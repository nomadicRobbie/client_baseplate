import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { query, closePool } from '../src/db/pool'
import {
  generateRoster, getRosterDetail, eligibleCrew, upsertUnavailability, listUnavailability,
  publishRoster, confirmAssignment, declineAssignment, getRoster,
} from '../src/db/queries/roster'

// Integration tests for the Roster module. Require a real PostgreSQL database
// with migrations 039 and 040 applied; skipped automatically when unreachable.
//
// Run: node --import tsx --test tests/roster.test.ts
//
// Each test owns a unique fixture tag AND a unique week. Test files run in
// parallel and `rosters.week_start` is UNIQUE, so sharing either would let one
// test's cleanup pull rows out from under another's seed.

const DB_URL = process.env.DATABASE_URL ?? 'postgres://ting-test:ting-test@localhost:5435/ting-test'

async function dbReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 })
  try { await pool.query('SELECT 1'); return true }
  catch (_) { return false }
  finally { await pool.end() }
}

// One pool for the whole file, closed once at the end — closing it per test
// would pull it out from under anything still running.
after(async () => { await closePool() })

let weekCounter = 0
/** A distinct Monday per test, far from any real data. */
function nextWeek(): string {
  const d = new Date('2027-03-01T00:00:00Z')          // a Monday
  d.setUTCDate(d.getUTCDate() + 7 * weekCounter++)
  return d.toISOString().slice(0, 10)
}

interface Fixture {
  tag: string; monday: string
  ana: string; bruno: string; cara: string
  s1: string; s2: string; s3: string; s4: string
  names(rows: { person_name?: string; name?: string }[]): string[]
  cleanup(): Promise<void>
}

// Ana and Bruno crew Vessel A; Cara crews Vessel B, which nothing uses.
//   s1  Mon 09-13, Vessel A
//   s2  Mon 11-15, Vessel A  — overlaps s1
//   s3  Tue 09-13, Vessel A  — Ana is off that day
//   s4  Wed 09-13, no asset
async function seed(): Promise<Fixture> {
  const tag = `ROSTERTEST-${randomUUID().slice(0, 8)}`
  const monday = nextWeek()
  const at = (day: number, hour: number) => {
    const d = new Date(`${monday}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + day)
    d.setUTCHours(hour)
    return d.toISOString()
  }

  const person = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO people (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id
  const asset = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO assets (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id
  const service = async (n: string, s: string, e: string) =>
    (await query<{ id: string }>(
      `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status)
       VALUES (gen_random_uuid(), $1, $2, $3, 'UTC', 'planned') RETURNING id`, [`${tag} ${n}`, s, e]))[0].id
  const useAsset = (svc: string, a: string) =>
    query(`INSERT INTO service_assignments (service_id, subject_type, subject_id) VALUES ($1,'asset',$2)`, [svc, a])
  const crews = (p: string, a: string, role: string) =>
    query(`INSERT INTO asset_assignments (person_id, asset_id, role) VALUES ($1,$2,$3)`, [p, a, role])

  const ana = await person('Ana'), bruno = await person('Bruno'), cara = await person('Cara')
  const vesselA = await asset('Vessel A'), vesselB = await asset('Vessel B')
  await crews(ana, vesselA, 'Skipper')
  await crews(bruno, vesselA, 'Crew')
  await crews(cara, vesselB, 'Skipper')

  const s1 = await service('Mon morning', at(0, 9), at(0, 13)); await useAsset(s1, vesselA)
  const s2 = await service('Mon overlap', at(0, 11), at(0, 15)); await useAsset(s2, vesselA)
  const s3 = await service('Tue morning', at(1, 9), at(1, 13)); await useAsset(s3, vesselA)

  const tuesday = new Date(`${monday}T00:00:00Z`)
  tuesday.setUTCDate(tuesday.getUTCDate() + 1)
  await query(`INSERT INTO person_unavailability (person_id, date, kind) VALUES ($1,$2,'planned')`,
    [ana, tuesday.toISOString().slice(0, 10)])

  const s4 = await service('Wed no asset', at(2, 9), at(2, 13))

  return {
    tag, monday, ana, bruno, cara, s1, s2, s3, s4,
    names: rows => rows.map(r => (r.person_name ?? r.name ?? '').replace(`${tag} `, '')).sort(),
    cleanup: async () => {
      const like = `${tag}%`
      await query(`DELETE FROM roster_shifts WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
      await query(`DELETE FROM service_assignments WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
      await query(`DELETE FROM service_assignments WHERE roster_id IN (SELECT id FROM rosters WHERE week_start = $1)`, [monday])
      await query(`DELETE FROM rosters WHERE week_start = $1`, [monday])
      await query(`DELETE FROM scheduled_services WHERE name LIKE $1`, [like])
      await query(`DELETE FROM asset_assignments WHERE person_id IN (SELECT id FROM people WHERE name LIKE $1)`, [like])
      await query(`DELETE FROM person_unavailability WHERE person_id IN (SELECT id FROM people WHERE name LIKE $1)`, [like])
      await query(`DELETE FROM assets WHERE name LIKE $1`, [like])
      await query(`DELETE FROM people WHERE name LIKE $1`, [like])
    },
  }
}

// ── eligibleCrew ──────────────────────────────────────────────────────────────
// The one function generation and (later) shift cover both depend on.
test('eligibleCrew derives crew from the asset, minus who is unavailable or busy', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const f = await seed()
  try {
    assert.deepEqual(f.names(await eligibleCrew(f.s1)), ['Ana', 'Bruno'],
      'both people who crew the assigned asset are eligible')
    assert.deepEqual(f.names(await eligibleCrew(f.s3)), ['Bruno'],
      'someone with unavailability on the service date is excluded')
    assert.deepEqual(f.names(await eligibleCrew(f.s4)), [],
      'a service with no asset has nobody to derive crew from')
    assert.deepEqual(f.names(await eligibleCrew(f.s1, { exclude: [f.ana] })), ['Bruno'],
      'exclude drops the named person — this is what shift cover will use')
  } finally { await f.cleanup() }
})

// ── Generation ────────────────────────────────────────────────────────────────
test('generateRoster fills a week without double-booking, and flags gaps', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const f = await seed()
  try {
    const gen = await generateRoster(f.monday, null)
    const detail = (await getRosterDetail(gen.roster.id))!
    const row = (id: string) => detail.services.find(s => s.service_id === id)!

    assert.deepEqual(f.names(row(f.s1).shifts), ['Ana', 'Bruno'], 'both crew are rostered on')
    assert.deepEqual(f.names(row(f.s2).shifts), [],
      'the overlapping service gets nobody — both are already committed')
    assert.deepEqual(f.names(row(f.s3).shifts), ['Bruno'], 'the unavailable person is skipped')
    assert.deepEqual(f.names(row(f.s4).shifts), [], 'no asset means no crew')
    assert.equal(row(f.s4).has_asset, false, 'the missing asset is flagged for the admin')
    assert.equal(row(f.s1).has_asset, true)

    assert.ok(!detail.services.flatMap(s => f.names(s.shifts)).includes('Cara'),
      'someone who only crews an unused asset is never rostered')
    assert.ok(row(f.s1).shifts.every(sh => sh.asset_name === `${f.tag} Vessel A`),
      'each shift records which asset qualified the person')
  } finally { await f.cleanup() }
})

test('regenerating a week replaces the draft instead of stacking duplicates', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const f = await seed()
  try {
    const first = await generateRoster(f.monday, null)
    const before = (await getRosterDetail(first.roster.id))!

    const second = await generateRoster(f.monday, null)
    const after_ = (await getRosterDetail(second.roster.id))!

    assert.equal(second.roster.id, first.roster.id, 'the same week reuses its roster row')
    assert.equal(second.shifts, first.shifts, 'the same number of shifts')
    assert.deepEqual(
      after_.services.map(s => f.names(s.shifts)),
      before.services.map(s => f.names(s.shifts)),
      'regenerating is idempotent — same roster, not doubled',
    )
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM roster_shifts WHERE roster_id = $1`, [first.roster.id])
    assert.equal(parseInt(count, 10), first.shifts, 'no orphaned shift rows survive')

    // Any day in the week resolves to that week's Monday.
    const thursday = new Date(`${f.monday}T00:00:00Z`)
    thursday.setUTCDate(thursday.getUTCDate() + 3)
    const third = await generateRoster(thursday.toISOString().slice(0, 10), null)
    assert.equal(third.roster.id, first.roster.id, 'a Thursday resolves to the same Monday')
    assert.equal(String(third.roster.week_start).slice(0, 10), f.monday)
  } finally { await f.cleanup() }
})

// ── Publish + confirm ────────────────────────────────────────────────────────
test('publishing copies shifts to service_assignments and confirm/decline works', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const f = await seed()
  try {
    const gen = await generateRoster(f.monday, null)
    assert.equal(gen.roster.status, 'draft')

    const published = await publishRoster(gen.roster.id, null)
    assert.equal(published.status, 'published')
    assert.ok(published.published_at, 'published_at should be set')

    const [{ count: saCount }] = await query<{ count: string }>(
      `SELECT count(*) FROM service_assignments WHERE roster_id = $1 AND removed_at IS NULL`,
      [gen.roster.id],
    )
    assert.equal(parseInt(saCount, 10), gen.shifts, 'every shift becomes a service_assignment')

    // Publishing again is idempotent
    const again = await publishRoster(gen.roster.id, null)
    assert.equal(again.id, published.id)

    // Detail now reads from service_assignments
    const detail = (await getRosterDetail(gen.roster.id))!
    const s1Shifts = detail.services.find(s => s.service_id === f.s1)?.shifts ?? []
    assert.ok(s1Shifts.length > 0, 'published detail should have shifts')

    // Confirm
    const anaShift = s1Shifts.find(sh => sh.person_id === f.ana)!
    assert.ok(anaShift, 'Ana should be on s1')
    const confirmed = await confirmAssignment(anaShift.id, f.ana)
    assert.ok(confirmed, 'confirm should succeed')
    assert.ok(confirmed!.confirmed_at)

    // Decline clears confirmed
    const declined = await declineAssignment(anaShift.id, f.ana)
    assert.ok(declined, 'decline should succeed')
    assert.ok(declined!.declined_at)

    // Confirm again after declining
    const reconfirmed = await confirmAssignment(anaShift.id, f.ana)
    assert.ok(reconfirmed!.confirmed_at)

    // Wrong person can't confirm someone else's assignment
    const wrongPerson = await confirmAssignment(anaShift.id, f.bruno)
    assert.equal(wrongPerson, null, 'wrong person should not be able to confirm')
  } finally { await f.cleanup() }
})

// ── Role matching ────────────────────────────────────────────────────────────
test('generateRoster fills shifts by required_roles, not just headcount', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const tag = `ROSTERTEST-${randomUUID().slice(0, 8)}`
  const monday = nextWeek()
  const at = (hour: number) => {
    const d = new Date(`${monday}T00:00:00Z`)
    d.setUTCHours(hour)
    return d.toISOString()
  }
  const person = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO people (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id
  const asset = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO assets (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id

  const skipper = await person('Skipper Sam')
  const crew1 = await person('Crew Alex')
  const crew2 = await person('Crew Bella')
  const boat = await asset('Boat')

  await query(`INSERT INTO asset_assignments (person_id, asset_id, role) VALUES ($1,$2,'Skipper')`, [skipper, boat])
  await query(`INSERT INTO asset_assignments (person_id, asset_id, role) VALUES ($1,$2,'Crew')`, [crew1, boat])
  await query(`INSERT INTO asset_assignments (person_id, asset_id, role) VALUES ($1,$2,'Crew')`, [crew2, boat])

  // Service requires 1 Skipper + 1 Crew
  const [{ id: svcId }] = await query<{ id: string }>(
    `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status, required_roles)
     VALUES (gen_random_uuid(), $1, $2, $3, 'UTC', 'planned', $4) RETURNING id`,
    [`${tag} Trip`, at(9), at(15), JSON.stringify([{ role: 'Skipper', count: 1 }, { role: 'Crew', count: 1 }])],
  )
  await query(`INSERT INTO service_assignments (service_id, subject_type, subject_id) VALUES ($1,'asset',$2)`, [svcId, boat])

  const like = `${tag}%`
  const cleanup = async () => {
    await query(`DELETE FROM roster_shifts WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM service_assignments WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM service_assignments WHERE roster_id IN (SELECT id FROM rosters WHERE week_start = $1)`, [monday])
    await query(`DELETE FROM rosters WHERE week_start = $1`, [monday])
    await query(`DELETE FROM scheduled_services WHERE name LIKE $1`, [like])
    await query(`DELETE FROM asset_assignments WHERE person_id IN (SELECT id FROM people WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM assets WHERE name LIKE $1`, [like])
    await query(`DELETE FROM people WHERE name LIKE $1`, [like])
  }

  try {
    const gen = await generateRoster(monday, null)
    const detail = (await getRosterDetail(gen.roster.id))!
    const svc = detail.services.find(s => s.service_id === svcId)!

    assert.equal(svc.shifts.length, 2, 'exactly 2 shifts filled (1 skipper + 1 crew)')

    const roles = svc.shifts.map(sh => sh.role).sort()
    assert.deepEqual(roles, ['Crew', 'Skipper'], 'one Skipper and one Crew, not two of the same')

    const skipperShift = svc.shifts.find(sh => sh.role === 'Skipper')!
    assert.equal(skipperShift.person_id, skipper, 'the Skipper slot is filled by the person with that role')
  } finally { await cleanup() }
})

test('generateRoster with required_roles leaves a gap when no one holds the role', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const tag = `ROSTERTEST-${randomUUID().slice(0, 8)}`
  const monday = nextWeek()
  const at = (hour: number) => {
    const d = new Date(`${monday}T00:00:00Z`)
    d.setUTCHours(hour)
    return d.toISOString()
  }
  const person = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO people (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id
  const asset = async (n: string) =>
    (await query<{ id: string }>(`INSERT INTO assets (name) VALUES ($1) RETURNING id`, [`${tag} ${n}`]))[0].id

  const crew1 = await person('Crew Only')
  const boat = await asset('Dinghy')

  // Only crew role assigned — no skipper
  await query(`INSERT INTO asset_assignments (person_id, asset_id, role) VALUES ($1,$2,'Crew')`, [crew1, boat])

  // Service requires 1 Skipper + 1 Crew
  const [{ id: svcId }] = await query<{ id: string }>(
    `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status, required_roles)
     VALUES (gen_random_uuid(), $1, $2, $3, 'UTC', 'planned', $4) RETURNING id`,
    [`${tag} No Skip`, at(9), at(13), JSON.stringify([{ role: 'Skipper', count: 1 }, { role: 'Crew', count: 1 }])],
  )
  await query(`INSERT INTO service_assignments (service_id, subject_type, subject_id) VALUES ($1,'asset',$2)`, [svcId, boat])

  const like = `${tag}%`
  const cleanup = async () => {
    await query(`DELETE FROM roster_shifts WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM service_assignments WHERE service_id IN (SELECT id FROM scheduled_services WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM service_assignments WHERE roster_id IN (SELECT id FROM rosters WHERE week_start = $1)`, [monday])
    await query(`DELETE FROM rosters WHERE week_start = $1`, [monday])
    await query(`DELETE FROM scheduled_services WHERE name LIKE $1`, [like])
    await query(`DELETE FROM asset_assignments WHERE person_id IN (SELECT id FROM people WHERE name LIKE $1)`, [like])
    await query(`DELETE FROM assets WHERE name LIKE $1`, [like])
    await query(`DELETE FROM people WHERE name LIKE $1`, [like])
  }

  try {
    const gen = await generateRoster(monday, null)
    assert.ok(gen.servicesWithGaps > 0, 'should report a gap when skipper role cannot be filled')

    const detail = (await getRosterDetail(gen.roster.id))!
    const svc = detail.services.find(s => s.service_id === svcId)!

    assert.equal(svc.shifts.length, 1, 'only the crew slot is filled')
    assert.equal(svc.shifts[0].role, 'Crew')
    assert.equal(svc.shortfall, 1, 'shortfall reflects the missing skipper')
  } finally { await cleanup() }
})

// ── DATE serialisation ────────────────────────────────────────────────────────
// node-postgres parses a DATE column into a JS Date at LOCAL midnight, which
// JSON-serialises to the PREVIOUS day in any positive-offset zone (NZ is +12/13).
// Roster queries cast DATE to text so the value the client receives is the value
// that was stored. This test fails if that cast is ever dropped.
test('dates survive the round trip without shifting a day', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }
  const tag = `ROSTERTEST-${randomUUID().slice(0, 8)}`
  try {
    const [p] = await query<{ id: string }>(`INSERT INTO people (name) VALUES ($1) RETURNING id`, [`${tag} DateCheck`])
    const saved = await upsertUnavailability({ person_id: p.id, date: '2027-03-01', kind: 'sick' }, null)
    const [listed] = await listUnavailability({ from: '2027-02-01', to: '2027-04-01', person_id: p.id })

    assert.equal(typeof saved!.date, 'string', 'a DATE comes back as a string, not a Date object')
    assert.equal(saved!.date, '2027-03-01', 'the stored date is the returned date')
    assert.equal(listed.date, '2027-03-01', 'and it survives being listed')
    assert.equal(JSON.parse(JSON.stringify({ d: listed.date })).d, '2027-03-01',
      'and survives JSON serialisation to the client')
  } finally {
    await query(`DELETE FROM person_unavailability WHERE person_id IN (SELECT id FROM people WHERE name LIKE $1)`, [`${tag}%`])
    await query(`DELETE FROM people WHERE name LIKE $1`, [`${tag}%`])
  }
})
