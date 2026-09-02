import { query, getPool } from '../pool'
import type {
  PersonUnavailability, Roster, RosterShift, RosterDetail, RosterServiceRow,
  EligibleCrew, RequiredRole, ServiceStatus, RosterRules,
} from '@blnk/shared'

const one = async <T>(sql: string, params: unknown[]): Promise<T | null> =>
  (await query<T & object>(sql, params))[0] as T ?? null

// date/week_start are cast to text on the way out. node-postgres parses a DATE
// column into a JS Date at LOCAL midnight, which JSON-serialises to the previous
// day in any positive-offset zone — 2027-03-01 leaves NZ as "2027-02-28T11:00Z".
// The shared types have always said `string`; the cast makes that true.
const SELECT_UNAVAILABILITY = `
  SELECT u.id, u.person_id, u.date::text AS date, u.kind, u.reason,
         u.created_at, u.created_by, p.name AS person_name
    FROM person_unavailability u
    JOIN people p ON p.id = u.person_id`

// Same treatment for rosters — week_start is a DATE.
const SELECT_ROSTER = `
  SELECT id, week_start::text AS week_start, status,
         generated_at, published_at, deleted_at, created_at, created_by
    FROM rosters`

export interface UnavailabilityFilters {
  from: string          // YYYY-MM-DD, inclusive
  to: string            // YYYY-MM-DD, inclusive
  person_id?: string    // omit for the whole team (admin only — enforced in the route)
}

export const listUnavailability = (f: UnavailabilityFilters) =>
  query<PersonUnavailability>(
    `${SELECT_UNAVAILABILITY}
     WHERE u.date >= $1 AND u.date <= $2
       AND ($3::uuid IS NULL OR u.person_id = $3)
     ORDER BY u.date, p.name`,
    [f.from, f.to, f.person_id ?? null],
  )

// Re-declaring a day updates it rather than erroring — someone marking a planned
// day off as sick, or fixing a reason, is the same intent as setting it.
export const upsertUnavailability = (
  d: { person_id: string; date: string; kind?: string; reason?: string | null },
  createdBy: string | null,
) =>
  one<PersonUnavailability>(
    `WITH upserted AS (
       INSERT INTO person_unavailability (person_id, date, kind, reason, created_by)
       VALUES ($1, $2, COALESCE($3, 'planned'), $4, $5)
       ON CONFLICT (person_id, date) DO UPDATE
         SET kind = EXCLUDED.kind, reason = EXCLUDED.reason
       RETURNING *
     )
     SELECT u.id, u.person_id, u.date::text AS date, u.kind, u.reason,
            u.created_at, u.created_by, p.name AS person_name
       FROM upserted u JOIN people p ON p.id = u.person_id`,
    [d.person_id, d.date, d.kind ?? null, d.reason ?? null, createdBy],
  )

// personId scopes the delete to one person's own rows; pass null for admin.
export const deleteUnavailability = async (id: string, personId: string | null): Promise<boolean> =>
  (await query<{ id: string }>(
    `DELETE FROM person_unavailability
      WHERE id = $1 AND ($2::uuid IS NULL OR person_id = $2)
      RETURNING id`,
    [id, personId],
  )).length > 0

// ── Eligible crew ─────────────────────────────────────────────────────────────
// "Who could work this service?" — asked once per service when generating a week,
// and again every time a shift needs covering. It lives here as one function on
// purpose: inlined into the generator, the cover flow would have to reimplement
// it and the two would drift.
//
// A person qualifies when they crew an asset that is assigned to the service, are
// not off that day, and are not already committed to something that overlaps it.
// Defaults if the roster_rules row is missing (shouldn't happen after migration).
const DEFAULT_MIN_REST_HOURS = 10
const DEFAULT_MAX_CONSECUTIVE_DAYS = 6

