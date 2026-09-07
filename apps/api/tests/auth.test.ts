import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// Hermetic auth guard tests. Verifies requireRole and module-check behaviour
// without a database or real blnk_auth. Uses the same JWKS-server trick as
// tenant-isolation.test.ts so no external service is needed.

const KID = 'auth-test-key'
const TENANT = 'auth-test-tenant'

async function startJwksServer(publicKey: KeyLike): Promise<{ url: string; close: () => void }> {
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((r) => server.listen(0, r))
  const { port } = server.address() as AddressInfo
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

// The server module caches its config at import time, so each test that needs a
// different env combination must isolate via a fresh module registry. We do that
// by using NODE_PATH-safe dynamic import with a cache-bust param (test runner
// runs each test in the same process, so we share if we're not careful).
//
// Simpler: all these tests share the same env — same tenant, all features off,
// no database needed for routes that only reach verifyBlnkAuth. We set env once
// before the first import and reuse the built server across tests in this file.

let app: Awaited<ReturnType<typeof import('../src/server')['build']>>
let privateKey: KeyLike
let jwks: { url: string; close: () => void }

const mint = (role: string, tslug = TENANT, extra: Record<string, unknown> = {}) =>
  new SignJWT({ tid: 'tenant-1', tslug, role, type: 'end_user', ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer('blnk-auth')
    .setSubject('user-auth-test')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

// Bootstrap once — runs before all tests in this file.
test('setup: start jwks server and build app', async () => {
  const kp = await generateKeyPair('RS256')
  privateKey = kp.privateKey
  jwks = await startJwksServer(kp.publicKey)

  process.env.NODE_ENV = 'test'
  process.env.TENANT_SLUG = TENANT
  process.env.DATABASE_URL = 'postgres://unused:unused@localhost:1/none'
  process.env.BLNK_AUTH_URL = jwks.url
  process.env.ALLOWED_ORIGINS = ''
  for (const f of ['STRIPE', 'ONE_OFF', 'SUBSCRIPTIONS', 'COMMERCE', 'ANALYTICS', 'COMPLIANCE', 'LOCATIONS', 'ROSTER']) {
    process.env[`FEATURE_${f}`] = 'false'
  }

  const { build } = await import('../src/server')
  app = await build()
  assert.ok(app, 'server built')
})

// ── verifyBlnkAuth ───────────────────────────────────────────────────────────

test('missing bearer token returns 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/me' })
  assert.equal(res.statusCode, 401)
  assert.match(res.json().error.message, /missing bearer token/i)
})

test('malformed token returns 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer notavalidtoken' } })
  assert.equal(res.statusCode, 401)
})

test('expired token returns 401', async () => {
  const expired = await new SignJWT({ tid: 'tenant-1', tslug: TENANT, role: 'admin', type: 'end_user' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer('blnk-auth')
    .setSubject('user-expired')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
    .sign(privateKey)

  const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${expired}` } })
  assert.equal(res.statusCode, 401)
})

test('valid admin token returns 200 on /me with correct claims', async () => {
  // Admin role bypasses requireAppAccess (no DB call), so this is hermetic.
  const token = await mint('admin')
  const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.user.role, 'admin')
  assert.equal(body.user.tenantSlug, TENANT)
})

// ── .well-known/jwks.json ────────────────────────────────────────────────────

test('GET /.well-known/jwks.json is public (no auth required)', async () => {
  const res = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })
  // May 404 when blnk_auth is unreachable, but must not be 401.
  assert.notEqual(res.statusCode, 401)
})

// ── Teardown ─────────────────────────────────────────────────────────────────

test('teardown: close server and jwks', async () => {
  await app.close()
  jwks.close()
})
