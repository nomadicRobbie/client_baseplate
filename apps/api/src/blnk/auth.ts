import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { BlnkUser, UserRole } from '@blnk/shared'
import { verifyBlnkToken } from './jwks'

declare module 'fastify' {
  interface FastifyRequest {
    user: BlnkUser | null
  }
}

// Decorates request.user — register before any route using verifyBlnkToken.
const authDecorators: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', null)
}

export default fp(authDecorators, { name: 'blnk-auth-decorators' })

// ── preHandler: verify a blnk_auth access token ─────────────────────────────
// Local verification via cached JWKS — no runtime call to blnk_auth.
export async function verifyBlnkAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'missing bearer token', status: 401, request_id: req.id },
    })
  }

  try {
    const claims = await verifyBlnkToken(header.slice(7))
    req.user = {
      userId: claims.sub,
      tenantId: claims.tid,
      tenantSlug: claims.tslug,
      type: claims.type,
      role: claims.role,
      passkey: claims.passkey,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid token'
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message, status: 401, request_id: req.id },
    })
  }
}

// ── preHandler factory: role guard ──────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.user || !roles.includes(req.user.role)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'insufficient permissions', status: 403, request_id: req.id },
      })
    }
  }
}