export async function getRosterRules(): Promise<RosterRules> {
  const [row] = await query<RosterRules>('SELECT min_rest_hours, max_consecutive_days, updated_at, updated_by FROM roster_rules WHERE id = true')
  return row ?? { min_rest_hours: DEFAULT_MIN_REST_HOURS, max_consecutive_days: DEFAULT_MAX_CONSECUTIVE_DAYS, updated_at: new Date().toISOString(), updated_by: null }
}

export async function updateRosterRules(
  body: { min_rest_hours?: number; max_consecutive_days?: number },
  updatedBy: string | null,
): Promise<RosterRules> {
  const [row] = await query<RosterRules>(
    `UPDATE roster_rules SET
       min_rest_hours = COALESCE($1, min_rest_hours),
       max_consecutive_days = COALESCE($2, max_consecutive_days),
       updated_at = now(),
       updated_by = $3
     WHERE id = true
     RETURNING min_rest_hours, max_consecutive_days, updated_at, updated_by`,
    [body.min_rest_hours ?? null, body.max_consecutive_days ?? null, updatedBy],
  )
  return row!
}

// Params: $1=serviceId, $2=rosterId, $3=excludeIds[], $4=minRestHours, $5=maxDays
const ELIGIBLE_SQL = `WITH svc AS (
       SELECT id, starts_at, ends_at, timezone FROM scheduled_services WHERE id = $1
     ),
     candidates AS (
       SELECT DISTINCT ON (p.id)
              p.id AS person_id, p.name, a.id AS asset_id, a.name AS asset_name, aa.role
         FROM svc s
         JOIN service_assignments sa
           ON sa.service_id = s.id AND sa.subject_type = 'asset' AND sa.removed_at IS NULL
         JOIN assets a            ON a.id = sa.subject_id
         JOIN asset_assignments aa ON aa.asset_id = a.id
         JOIN people p            ON p.id = aa.person_id AND p.active
        WHERE
          NOT EXISTS (
            SELECT 1 FROM person_unavailability u
             WHERE u.person_id = p.id
               AND u.date = (s.starts_at AT TIME ZONE s.timezone)::date
          )
          AND NOT EXISTS (
            SELECT 1 FROM service_assignments sa2
              JOIN scheduled_services s2 ON s2.id = sa2.service_id
             WHERE sa2.subject_id = p.id AND sa2.subject_type = 'person'
               AND sa2.removed_at IS NULL
               AND s2.id <> s.id
               AND s2.status NOT IN ('cancelled', 'completed')
               AND s2.starts_at < s.ends_at AND s2.ends_at > s.starts_at
          )
          AND ($2::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM roster_shifts rs
              JOIN scheduled_services s3 ON s3.id = rs.service_id
             WHERE rs.roster_id = $2 AND rs.person_id = p.id
               AND s3.id <> s.id
               AND s3.starts_at < s.ends_at AND s3.ends_at > s.starts_at
          ))
          AND ($3::uuid[] IS NULL OR p.id <> ALL($3))
          AND NOT EXISTS (
            SELECT 1 FROM service_assignments sa3
              JOIN scheduled_services s4 ON s4.id = sa3.service_id
             WHERE sa3.subject_id = p.id AND sa3.subject_type = 'person'
               AND sa3.removed_at IS NULL
               AND s4.id <> s.id
               AND s4.ends_at > s.starts_at - ($4 || ' hours')::interval
               AND s4.ends_at <= s.starts_at
          )
          AND ($2::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM roster_shifts rs2
              JOIN scheduled_services s5 ON s5.id = rs2.service_id
             WHERE rs2.roster_id = $2 AND rs2.person_id = p.id
               AND s5.id <> s.id
               AND s5.ends_at > s.starts_at - ($4 || ' hours')::interval
               AND s5.ends_at <= s.starts_at
          ))
          AND (
            SELECT count(DISTINCT d) FROM (
              SELECT (s6.starts_at AT TIME ZONE s.timezone)::date AS d
                FROM service_assignments sa4
                JOIN scheduled_services s6 ON s6.id = sa4.service_id
               WHERE sa4.subject_id = p.id AND sa4.subject_type = 'person'
                 AND sa4.removed_at IS NULL
                 AND (s6.starts_at AT TIME ZONE s.timezone)::date
                     BETWEEN (s.starts_at AT TIME ZONE s.timezone)::date - 6
                         AND (s.starts_at AT TIME ZONE s.timezone)::date - 1
              UNION ALL
              SELECT (s7.starts_at AT TIME ZONE s.timezone)::date AS d
                FROM roster_shifts rs3
                JOIN scheduled_services s7 ON s7.id = rs3.service_id
               WHERE rs3.person_id = p.id
                 AND ($2::uuid IS NULL OR rs3.roster_id = $2)
                 AND (s7.starts_at AT TIME ZONE s.timezone)::date
                     BETWEEN (s.starts_at AT TIME ZONE s.timezone)::date - 6
                         AND (s.starts_at AT TIME ZONE s.timezone)::date - 1
            ) worked
          ) < $5
        ORDER BY p.id, aa.created_at
     )
     SELECT * FROM candidates ORDER BY name`

