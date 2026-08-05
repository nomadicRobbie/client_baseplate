import { query } from '../pool'

export interface LocationEntry {
  id: string
  location: string
  starts_at: string
  note: string | null
  created_at: string
}

// Public — next event that started within the last 3 hours or is still upcoming
export async function getNextLocation(): Promise<LocationEntry | null> {
  const rows = await query<LocationEntry>(
    `SELECT id, location, starts_at, note, created_at
     FROM locations
     WHERE starts_at >= now() - interval '3 hours'
     ORDER BY starts_at ASC
     LIMIT 1`,
    [],
  )
  return rows[0] ?? null
}

// Dashboard — all upcoming locations (future only)
export async function getUpcomingLocations(): Promise<LocationEntry[]> {
  return query<LocationEntry>(
    `SELECT id, location, starts_at, note, created_at
     FROM locations
     WHERE starts_at >= now() - interval '3 hours'
     ORDER BY starts_at ASC`,
    [],
  )
}

export async function createLocation(
  location: string,
  starts_at: string,
  note?: string,
): Promise<LocationEntry> {
  const rows = await query<LocationEntry>(
    `INSERT INTO locations (location, starts_at, note)
     VALUES ($1, $2, $3)
     RETURNING id, location, starts_at, note, created_at`,
    [location, starts_at, note ?? null],
  )
  return rows[0]
}

export async function deleteLocation(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM locations WHERE id = $1 RETURNING id`,
    [id],
  )
  return rows.length > 0
}
