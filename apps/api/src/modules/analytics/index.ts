import type { FastifyPluginAsync } from 'fastify'
import ingestPlugin from './ingest/plugin'
import queryPlugin from './query/plugin'

// Analytics module — registered only when FEATURE_ANALYTICS is on.
const analyticsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(ingestPlugin)
  await fastify.register(queryPlugin)
}

export default analyticsPlugin
