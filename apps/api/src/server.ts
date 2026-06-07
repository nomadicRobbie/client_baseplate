import Fastify, { type FastifyError } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import { getPool, closePool } from './db/pool'
import authDecorators, { verifyBlnkAuth } from './blnk/auth'
import authProxyPlugin from './routes/auth-proxy'
import wellKnownPlugin from './routes/well-known'
import profilePlugin from './routes/profile'
import teamPlugin from './routes/team'

const server = Fastify({
  logger: {
    level: config.logLevel,
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, remoteAddress: req.socket?.remoteAddress }
      },
    },
    redact: ['req.headers.authorization', 'body.code', 'body.refresh_token'],
  },
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
  requestIdLogLabel: 'request_id',
  trustProxy: config.env === 'production',
})

async function build(): Promise<typeof server> {
  await server.register(helmet, { contentSecurityPolicy: config.env === 'production' })

  // Strip fingerprint headers (same hardening as blnk_auth).
  server.addHook('onSend', async (_req, reply) => {
    reply.removeHeader('Server')
    reply.removeHeader('X-Powered-By')
  })

  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error('Not allowed by CORS'), false)
      }
    },
    // Must be explicit — the frontend uses PUT for profile updates; the default
    // method set is narrower and the preflight would reject PUT/PATCH/DELETE.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
    credentials: true,
  })

  // In-memory rate limiting (no Redis dependency in the baseplate v1).
  await server.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    errorResponseBuilder: (_req, ctx) => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests — retry after ${ctx.after}`,
        status: 429,
        request_id: _req.id,
      },
    }),
  })

  await server.register(authDecorators)

  // ── Auth proxy → blnk_auth (blnk invisible to end users) ────────────────
  await server.register(authProxyPlugin)

  // ── App association files (passkeys on native) ──────────────────────────
  await server.register(wellKnownPlugin)

  // ── Profile + onboarding (org + per-user) ───────────────────────────────
  await server.register(profilePlugin)

  // ── Team management (admin adds users) ──────────────────────────────────
  await server.register(teamPlugin)

  // ── Hot-swap feature modules (FEATURE_* flags) ──────────────────────────
  // Phase 4 registers payments here:
  //   if (config.features.subscriptions) await server.register(subscriptionsPlugin)
  //   if (config.features.oneOff)        await server.register(oneOffPlugin)

  // ── Protected gate (proves blnk_auth JWT verification works) ────────────
  server.get('/me', { preHandler: [verifyBlnkAuth] }, async (req) => ({
    user: req.user,
    tenant_slug: config.tenantSlug,
    features: config.features,
  }))

  // ── Health ───────────────────────────────────────────────────────────────
  server.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    service: 'client_api',
    tenant: config.tenantSlug,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))

  server.setErrorHandler((error: unknown, req, reply) => {
    const isFastifyError = (e: unknown): e is FastifyError => e instanceof Error && 'statusCode' in e
    const status = isFastifyError(error) ? (error.statusCode ?? 500) : 500
    req.log.error({ err: error, request_id: req.id })
    reply.status(status).send({
      error: {
        code: isFastifyError(error) ? (error.code ?? 'INTERNAL_ERROR') : 'INTERNAL_ERROR',
        message: status >= 500 ? 'internal server error' : isFastifyError(error) ? error.message : 'unknown error',
        status,
        request_id: req.id,
      },
    })
  })

  server.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found`, status: 404, request_id: req.id },
    })
  })

  return server
}

async function start(): Promise<void> {
  try {
    void config.env
    await getPool().query('SELECT 1')
    server.log.info('database connected')
    const app = await build()
    await app.listen({ port: config.port, host: '0.0.0.0' })
    server.log.info(`client_api up for tenant '${config.tenantSlug}' — features: ${JSON.stringify(config.features)}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

async function shutdown(): Promise<void> {
  server.log.info('shutting down...')
  await server.close()
  await closePool()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()
