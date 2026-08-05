import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../blnk/auth'
import {
  getNextLocation,
  getUpcomingLocations,
  createLocation,
  deleteLocation,
} from '../../db/queries/locations'

const locationsPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /public/location/next ─────────────────────────────────────────────
  // No auth — called by the client's public site.
  // Returns the next event starting within the next 3 hours or in the future.
  fastify.get('/public/location/next', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
  }, async (_req, reply) => {
    const location = await getNextLocation()
    return reply.send({ location })
  })

  // ── GET /locations ────────────────────────────────────────────────────────
  // Dashboard — all upcoming locations.
  fastify.get('/locations', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (_req, reply) => {
    const locations = await getUpcomingLocations()
    return reply.send({ locations })
  })

  // ── POST /locations ───────────────────────────────────────────────────────
  // Dashboard — create a new location appearance.
  fastify.post('/locations', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: {
        type: 'object',
        required: ['location', 'starts_at'],
        additionalProperties: false,
        properties: {
          location:  { type: 'string', minLength: 1, maxLength: 200 },
          starts_at: { type: 'string' },
          note:      { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    const { location, starts_at, note } = req.body as {
      location: string
      starts_at: string
      note?: string
    }

    const created = await createLocation(location, starts_at, note)
    return reply.status(201).send({ location: created })
  })

  // ── DELETE /locations/:id ─────────────────────────────────────────────────
  // Dashboard — remove a location.
  fastify.delete('/locations/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const deleted = await deleteLocation(id)
    if (!deleted) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'location not found', status: 404 },
      })
    }
    return reply.status(204).send()
  })
}

export default locationsPlugin
