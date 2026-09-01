import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'

// Integration tests for the Schedule module.
// These tests require a real PostgreSQL database with the 037_schedule migration applied.
// They are skipped automatically when DATABASE_URL is unreachable.
//
// Run: node --import tsx --test tests/schedule.test.ts

const DB_URL = process.env.DATABASE_URL ?? 'postgres://ting-test:ting-test@localhost:5435/ting-test'

async function dbReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 })
  try { await pool.query('SELECT 1'); return true }
  catch { return false }
  finally { await pool.end() }
}

// ── Test: event log immutability ──────────────────────────────────────────────
// Cancelling a service appends an event. We then attempt a raw DELETE on that
// row as the app role — it must fail with a permissions error (REVOKE in migration).
test('event log rejects DELETE at the database level', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const pool = new Pool({ connectionString: DB_URL })
  try {
    // Create a service directly (bypasses app auth for this DB-level test).
    const { rows: [svc] } = await pool.query(
      `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status)
       VALUES (gen_random_uuid(), 'Test service', now() + interval '1 day', now() + interval '1 day 4 hours', 'Pacific/Auckland', 'planned')
       RETURNING id`,
    )

    // Append an event (simulates what the cancel route does).
    const { rows: [evt] } = await pool.query(
      `INSERT INTO scheduled_service_events (service_id, event_type, payload)
       VALUES ($1, 'cancelled', '{"reason":"test"}') RETURNING id`,
      [svc.id],
    )

    // Attempt DELETE — must be rejected by the trigger (fires for all roles, including superuser).
    await assert.rejects(
      () => pool.query('DELETE FROM scheduled_service_events WHERE id = $1', [evt.id]),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        // PostgreSQL P0001 = raise_exception from the no_delete trigger
        assert.match((err as { code?: string }).code ?? '', /P0001/, 'expected trigger exception (P0001)')
        assert.match((err as Error).message, /append-only/, 'error message must mention append-only')
        return true
      },
      'DELETE on scheduled_service_events must be blocked by the no_delete trigger',
    )

    // Confirm the event still exists.
    const { rows } = await pool.query('SELECT id FROM scheduled_service_events WHERE id = $1', [evt.id])
    assert.equal(rows.length, 1, 'event row must still exist after blocked DELETE')

    // Cleanup, scoped to this test's own rows. The FK is RESTRICT so the event
    // has to go first, and the append-only trigger blocks deleting it — so the
    // trigger is disabled just long enough to remove this one service's events.
    //
    // This used to be `TRUNCATE scheduled_service_events, scheduled_services
    // CASCADE`, which emptied BOTH tables entirely (and everything referencing
    // them) rather than the two rows created here. Test files run in parallel, so
    // it deleted other tests' fixtures mid-run — and against a dev database it
    // wiped every real scheduled service too.
    try {
      await pool.query('ALTER TABLE scheduled_service_events DISABLE TRIGGER no_delete_scheduled_service_events')
      await pool.query('DELETE FROM scheduled_service_events WHERE service_id = $1', [svc.id])
    } finally {
      await pool.query('ALTER TABLE scheduled_service_events ENABLE TRIGGER no_delete_scheduled_service_events')
    }
    await pool.query('DELETE FROM scheduled_services WHERE id = $1', [svc.id])
  } finally {
    await pool.end()
  }
})