export async function eligibleCrew(
  serviceId: string,
  opts: { rosterId?: string; exclude?: string[]; skipRules?: boolean } = {},
): Promise<EligibleCrew[]> {
  const rules = await getRosterRules()
  const { min_rest_hours, max_consecutive_days } = rules
  const params = [
    serviceId,
    opts.rosterId ?? null,
    opts.exclude?.length ? opts.exclude : null,
  ]

  if (!opts.skipRules) {
    const rows = await query<EligibleCrew>(ELIGIBLE_SQL, [...params, min_rest_hours, max_consecutive_days])
    return rows.map(r => ({ ...r, blocked_reason: null }))
  }

  // Override mode: run permissive (rules disabled) then strict to annotate
  // who would normally be blocked.
  const [permissive, strict] = await Promise.all([
    query<EligibleCrew>(ELIGIBLE_SQL, [...params, 0, 999]),
    query<EligibleCrew>(ELIGIBLE_SQL, [...params, min_rest_hours, max_consecutive_days]),
  ])

  const strictIds = new Set(strict.map(r => r.person_id))

  return permissive.map(r => ({
    ...r,
    blocked_reason: strictIds.has(r.person_id)
      ? null
      : `Exceeds rules: min ${min_rest_hours}h rest between shifts, max ${max_consecutive_days} days in 7`,
  }))
}

// ── Rosters ───────────────────────────────────────────────────────────────────
// week_start is always a Monday; callers pass any date in the week and the
// date_trunc normalises it, so "generate for Wednesday" means that Wednesday's week.
export const getRosterByWeek = (anyDateInWeek: string) =>
  one<Roster>(
    `${SELECT_ROSTER} WHERE week_start = date_trunc('week', $1::date)::date AND deleted_at IS NULL`,
    [anyDateInWeek],
  )

export const getRoster = (id: string) =>
  one<Roster>(`${SELECT_ROSTER} WHERE id = $1 AND deleted_at IS NULL`, [id])

export const listRosters = (limit = 26, publishedOnly = false) =>
  query<Roster>(
    `${SELECT_ROSTER} WHERE deleted_at IS NULL${publishedOnly ? " AND status = 'published'" : ''} ORDER BY week_start DESC LIMIT $1`,
    [limit],
  )

export const createRoster = (anyDateInWeek: string, createdBy: string | null) =>
  one<Roster>(
    `WITH upserted AS (
       INSERT INTO rosters (week_start, created_by)
       VALUES (date_trunc('week', $1::date)::date, $2)
       ON CONFLICT (week_start) WHERE deleted_at IS NULL
         DO UPDATE SET generated_at = now(), status = 'draft', published_at = NULL
       RETURNING *
     )
     SELECT id, week_start::text AS week_start, status,
            generated_at, published_at, deleted_at, created_at, created_by
       FROM upserted`,
    [anyDateInWeek, createdBy],
  )

