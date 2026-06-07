import { createRemoteJWKSet, jwtVerify } from 'jose'
import { config } from '../config'
import type { BlnkTokenClaims } from '@blnk/shared'

// ── blnk_auth token verification via JWKS ───────────────────────────────────
// createRemoteJWKSet fetches blnk_auth's public key set and caches it in-process,
// refreshing on rotation. After the first fetch there is NO runtime dependency on
// blnk_auth to verify a token — verification is local crypto.
const JWKS = createRemoteJWKSet(
  new URL('/.well-known/jwks.json', config.blnkAuth.url)
)

export async function verifyBlnkToken(token: string): Promise<BlnkTokenClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'blnk-auth',
    algorithms: ['RS256'],
  })

  if (!payload.sub || !payload['tid'] || !payload['tslug'] || !payload['role']) {
    throw new Error('malformed blnk_auth token')
  }

  return payload as unknown as BlnkTokenClaims
}