// ── Test: optimistic concurrency (version conflict → 409) ────────────────────
// Two PATCHes with the same version — only one wins, the other gets null back
// from updateService (the route returns 409).
test('version conflict returns 409', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const pool = new Pool({ connectionString: DB_URL })
  try {
    const { rows: [svc] } = await pool.query<{ id: string; version: number }>(
      `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status, version)
       VALUES (gen_random_uuid(), 'Concurrency test', now() + interval '2 days', now() + interval '2 days 4 hours', 'Pacific/Auckland', 'planned', 1)
       RETURNING id, version`,
    )

    // Two updates competing on version = 1. Run them concurrently via Promise.all.
    const patch = (notes: string) => pool.query<{ id: string }>(
      `UPDATE scheduled_services
       SET notes = $1, updated_at = now(), version = version + 1
       WHERE id = $2 AND version = 1 RETURNING id`,
      [notes, svc.id],
    )

    const [r1, r2] = await Promise.all([patch('first write'), patch('second write')])

    const winners = [r1.rowCount ?? 0, r2.rowCount ?? 0]
    assert.equal(winners.reduce((a, b) => a + b, 0), 1, 'exactly one update must win')
    assert.ok(winners.includes(0), 'the losing update must return 0 rows (triggers 409 in the route)')

    await pool.query('DELETE FROM scheduled_services WHERE id = $1', [svc.id])
  } finally {
    await pool.end()
  }
})

// ── Test: DST boundary — New Zealand ─────────────────────────────────────────
// NZ clocks spring forward on the last Sunday of September:
//   NZST (UTC+12) → NZDT (UTC+13)
// A 09:00 service generated on both sides of the boundary must have the same
// local wall-clock time (09:00) but different UTC offsets — proving DST-safe
// generation via PostgreSQL AT TIME ZONE.
test('generate produces DST-correct UTC times for Pacific/Auckland', async (t) => {
  if (!await dbReachable(DB_URL)) { t.skip('database unreachable'); return }

  const pool = new Pool({ connectionString: DB_URL })
  try {
    // 2024 NZ DST switch: clocks go forward at 2am NZST on 29 Sep 2024.
    // Day before: 28 Sep 2024 — NZST, UTC+12 → 09:00 local = 21:00 UTC (prev day)
    // Day after:  29 Sep 2024 — NZDT, UTC+13 → 09:00 local = 20:00 UTC (prev day)
    const timezone = 'Pacific/Auckland'
    const time = '09:00'
    const dates = ['2024-09-28', '2024-09-29']

    for (const date of dates) {
      await pool.query(
        `INSERT INTO scheduled_services (id, name, starts_at, ends_at, timezone, status)
         VALUES (
           gen_random_uuid(), $1,
           ($2 || ' ' || $3)::timestamp AT TIME ZONE $4,
           ($2 || ' ' || $3)::timestamp AT TIME ZONE $4 + interval '4 hours',
           $4, 'planned'
         )`,
        [`DST test ${date}`, date, time, timezone],
      )
    }

    // Read back: verify wall-clock is 09:00 in both cases, and that the UTC
    // epoch difference is 23h not 24h — proof DST was applied during generation.
    //
    // 2024-09-28 09:00 NZST (UTC+12) → stored as 2024-09-27 21:00:00 UTC
    // 2024-09-29 09:00 NZDT (UTC+13) → stored as 2024-09-28 20:00:00 UTC
    // Difference = 23 hours (82800s). A naive 24h gap would mean DST was ignored.
    const { rows } = await pool.query<{ name: string; local_time: string; epoch: string }>(
      `SELECT name,
         to_char(starts_at AT TIME ZONE 'Pacific/Auckland', 'HH24:MI') AS local_time,
         extract(epoch from starts_at)::text AS epoch
       FROM scheduled_services
       WHERE name LIKE 'DST test %'
       ORDER BY starts_at`,
    )

    assert.equal(rows.length, 2, 'both DST test services must exist')

    for (const row of rows) {
      assert.equal(row.local_time, '09:00', `${row.name}: local wall-clock must be 09:00, got ${row.local_time}`)
    }

    const diffSeconds = parseFloat(rows[1].epoch) - parseFloat(rows[0].epoch)
    assert.equal(diffSeconds, 82800,
      `UTC epoch gap must be 23h (82800s) not 24h — got ${diffSeconds}s. DST was not applied if this is 86400.`)

    // Cleanup.
    await pool.query(`DELETE FROM scheduled_services WHERE name LIKE 'DST test %'`)
  } finally {
    await pool.end()
  }
})
