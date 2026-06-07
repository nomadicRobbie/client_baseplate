import { config as loadEnv } from 'dotenv'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { Pool } from 'pg'

// Load apps/api/.env by absolute path (src/db → ../../.env), cwd-independent.
loadEnv({ path: resolve(__dirname, '../../.env') })

// Per-client schema migrations. Client-specific tables (members, etc.) are added
// here per engagement. The baseplate ships with none beyond the tracking table.
async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing required environment variable: DATABASE_URL')

  const pool = new Pool({ connectionString: url })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id        SERIAL PRIMARY KEY,
      filename  TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const dir = join(__dirname, 'migrations')
  const files = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    : []

  for (const file of files) {
    const { rows } = await pool.query('SELECT id FROM _migrations WHERE filename = $1', [file])
    if (rows.length > 0) { console.log(`  skip  ${file}`); continue }
    await pool.query(readFileSync(join(dir, file), 'utf-8'))
    await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
    console.log(`  apply ${file}`)
  }

  console.log('migrations complete')
  await pool.end()
}

migrate().catch(err => { console.error(err); process.exit(1) })
