import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { getSummary } from '../../../db/queries/analytics'

function parsePeriod(query: Record<string, string>): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

const queryPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /analytics/summary ────────────────────────────────────────────────
  // Query params: from (ISO date), to (ISO date). Default: last 30 days.
  fastify.get('/analytics/summary', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { from, to } = parsePeriod(req.query as Record<string, string>)
    const summary = await getSummary(from, to)
    return reply.send({ summary })
  })
}

export default queryPlugin