// ── Roster detail ─────────────────────────────────────────────────────────────
// Two queries stitched in JS rather than one nested aggregate: the service list
// and the shift list are both small, and this stays readable.
export async function getRosterDetail(rosterId: string): Promise<RosterDetail | null> {
  const roster = await getRoster(rosterId)
  if (!roster) return null

  const services = await query<{
    id: string; name: string; starts_at: string; ends_at: string; timezone: string
    facility_id: string | null; facility_name: string | null
    status: ServiceStatus; required_roles: RequiredRole[]
    has_asset: boolean
  }>(
    `SELECT s.id, s.name, s.starts_at, s.ends_at, s.timezone,
            s.facility_id, fa.name AS facility_name,
            s.status, s.required_roles,
            EXISTS (
              SELECT 1 FROM service_assignments sa
               WHERE sa.service_id = s.id AND sa.subject_type = 'asset' AND sa.removed_at IS NULL
            ) AS has_asset
       FROM scheduled_services s
       LEFT JOIN assets fa ON fa.id = s.facility_id
      WHERE (s.starts_at AT TIME ZONE s.timezone)::date >= $1::date
        AND (s.starts_at AT TIME ZONE s.timezone)::date <  $1::date + INTERVAL '7 days'
        AND s.status NOT IN ('cancelled', 'completed')
      ORDER BY s.starts_at`,
    [roster.week_start],
  )

  // Draft reads from roster_shifts (staging). Published reads from
  // service_assignments (live) so edits via the assign screen show up.
  const shifts = roster.status === 'published'
    ? await query<RosterShift>(
        `SELECT sa.id, $1::uuid AS roster_id, sa.service_id, sa.subject_id AS person_id,
                p.name AS person_name, sa.role,
                sa.confirmed_at, sa.declined_at,
                rs.asset_id, a.name AS asset_name,
                sa.assigned_at AS created_at
           FROM service_assignments sa
           JOIN people p ON p.id = sa.subject_id
           LEFT JOIN roster_shifts rs ON rs.service_id = sa.service_id
             AND rs.person_id = sa.subject_id
             AND rs.roster_id = $1
           LEFT JOIN assets a ON a.id = rs.asset_id
          WHERE sa.roster_id = $1 AND sa.subject_type = 'person' AND sa.removed_at IS NULL
          ORDER BY p.name`,
        [rosterId],
      )
    : await query<RosterShift>(
        `SELECT rs.*, p.name AS person_name, a.name AS asset_name
           FROM roster_shifts rs
           JOIN people p     ON p.id = rs.person_id
           LEFT JOIN assets a ON a.id = rs.asset_id
          WHERE rs.roster_id = $1
          ORDER BY p.name`,
        [rosterId],
      )

  const byService = new Map<string, RosterShift[]>()
  for (const sh of shifts) {
    const list = byService.get(sh.service_id) ?? []
    list.push(sh)
    byService.set(sh.service_id, list)
  }

  const rows: RosterServiceRow[] = []
  for (const s of services) {
    const mine = byService.get(s.id) ?? []
    const required = (s.required_roles ?? []).reduce((n, r) => n + r.count, 0)
    const shortfall = required > 0 ? Math.max(0, required - mine.length) : 0
    const needsDiagnosis = mine.length === 0 || shortfall > 0

    let gap_reason: string | null = null
    if (needsDiagnosis) {
      gap_reason = await diagnoseGap(s.id, s.has_asset, roster.id)
    }

    rows.push({
      service_id: s.id,
      name: s.name,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      timezone: s.timezone,
      facility_id: s.facility_id,
      facility_name: s.facility_name,
      status: s.status,
      has_asset: s.has_asset,
      required,
      shortfall,
      gap_reason,
      shifts: mine,
    })
  }

  return { roster, services: rows }
}

