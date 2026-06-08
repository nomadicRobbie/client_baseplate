import type { FastifyPluginAsync } from 'fastify';
import { verifyBlnkAuth, requireRole } from '../blnk/auth';
import { getBlnkBilling, createBlnkCheckout, createBlnkPortal } from '../blnk/client';

// blnk PLATFORM billing — the client's blnk plan (blnk bills the client).
// Admin/super only. Thin proxy to blnk_api's tenant-scoped /billing/* endpoints
// (authenticated with this client's blnk_api ApiKey, server-to-server).
const billingPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/billing', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (_req, reply) => {
    return reply.status(200).send({ billing: await getBlnkBilling() });
  });

  fastify.post('/billing/checkout', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: {
        type: 'object', required: ['success_url', 'cancel_url'], additionalProperties: false,
        properties: { success_url: { type: 'string', format: 'uri' }, cancel_url: { type: 'string', format: 'uri' } },
      },
    },
  }, async (req, reply) => {
    const b = req.body as { success_url: string; cancel_url: string };
    return reply.status(200).send(await createBlnkCheckout(b.success_url, b.cancel_url));
  });

  fastify.post('/billing/portal', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: { type: 'object', required: ['return_url'], additionalProperties: false, properties: { return_url: { type: 'string', format: 'uri' } } },
    },
  }, async (req, reply) => {
    const b = req.body as { return_url: string };
    return reply.status(200).send(await createBlnkPortal(b.return_url));
  });
};

export default billingPlugin;
