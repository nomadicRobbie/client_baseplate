import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { verifyBlnkAuth, requireRole } from '../blnk/auth';
import { listTenantUsers, setTenantUserActive } from '../blnk/client';

function bearer(req: FastifyRequest): string {
  return (req.headers.authorization ?? '').slice(7);
}

// Team management — admin/super only. Forwards to blnk_auth, which also enforces
// tenant scope + role rules.
const teamPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/team', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const users = await listTenantUsers(bearer(req));
    return reply.status(200).send({ users });
  });

  fastify.patch('/team/:id/active', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { active } = req.body as { active: boolean };
    const user = await setTenantUserActive(bearer(req), id, active);
    return reply.status(200).send({ user });
  });
};

export default teamPlugin;