async function diagnoseGap(serviceId: string, hasAsset: boolean, rosterId: string): Promise<string> {
  if (!hasAsset) return 'No asset assigned to this service.'

  const [{ total_crew }] = await query<{ total_crew: string }>(
    `SELECT count(DISTINCT aa.person_id)::text AS total_crew
       FROM service_assignments sa
       JOIN asset_assignments aa ON aa.asset_id = sa.subject_id
       JOIN people p ON p.id = aa.person_id AND p.active
      WHERE sa.service_id = $1 AND sa.subject_type = 'asset' AND sa.removed_at IS NULL`,
    [serviceId],
  )
  if (Number(total_crew) === 0) return 'The asset has no crew assigned to it.'

  const eligible = await eligibleCrew(serviceId, { rosterId })
  if (eligible.length === 0)
    return `All ${total_crew} crew are unavailable, on other shifts, or need rest.`
  return `${eligible.length} of ${total_crew} crew available — shortfall may be a role mismatch.`
}

// ── Shifts ────────────────────────────────────────────────────────────────────
export const addRosterShift = (d: {
  roster_id: string; service_id: string; person_id: string; asset_id?: string | null; role?: string | null; rule_override?: boolean
}) =>
  one<RosterShift>(
    `WITH ins AS (
       INSERT INTO roster_shifts (roster_id, service_id, person_id, asset_id, role, rule_override)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (roster_id, service_id, person_id) DO UPDATE
         SET asset_id = EXCLUDED.asset_id, role = EXCLUDED.role, rule_override = EXCLUDED.rule_override
       RETURNING *
     )
     SELECT i.*, p.name AS person_name, a.name AS asset_name
       FROM ins i
       JOIN people p      ON p.id = i.person_id
       LEFT JOIN assets a ON a.id = i.asset_id`,
    [d.roster_id, d.service_id, d.person_id, d.asset_id ?? null, d.role ?? null, d.rule_override ?? false],
  )

export const deleteRosterShift = async (rosterId: string, shiftId: string): Promise<boolean> =>
  (await query<{ id: string }>(
    `DELETE FROM roster_shifts WHERE id = $1 AND roster_id = $2 RETURNING id`,
    [shiftId, rosterId],
  )).length > 0

