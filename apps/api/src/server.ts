import Fastify, { type FastifyError } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import { getPool, closePool } from './db/pool'
import authDecorators, { verifyBlnkAuth, requireAppAccess } from './blnk/auth'
import authProxyPlugin from './routes/auth-proxy'
import wellKnownPlugin from './routes/well-known'
import profilePlugin from './routes/profile'
import teamPlugin from './routes/team'
import peoplePlugin from './modules/people'
import paymentsPlugin from './modules/payments'
import commercePlugin from './modules/commerce'
import analyticsPlugin from './modules/analytics'
import locationsPlugin from './modules/locations/plugin'
import compliancePlugin from './modules/compliance'
import assetPlugin from './modules/asset'
import feedPlugin from './modules/feed'
import { buildUpcoming } from './modules/asset/upcoming'
import { getPushTokensForModules } from './db/queries/people'
import { sendPush } from './utils/push'
import { query } from './db/pool'

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

export async function build(): Promise<typeof server> {
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

  // In-memory rate limiting — skipped in dev so rapid hot-reloads don't trip it.
  if (config.env === 'production') {
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
  }

  await server.register(authDecorators)

  // ── Auth proxy → blnk_auth (blnk invisible to end users) ────────────────
  await server.register(authProxyPlugin)

  // ── App association files (passkeys on native) ──────────────────────────
  await server.register(wellKnownPlugin)

  // ── Profile + onboarding (org + per-user) ───────────────────────────────
  await server.register(profilePlugin)

  // ── Team management (admin adds users) ──────────────────────────────────
  await server.register(teamPlugin)

  // ── People core (canonical human directory — always on, shared by modules) ─
  await server.register(peoplePlugin)

  // ── Hot-swap feature modules (FEATURE_* flags) ──────────────────────────
  // Client payments (Stripe Checkout) — only if provisioned for Stripe.
  if (config.features.stripe) await server.register(paymentsPlugin)
  // Online store — products, orders, enquiries, Stripe payment intents.
  if (config.features.commerce) await server.register(commercePlugin)
  // Analytics — event ingest (public) + dashboard query routes (admin).
  if (config.features.analytics) await server.register(analyticsPlugin)
  // Locations — public-site location banner.
  if (config.features.locations) await server.register(locationsPlugin)
  // Compliance — food safety records (registry + validation engine).
  if (config.features.compliance) await server.register(compliancePlugin)
  // Asset management (fleet, faults, maintenance).
  if (config.features.asset) await server.register(assetPlugin)
  // Feed — always on; item visibility is gated server-side by module membership.
  await server.register(feedPlugin)

  // ── Protected gate — must be provisioned for this app (admin or on the roster) ─
  server.get('/me', { preHandler: [verifyBlnkAuth, requireAppAccess] }, async (req) => ({
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

// Runs daily: notify asset module members of maintenance due today and newly overdue.
// "Due today" fires on the due date itself; "overdue" fires the day after (yesterday's due_date).
// ponytail: no tracking table — the date comparison is the deduplication.
async function runMaintenanceCron(): Promise<void> {
  if (!config.features.asset) return
  try {
    const tokens = await getPushTokensForModules(['asset'])
    if (tokens.length === 0) return

    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

    const upcoming = await buildUpcoming()
    const relevant = upcoming.filter(u => u.due_date === today || u.due_date === yesterday)
    if (relevant.length === 0) return

    const assetIds = [...new Set(relevant.map(u => u.asset_id))]
    const names = await query<{ id: string; name: string }>(
      'SELECT id, name FROM assets WHERE id = ANY($1)', [assetIds],
    )
    const nameMap = Object.fromEntries(names.map(a => [a.id, a.name]))

    for (const item of relevant) {
      const asset = nameMap[item.asset_id] ?? 'an asset'
      if (item.due_date === today) {
        sendPush(tokens, 'Maintenance reminder', `${item.title} is due today on ${asset}`, {
          route: `/dashboard/asset/${item.asset_id}/maintenance`,
        })
      } else {
        sendPush(tokens, 'Maintenance overdue', `${asset} is overdue: ${item.title}`, {
          route: `/dashboard/asset/${item.asset_id}/maintenance`,
        })
      }
    }
  } catch (err) {
    server.log.error({ err }, 'maintenance cron failed')
  }
}

async function start(): Promise<void> {
  try {
    void config.env
    await getPool().query('SELECT 1')
    server.log.info('database connected')
    const app = await build()
    await app.listen({ port: config.port, host: '0.0.0.0' })
    server.log.info(`client_api up for tenant '${config.tenantSlug}' — features: ${JSON.stringify(config.features)}`)
    // Daily maintenance reminders — fire shortly after startup then every 24h.
    setTimeout(() => {
      void runMaintenanceCron()
      setInterval(() => void runMaintenanceCron(), 24 * 60 * 60 * 1000)
    }, 10_000)
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

// Only boot (connect DB, bind port, install signal handlers) when run directly —
// importing this module for tests must not start a live server.
if (require.main === module) {
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  start()
}
