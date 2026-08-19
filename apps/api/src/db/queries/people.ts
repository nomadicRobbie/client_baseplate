import { query } from '../pool'
import type { Person } from '@blnk/shared'

// People core queries. Reads embed the person's per-module memberships as a JSON
// array (person.modules) so a single round-trip returns the whole person.

// Shared projection: people row + aggregated modules. `$SCOPE` is spliced in by
// callers as an extra WHERE clause (already parameterised) or empty string.
const SELECT_PERSON = `
  SELECT p.*, COALESCE(
    (SELECT json_agg(json_build_object('module', pm.module, 'role', pm.role) ORDER BY pm.module)
       FROM person_module pm WHERE pm.person_id = p.id),
    '[]'::json) AS modules
  FROM people p`

export interface PeopleFilters {
  module?: string   // only people assigned to this module
  active?: boolean  // default: all
}

export async function listPeople(f: PeopleFilters = {}): Promise<Person[]> {
  return query<Person>(
    `${SELECT_PERSON}
     WHERE ($1::text IS NULL OR EXISTS (
       SELECT 1 FROM person_module pm WHERE pm.person_id = p.id AND pm.module = $1))
       AND ($2::boolean IS NULL OR p.active = $2)
     ORDER BY p.name`,
    [f.module ?? null, f.active ?? null],
  )
}

export async function getPerson(id: string): Promise<Person | null> {
  const rows = await query<Person>(`${SELECT_PERSON} WHERE p.id = $1`, [id])
  return rows[0] ?? null
}

// Resolve the person for a signed-in blnk user (JWT `sub`). Null when the user
// has no person row yet (e.g. a login created outside the people flow).
export async function getPersonByUserId(userId: string): Promise<Person | null> {
  const rows = await query<Person>(`${SELECT_PERSON} WHERE p.user_id = $1`, [userId])
  return rows[0] ?? null
}

export interface NewPerson {
  name: string
  email?: string | null
  phone?: string | null
  user_id?: string | null   // link to an existing login, or null for login-less
}

export async function createPerson(p: NewPerson): Promise<Person> {
  const rows = await query<{ id: string }>(
    `INSERT INTO people (name, email, phone, user_id)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [p.name, p.email ?? null, p.phone ?? null, p.user_id ?? null],
  )
  return (await getPerson(rows[0].id))!   // re-read to include (empty) modules
}

// Allow-listed partial update — no generic column injection (mirrors compliance).
export async function updatePerson(
  id: string,
  patch: Partial<Pick<Person, 'name' | 'email' | 'phone' | 'user_id' | 'active'>>,
): Promise<Person | null> {
  const cols: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const key of ['name', 'email', 'phone', 'user_id', 'active'] as const) {
    if (patch[key] !== undefined) { cols.push(`${key} = $${i++}`); vals.push(patch[key]) }
  }
  if (cols.length === 0) return getPerson(id)
  cols.push(`updated_at = now()`)
  vals.push(id)
  const rows = await query<{ id: string }>(
    `UPDATE people SET ${cols.join(', ')} WHERE id = $${i} RETURNING id`, vals,
  )
  if (rows.length === 0) return null
  return getPerson(id)
}

// Assign a person to a module (or change their role there) — upsert on (person, module).
export async function setPersonModule(personId: string, module: string, role: string): Promise<void> {
  await query(
    `INSERT INTO person_module (person_id, module, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (person_id, module) DO UPDATE SET role = EXCLUDED.role`,
    [personId, module, role],
  )
}

export async function removePersonModule(personId: string, module: string): Promise<boolean> {
  const rows = await query<{ person_id: string }>(
    `DELETE FROM person_module WHERE person_id = $1 AND module = $2 RETURNING person_id`,
    [personId, module],
  )
  return rows.length > 0
}

export async function setPushToken(personId: string, token: string | null): Promise<void> {
  await query(
    `UPDATE people SET push_token = $1, updated_at = now() WHERE id = $2`,
    [token, personId],
  )
}

// Push tokens for people assigned to one or more modules.
// Pass an empty array to get tokens for all active app users (any user_id).
export async function getPushTokensForModules(modules: string[]): Promise<string[]> {
  if (modules.length === 0) {
    const rows = await query<{ push_token: string }>(
      `SELECT push_token FROM people WHERE user_id IS NOT NULL AND push_token IS NOT NULL AND active = true`,
    )
    return rows.map(r => r.push_token)
  }
  const rows = await query<{ push_token: string }>(
    `SELECT DISTINCT p.push_token
     FROM people p
     JOIN person_module pm ON pm.person_id = p.id
     WHERE pm.module = ANY($1) AND p.push_token IS NOT NULL AND p.active = true`,
    [modules],
  )
  return rows.map(r => r.push_token)
}

// Push tokens for specific people (used for mention notifications).
export async function getPushTokensForPeople(personIds: string[]): Promise<string[]> {
  if (personIds.length === 0) return []
  const rows = await query<{ push_token: string }>(
    `SELECT push_token FROM people WHERE id = ANY($1) AND push_token IS NOT NULL`,
    [personIds],
  )
  return rows.map(r => r.push_token)
}