// ── Publish ──────────────────────────────────────────────────────────────────
// The one-way door: copies roster_shifts → service_assignments. Each shift
// becomes a person assignment on the service, tagged with roster_id so the
// detail screen can find them. Uses NOT EXISTS instead of ON CONFLICT because
// service_assignments has no unique constraint on (service_id, subject_id).
export async function publishRoster(rosterId: string, publishedBy: string | null): Promise<Roster> {
  const roster = await getRoster(rosterId)
  if (!roster) throw new Error('roster not found')
  if (roster.status === 'published') return roster

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const { rows: shifts } = await client.query<{
      service_id: string; person_id: string; asset_id: string | null; role: string | null; rule_override: boolean
    }>(
      `SELECT service_id, person_id, asset_id, role, rule_override FROM roster_shifts WHERE roster_id = $1`,
      [rosterId],
    )

    for (const sh of shifts) {
      await client.query(
        `INSERT INTO service_assignments (service_id, subject_type, subject_id, role, assigned_by, roster_id, rule_override)
         SELECT $1, 'person'::service_subject_type_enum, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (
           SELECT 1 FROM service_assignments
            WHERE service_id = $1 AND subject_id = $2 AND subject_type = 'person'
              AND removed_at IS NULL AND roster_id = $5
         )`,
        [sh.service_id, sh.person_id, sh.role, publishedBy, rosterId, sh.rule_override],
      )
    }

    await client.query(
      `UPDATE rosters SET status = 'published', published_at = now() WHERE id = $1`,
      [rosterId],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return (await getRoster(rosterId))!
}

// ── Soft delete ─────────────────────────────────────────────────────────────
// Marks the roster deleted and soft-removes all service_assignments that were
// created by publishing it. Roster_shifts stay for traceability (cascade will
// clean them if the roster row is ever hard-deleted).
export async function deleteRoster(rosterId: string): Promise<boolean> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    // Soft-remove all person assignments that came from this roster.
    await client.query(
      `UPDATE service_assignments SET removed_at = now()
        WHERE roster_id = $1 AND subject_type = 'person' AND removed_at IS NULL`,
      [rosterId],
    )

    const { rowCount } = await client.query(
      `UPDATE rosters SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [rosterId],
    )

    await client.query('COMMIT')
    return (rowCount ?? 0) > 0
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Confirm / decline ────────────────────────────────────────────────────────
export const confirmAssignment = (assignmentId: string, personId: string) =>
  one<{ id: string; confirmed_at: string }>(
    `UPDATE service_assignments
        SET confirmed_at = now(), declined_at = NULL
      WHERE id = $1 AND subject_id = $2 AND subject_type = 'person' AND removed_at IS NULL
      RETURNING id, confirmed_at`,
    [assignmentId, personId],
  )

export const declineAssignment = (assignmentId: string, personId: string) =>
  one<{ id: string; declined_at: string }>(
    `UPDATE service_assignments
        SET declined_at = now(), confirmed_at = NULL
      WHERE id = $1 AND subject_id = $2 AND subject_type = 'person' AND removed_at IS NULL
      RETURNING id, declined_at`,
    [assignmentId, personId],
  )

// People rostered for a given roster — used for push notifications on publish.
export const rosteredPeopleIds = async (rosterId: string): Promise<string[]> => {
  const rows = await query<{ person_id: string }>(
    `SELECT DISTINCT person_id FROM roster_shifts WHERE roster_id = $1`,
    [rosterId],
  )
  return rows.map(r => r.person_id)
}

// ── Sick day → auto-decline ──────────────────────────────────────────────────
// When someone logs a sick day on a date where they hold live assignments,
// auto-set declined_at on those assignments. Returns the count declined.
export async function autoDeclineForSickDay(personId: string, date: string, timezone?: string): Promise<number> {
  const tz = timezone ?? 'UTC'
  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE service_assignments
        SET declined_at = now()
      WHERE subject_id = $1
        AND subject_type = 'person'
        AND removed_at IS NULL
        AND declined_at IS NULL
        AND service_id IN (
          SELECT id FROM scheduled_services
           WHERE (starts_at AT TIME ZONE $3)::date = $2::date
             AND status NOT IN ('cancelled', 'completed')
        )
      RETURNING id`,
    [personId, date, tz],
  )
  return rows.length
}

// ── Open shifts (needs cover) ────────────────────────────────────────────────
// Assignments on a published roster where someone declined but hasn't been
// removed — the gap the cover flow fills.
export interface OpenShift {
  assignment_id: string
  service_id: string
  service_name: string
  starts_at: string
  ends_at: string
  timezone: string
  facility_id: string | null
  facility_name: string | null
  declined_person_name: string
  role: string | null
}

export const listOpenShifts = (rosterId: string) =>
  query<OpenShift>(
    `SELECT sa.id AS assignment_id, sa.service_id,
            s.name AS service_name, s.starts_at, s.ends_at, s.timezone,
            s.facility_id, fa.name AS facility_name,
            p.name AS declined_person_name, sa.role
       FROM service_assignments sa
       JOIN scheduled_services s ON s.id = sa.service_id
       LEFT JOIN assets fa ON fa.id = s.facility_id
       JOIN people p ON p.id = sa.subject_id
      WHERE sa.roster_id = $1
        AND sa.subject_type = 'person'
        AND sa.declined_at IS NOT NULL
        AND sa.removed_at IS NULL
      ORDER BY s.starts_at`,
    [rosterId],
  )

