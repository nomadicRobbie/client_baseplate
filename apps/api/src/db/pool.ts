import pg, { Pool, QueryResultRow } from 'pg'
import { config } from '../config'

// ponytail: DATE (oid 1082) as plain string — prevents timezone-shift bug in +offset zones
pg.types.setTypeParser(1082, (v: string) => v)

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err) => console.error({ err, msg: 'pg pool error' }))
  }
  return pool
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query<T>(text, params)
  return result.rows
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
