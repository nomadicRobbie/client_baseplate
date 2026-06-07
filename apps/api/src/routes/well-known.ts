import type { FastifyPluginAsync } from 'fastify'
import { config } from '../config'

// ── App association files ───────────────────────────────────────────────────
// Served from the client's own domain so the SAME passkey works in the website
// and the native app. iOS fetches apple-app-site-association; Android fetches
// assetlinks.json. Content is per-client (their app IDs), driven by config.
const wellKnownPlugin: FastifyPluginAsync = async (fastify) => {
  // ── iOS: associated domains (webcredentials → passkeys) ───────────────────
  fastify.get('/.well-known/apple-app-site-association', {
    config: { rateLimit: false },
  }, async (_req, reply) => {
    return reply.header('content-type', 'application/json').send({
      webcredentials: { apps: config.associations.appleAppIds },
      applinks: {
        apps: [],
        details: config.associations.appleAppIds.map(appID => ({ appID, paths: ['*'] })),
      },
    })
  })

  // ── Android: Digital Asset Links ──────────────────────────────────────────
  fastify.get('/.well-known/assetlinks.json', {
    config: { rateLimit: false },
  }, async (_req, reply) => {
    const { androidPackage, androidSha256 } = config.associations
    const statements = androidPackage
      ? [{
          relation: ['delegate_permission/common.get_login_creds', 'delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: androidPackage,
            sha256_cert_fingerprints: androidSha256,
          },
        }]
      : []
    return reply.header('content-type', 'application/json').send(statements)
  })
}

export default wellKnownPlugin
