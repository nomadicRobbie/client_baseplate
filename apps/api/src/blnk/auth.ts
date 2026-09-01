import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import type { BlnkUser, UserRole } from '@blnk/shared'
import { verifyBlnkToken } from './jwks'
import { getPersonByUserId } from '../db/queries/people'

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

// ── preHandler: operator-app access gate ────────────────────────────────────
// This dashboard is a provisioned-access app: the signed-in user must be someone
// we granted access to — an admin/super (runs the tenant) or a person on the
// roster. Blocks stray or self-provisioned logins from reaching operator data
// even if they hold a valid token. Run after verifyBlnkAuth.
export async function requireAppAccess(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'authentication required', status: 401, request_id: req.id },
    })
  }
  if (req.user.role === 'admin' || req.user.role === 'super') return
  const person = await getPersonByUserId(req.user.userId)
  if (!person || !person.active) {
    return reply.status(403).send({
      error: { code: 'NO_APP_ACCESS', message: 'no access to this app', status: 403, request_id: req.id },
    })
  }
}

// Resolves the person_id to scope member-facing queries by. Admins/supers get
// null — no filter, they see everything. Members get their own person id, so a
// query filtered on it returns only their rows. Shared by schedule and roster:
// two copies of this would drift the day one of them changed.
export async function callerPersonId(userId: string, role: string): Promise<string | null> {
  if (role === 'admin' || role === 'super') return null
  const person = await getPersonByUserId(userId)
  return person?.id ?? null
}

// ── preHandler factory: module access guard ─────────────────────────────────
// A member may use a module only if they're assigned to it in People (person_module).
// Admin/super bypass (they run the tenant). This is the SERVER enforcement behind
// the frontend nav gating — run after verifyBlnkAuth on a module's operational routes.
export function requireModule(moduleKey: string) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.user) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'authentication required', status: 401, request_id: req.id },
      })
    }
    if (req.user.role === 'admin' || req.user.role === 'super') return
    const person = await getPersonByUserId(req.user.userId)
    const assigned = !!person && person.active && person.modules.some((m) => m.module === moduleKey)
    if (!assigned) {
      return reply.status(403).send({
        error: { code: 'NO_MODULE_ACCESS', message: `no access to ${moduleKey}`, status: 403, request_id: req.id },
      })
    }
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
