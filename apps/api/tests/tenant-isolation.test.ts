import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose'

// Hermetic isolation test: proves the client_api rejects a genuinely-signed
// blnk_auth token minted for a DIFFERENT tenant. We stand up a throwaway JWKS
// endpoint backed by a local keypair and set env BEFORE importing the app, so
// no running blnk_auth or database is required. /me only needs token
// verification (verifyBlnkAuth → verifyBlnkToken), which is the guard under test.

const KID = 'test-key'

async function startJwksServer(publicKey: KeyLike): Promise<{ url: string; close: () => void }> {
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

test('foreign-tenant token is rejected; own-tenant token is accepted', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwks = await startJwksServer(publicKey)

  // Env must be set before importing config/server (both read env at import).
  process.env.NODE_ENV = 'test'
  process.env.TENANT_SLUG = 'ting-test'
  process.env.DATABASE_URL = 'postgres://unused:unused@localhost:1/none' // /me never queries
  process.env.BLNK_AUTH_URL = jwks.url
  process.env.ALLOWED_ORIGINS = ''
  for (const f of ['STRIPE', 'ONE_OFF', 'SUBSCRIPTIONS', 'COMMERCE', 'ANALYTICS', 'COMPLIANCE', 'LOCATIONS']) {
    process.env[`FEATURE_${f}`] = 'false' // keep build() to core routes only
  }

  const { build } = await import('../src/server')
  const app = await build()

  const mint = (tslug: string) =>
    new SignJWT({ tid: 'tenant-1', tslug, role: 'admin', type: 'end_user' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('blnk-auth')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

  const own = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${await mint('ting-test')}` } })
  const foreign = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${await mint('earth-to-oven')}` } })

  assert.equal(own.statusCode, 200, 'own-tenant token must be accepted')
  assert.equal(foreign.statusCode, 401, 'foreign-tenant token must be rejected')
  assert.match(foreign.json().error.message, /different tenant|not 'ting-test'/i)

  await app.close()
  jwks.close()
})
