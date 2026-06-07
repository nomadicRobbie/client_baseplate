import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { verifyBlnkAuth, requireRole } from '../blnk/auth';
import { getAuthMe, setAuthName } from '../blnk/client';
import {
  getClientProfile, upsertClientProfile, getUserProfile, upsertUserProfile,
} from '../db/queries/profile';

function bearer(req: FastifyRequest): string {
  return (req.headers.authorization ?? '').slice(7);
}

const profilePlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /profile ──────────────────────────────────────────────────────────
  // Assembles org + this user's profile (identity from blnk_auth, contact data
  // from here) + a derived onboarding state the app uses to route the wizard.
  fastify.get('/profile', { preHandler: [verifyBlnkAuth] }, async (req) => {
    const u = req.user!;
    const [org, userProfile, authMe] = await Promise.all([
      getClientProfile(),
      getUserProfile(u.userId),
      getAuthMe(bearer(req)),
    ]);

    const isAdmin = u.role === 'admin' || u.role === 'super';
    const orgComplete = !!org?.org_name;
    const personalComplete = !!authMe.name && !!userProfile?.preferred_contact;

    return {
      org: org ?? null,
      me: {
        userId: u.userId,
        email: authMe.email,
        name: authMe.name,
        role: u.role,
        type: u.type,
        profile: userProfile ?? null,
      },
      onboarding: {
        needs_org_setup: isAdmin && !orgComplete,
        needs_personal: !personalComplete,
      },
    };
  });

  // ── PUT /profile/me ───────────────────────────────────────────────────────
  // One call from the app: writes contact data here AND forwards the name to
  // blnk_auth using the caller's token (client_api orchestrates).
  fastify.put('/profile/me', {
    preHandler: [verifyBlnkAuth],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          contact_email: { type: 'string', format: 'email' },
          phone: { type: 'string', maxLength: 40 },
          preferred_contact: { type: 'string', enum: ['email', 'phone', 'sms', 'in_app'] },
          timezone: { type: 'string', maxLength: 64 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name?: string; contact_email?: string; phone?: string;
      preferred_contact?: string; timezone?: string;
    };
    if (body.name) await setAuthName(bearer(req), body.name);
    const profile = await upsertUserProfile(req.user!.userId, {
      contact_email: body.contact_email ?? null,
      phone: body.phone ?? null,
      preferred_contact: body.preferred_contact ?? null,
      timezone: body.timezone ?? null,
    });
    return reply.status(200).send({ profile, name: body.name ?? null });
  });

  // ── PUT /profile/org ──────────────────────────────────────────────────────
  // Admin-only. Shared org settings incl. brand colours that theme the app.
  fastify.put('/profile/org', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          org_name: { type: 'string', maxLength: 160 },
          logo_url: { type: 'string', maxLength: 500 },
          brand_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          accent_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          support_email: { type: 'string', format: 'email' },
          timezone: { type: 'string', maxLength: 64 },
          locale: { type: 'string', maxLength: 16 },
          currency: { type: 'string', maxLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const org = await upsertClientProfile(req.body as Record<string, string>, req.user!.userId);
    return reply.status(200).send({ org });
  });
};

export default profilePlugin;
