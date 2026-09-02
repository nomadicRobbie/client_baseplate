import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { v2 as cloudinary } from 'cloudinary';
import { verifyBlnkAuth, requireRole } from '../blnk/auth';
import { getAuthMe, setAuthName, getEmailConfig, setEmailConfig } from '../blnk/client';
import {
  getClientProfile, upsertClientProfile, getUserProfile, upsertUserProfile, updateUserAvatar,
} from '../db/queries/profile';
import { getPersonByUserId, setPushToken } from '../db/queries/people';
import { config } from '../config';
import { Errors } from '../utils/errors';

function bearer(req: FastifyRequest): string {
  return (req.headers.authorization ?? '').slice(7);
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

const profilePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })

  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key:    config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  })
  // ── GET /profile ──────────────────────────────────────────────────────────
  // Assembles org + this user's profile (identity from blnk_auth, contact data
  // from here) + a derived onboarding state the app uses to route the wizard.
  fastify.get('/profile', { preHandler: [verifyBlnkAuth] }, async (req) => {
    const u = req.user!;
    const [org, userProfile, authMe, email] = await Promise.all([
      getClientProfile(),
      getUserProfile(u.userId),
      getAuthMe(bearer(req)),
      // Source of truth is blnk_api; never let it break the whole profile load.
      getEmailConfig().catch(() => ({ notification_email: null, backup_email: null })),
    ]);

    const isAdmin = u.role === 'admin' || u.role === 'super';
    const orgComplete = !!org?.org_name;
    const personalComplete = !!authMe.name;

    return {
      org: org ?? null,
      email,
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
        // Inbound replies have nowhere to go until an admin sets this — gate it.
        needs_email_setup: isAdmin && !email.notification_email,
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
          custom_colors: { type: 'object', additionalProperties: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
          support_email: { type: 'string', format: 'email' },
          timezone: { type: 'string', maxLength: 64 },
          locale: { type: 'string', maxLength: 16 },
          currency: { type: 'string', maxLength: 8 },
          // Forwarded to blnk_api (source of truth), not stored in client_profile.
          notification_email: { type: 'string', format: 'email' },
          backup_email: { type: ['string', 'null'], format: 'email' },
        },
      },
    },
  }, async (req, reply) => {
    // notification_email / backup_email live in blnk_api (they drive inbound
    // forwarding); everything else is local org profile. Split and route each.
    const { notification_email, backup_email, ...orgFields } =
      req.body as Record<string, string | null>;

    const org = await upsertClientProfile(orgFields as Record<string, string>, req.user!.userId);

    let email: Awaited<ReturnType<typeof setEmailConfig>> | undefined;
    if (notification_email !== undefined || backup_email !== undefined) {
      const patch: { notification_email?: string; backup_email?: string | null } = {};
      if (notification_email !== undefined) patch.notification_email = notification_email as string;
      if (backup_email !== undefined) patch.backup_email = backup_email;
      email = await setEmailConfig(patch);
    }

    return reply.status(200).send({ org, email });
  });
  // ── POST /profile/me/avatar ───────────────────────────────────────────────
  // Accepts a single image (multipart field: "file"), uploads to Cloudinary,
  // persists the URL on user_profile, and returns it.
  fastify.post('/profile/me/avatar', { preHandler: [verifyBlnkAuth] }, async (req, reply) => {
    const data = await req.file()
    if (!data) throw Errors.badRequest('no file received')
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.status(400).send({
        error: { code: 'INVALID_FILE_TYPE', message: 'only jpeg, png, and webp are accepted', status: 400 },
      })
    }
    const buffer = await data.toBuffer()
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `${config.tenantSlug}/avatars`, resource_type: 'image', transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }] },
        (err, res) => {
          if (err || !res) return reject(err ?? new Error('cloudinary upload returned no result'))
          resolve(res as { secure_url: string })
        },
      ).end(buffer)
    })
    const profile = await updateUserAvatar(req.user!.userId, result.secure_url)
    return reply.status(200).send({ avatar_url: profile.avatar_url })
  })

  // ── PATCH /profile/push-token ─────────────────────────────────────────────
  // Registers or clears the caller's Expo push token. Looks up their people row
  // and writes the token there — no-op if they have no person row yet.
  fastify.patch('/profile/push-token', {
    preHandler: [verifyBlnkAuth],
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: ['string', 'null'] } },
      },
    },
  }, async (req, reply) => {
    const { token } = req.body as { token: string | null }
    const person = await getPersonByUserId(req.user!.userId)
    if (person) await setPushToken(person.id, token)
    return reply.status(204).send()
  })
};

export default profilePlugin;
