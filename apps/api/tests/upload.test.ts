import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// Hermetic upload presign tests. `presignedPutObject` is pure URL construction
// so no real MinIO instance is needed. `initStorage` lives in `start()`, not
// `build()`, so it's never called here.

const KID = 'upload-test-key'
const TENANT = 'upload-test-tenant'

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

let app: Awaited<ReturnType<typeof import('../src/server')['build']>>
let privateKey: KeyLike
let jwks: { url: string; close: () => void }

const mint = (role = 'end_user') =>
  new SignJWT({ tid: 'tenant-1', tslug: TENANT, role, type: 'end_user' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer('blnk-auth')
    .setSubject('user-upload-test')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

test('setup: start jwks server and build app', async () => {
  const kp = await generateKeyPair('RS256')
  privateKey = kp.privateKey
  jwks = await startJwksServer(kp.publicKey)

  process.env.NODE_ENV = 'test'
  process.env.TENANT_SLUG = TENANT
  process.env.DATABASE_URL = 'postgres://unused:unused@localhost:1/none'
  process.env.BLNK_AUTH_URL = jwks.url
  process.env.ALLOWED_ORIGINS = ''
  process.env.STORAGE_ENDPOINT = 'http://localhost:9999'
  process.env.STORAGE_ACCESS_KEY = 'testkey'
  process.env.STORAGE_SECRET_KEY = 'testsecret12345'
  process.env.STORAGE_BUCKET = 'test-bucket'
  process.env.STORAGE_PUBLIC_URL = 'http://localhost:9999/test-bucket'
  for (const f of ['STRIPE', 'ONE_OFF', 'SUBSCRIPTIONS', 'COMMERCE', 'ANALYTICS', 'COMPLIANCE', 'LOCATIONS', 'ROSTER', 'ASSET', 'SCHEDULE']) {
    process.env[`FEATURE_${f}`] = 'false'
  }

  const { build } = await import('../src/server')
  app = await build()
  assert.ok(app, 'server built')
})

// ── Auth guard ───────────────────────────────────────────────────────────────

test('POST /upload/presign without token returns 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/upload/presign', payload: { mimetype: 'image/jpeg' } })
  assert.equal(res.statusCode, 401)
})

// ── Mimetype validation ──────────────────────────────────────────────────────

test('POST /upload/presign with unsupported mimetype returns 400', async () => {
  const token = await mint()
  const res = await app.inject({
    method: 'POST', url: '/upload/presign',
    headers: { authorization: `Bearer ${token}` },
    payload: { mimetype: 'application/exe' },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /upload/presign with missing mimetype returns 400', async () => {
  const token = await mint()
  const res = await app.inject({
    method: 'POST', url: '/upload/presign',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  })
  assert.equal(res.statusCode, 400)
})

// ── Image upload ─────────────────────────────────────────────────────────────

test('POST /upload/presign with image/jpeg returns presigned_url and public_url', async () => {
  const token = await mint()
  const res = await app.inject({
    method: 'POST', url: '/upload/presign',
    headers: { authorization: `Bearer ${token}` },
    payload: { mimetype: 'image/jpeg' },
  })
  assert.equal(res.statusCode, 200)
  const { presigned_url, public_url } = res.json()
  assert.ok(presigned_url.startsWith('http://localhost:9999/'), 'presigned_url uses configured endpoint')
  assert.ok(presigned_url.includes(TENANT + '/'), 'presigned_url key includes tenant slug')
  assert.ok(presigned_url.includes('.jpg'), 'presigned_url key includes correct extension')
  assert.ok(public_url.startsWith('http://localhost:9999/test-bucket/'), 'public_url uses configured public base')
  assert.ok(public_url.endsWith('.jpg'), 'public_url has correct extension')
})

test('POST /upload/presign with image/png returns .png extension', async () => {
  const token = await mint()
  const res = await app.inject({
    method: 'POST', url: '/upload/presign',
    headers: { authorization: `Bearer ${token}` },
    payload: { mimetype: 'image/png' },
  })
  assert.equal(res.statusCode, 200)
  const { presigned_url, public_url } = res.json()
  assert.ok(presigned_url.includes('.png'))
  assert.ok(public_url.endsWith('.png'))
})

// ── File upload ───────────────────────────────────────────────────────────────

test('POST /upload/presign with application/pdf returns presigned_url and public_url', async () => {
  const token = await mint()
  const res = await app.inject({
    method: 'POST', url: '/upload/presign',
    headers: { authorization: `Bearer ${token}` },
    payload: { mimetype: 'application/pdf' },
  })
  assert.equal(res.statusCode, 200)
  const { presigned_url, public_url } = res.json()
  assert.ok(presigned_url.startsWith('http://localhost:9999/'), 'presigned_url uses configured endpoint')
  assert.ok(presigned_url.includes(TENANT + '/'), 'key includes tenant slug')
  assert.ok(presigned_url.includes('.pdf'), 'key includes .pdf extension')
  assert.ok(public_url.endsWith('.pdf'), 'public_url has .pdf extension')
})

test('each presign call returns a unique key', async () => {
  const token = await mint()
  const [r1, r2] = await Promise.all([
    app.inject({ method: 'POST', url: '/upload/presign', headers: { authorization: `Bearer ${token}` }, payload: { mimetype: 'image/jpeg' } }),
    app.inject({ method: 'POST', url: '/upload/presign', headers: { authorization: `Bearer ${token}` }, payload: { mimetype: 'image/jpeg' } }),
  ])
  assert.equal(r1.statusCode, 200)
  assert.equal(r2.statusCode, 200)
  assert.notEqual(r1.json().public_url, r2.json().public_url, 'each call produces a unique key')
})

// ── Teardown ─────────────────────────────────────────────────────────────────

test('teardown: close server and jwks', async () => {
  await app.close()
  jwks.close()
})
