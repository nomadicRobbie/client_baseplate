import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { config } from '../config'

// ── Auth proxy (Option 1 — blnk stays invisible to end users) ───────────────
// The frontend calls client_api /auth/*; we forward to blnk_auth server-to-server.
// The end user's browser never talks to blnk_auth directly.
//
// WebAuthn note: passkey verification in blnk_auth checks the origin embedded in
// the browser's clientDataJSON (set to the frontend's real origin), NOT the HTTP
// Origin header — so proxying doesn't affect ceremony validation, provided the
// frontend origin is in the tenant's allowed_origins in blnk_auth.
//
// Only these exact paths are proxied — we don't blindly forward everything.
const PROXIED = new Set([
  '/auth/otp/send',
  '/auth/otp/verify',
  '/auth/refresh',
  '/auth/logout',
  '/auth/passkey/register/begin',
  '/auth/passkey/register/complete',
  '/auth/passkey/login/begin',
  '/auth/passkey/login/complete',
])

async function forward(req: FastifyRequest): Promise<{ status: number; body: string; contentType: string }> {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body != null
  const headers: Record<string, string> = {}
  if (hasBody) headers['content-type'] = 'application/json'
  const auth = req.headers.authorization
  if (auth) headers['authorization'] = auth
  // Preserve client IP for blnk_auth rate-limiting / audit.
  headers['x-forwarded-for'] = req.ip

  const res = await fetch(`${config.blnkAuth.url}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,
  })

  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type') ?? 'application/json',
  }
}

const authProxyPlugin: FastifyPluginAsync = async (fastify) => {
  const handler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!PROXIED.has(req.url.split('?')[0])) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `auth route ${req.url} not proxied`, status: 404, request_id: req.id },
      })
    }
    try {
      const { status, body, contentType } = await forward(req)
      return reply.status(status).header('content-type', contentType).send(body)
    } catch (err) {
      req.log.error({ err }, 'auth proxy failed')
      return reply.status(502).send({
        error: { code: 'BAD_GATEWAY', message: 'auth upstream unavailable', status: 502, request_id: req.id },
      })
    }
  }

  // POST covers every current blnk_auth auth endpoint.
  fastify.post('/auth/*', { config: { rateLimit: { max: 20, timeWindow: 15 * 60 * 1000 } } }, handler)
}

export default authProxyPlugin