// ── Cover: first-accept-wins ─────────────────────────────────────────────────
// Soft-removes the declined person and inserts the covering person in one
// transaction. The race guard is the WHERE removed_at IS NULL RETURNING — the
// second concurrent acceptor gets zero rows back and is told it's covered.
export async function acceptCover(
  assignmentId: string,
  coverPersonId: string,
  rosterId: string,
): Promise<{ covered: boolean; newAssignmentId?: string }> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    // Soft-remove the declined assignment — race guard.
    const { rows: removed } = await client.query<{ service_id: string; role: string | null }>(
      `UPDATE service_assignments
          SET removed_at = now()
        WHERE id = $1
          AND declined_at IS NOT NULL
          AND removed_at IS NULL
        RETURNING service_id, role`,
      [assignmentId],
    )

    if (removed.length === 0) {
      await client.query('ROLLBACK')
      return { covered: false }
    }

    const { service_id, role } = removed[0]

    // Insert the covering person's assignment.
    const { rows: [ins] } = await client.query<{ id: string }>(
      `INSERT INTO service_assignments (service_id, subject_type, subject_id, role, roster_id, confirmed_at)
       VALUES ($1, 'person'::service_subject_type_enum, $2, $3, $4, now())
       RETURNING id`,
      [service_id, coverPersonId, role, rosterId],
    )

    await client.query('COMMIT')
    return { covered: true, newAssignmentId: ins.id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Generation ────────────────────────────────────────────────────────────────
// Builds a draft week from the asset→crew mapping. Deliberately writes nothing
// the rest of the app reads: everything lands in roster_shifts until published.
//
// Regenerating replaces the week's draft rather than adding to it, so running it
// twice is the same as running it once.
export async function generateRoster(
  anyDateInWeek: string,
  createdBy: string | null,
): Promise<{ roster: Roster; shifts: number; servicesWithGaps: number }> {
  const roster = (await createRoster(anyDateInWeek, createdBy))!

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    // Clear previous draft shifts.
    await client.query('DELETE FROM roster_shifts WHERE roster_id = $1', [roster.id])
    // If this was previously published, soft-remove those live assignments so
    // the new generation starts clean.
    await client.query(
      `UPDATE service_assignments SET removed_at = now()
        WHERE roster_id = $1 AND subject_type = 'person' AND removed_at IS NULL`,
      [roster.id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const services = await query<{ id: string; required_roles: RequiredRole[] }>(
    `SELECT id, required_roles FROM scheduled_services
      WHERE (starts_at AT TIME ZONE timezone)::date >= $1::date
        AND (starts_at AT TIME ZONE timezone)::date <  $1::date + INTERVAL '7 days'
        AND status NOT IN ('cancelled', 'completed')
      ORDER BY starts_at`,
    [roster.week_start],
  )

  // How many shifts each person already holds this week, so work spreads instead
  // of always landing on whoever sorts first.
  const load = new Map<string, number>()
  let shifts = 0
  let servicesWithGaps = 0

  for (const svc of services) {
    const eligible = await eligibleCrew(svc.id, { rosterId: roster.id })
    const roles = svc.required_roles ?? []
    const sorted = [...eligible]
      .sort((a, b) => (load.get(a.person_id) ?? 0) - (load.get(b.person_id) ?? 0)
        || a.name.localeCompare(b.name))

    const picked: typeof eligible = []
    const usedIds = new Set<string>()

    if (roles.length > 0) {
      // Fill each role slot with someone whose asset_assignments role matches.
      for (const { role, count } of roles) {
        const rLower = role.toLowerCase()
        let filled = 0
        for (const c of sorted) {
          if (filled >= count) break
          if (usedIds.has(c.person_id)) continue
          if ((c.role ?? '').toLowerCase() !== rLower) continue
          picked.push(c)
          usedIds.add(c.person_id)
          filled++
        }
      }
    } else {
      // No required_roles — take everyone eligible.
      for (const c of sorted) picked.push(c)
    }

    for (const c of picked) {
      await addRosterShift({
        roster_id: roster.id,
        service_id: svc.id,
        person_id: c.person_id,
        asset_id: c.asset_id,
        role: c.role,
      })
      load.set(c.person_id, (load.get(c.person_id) ?? 0) + 1)
      shifts++
    }

    const required = roles.reduce((n, r) => n + r.count, 0)
    if (required > 0 ? picked.length < required : picked.length === 0) servicesWithGaps++
  }

  return { roster, shifts, servicesWithGaps }
}
