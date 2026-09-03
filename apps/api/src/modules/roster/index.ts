import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { verifyBlnkAuth, requireAppAccess, requireRole, callerPersonId } from '../../blnk/auth'
import { query } from '../../db/pool'
import { Errors } from '../../utils/errors'
import { getPersonByUserId, getPushTokensForPeople, getPushTokensForModules } from '../../db/queries/people'
import { sendPush } from '../../utils/push'
import {
  listUnavailability, upsertUnavailability, deleteUnavailability,
  listRosters, getRoster, getRosterDetail, generateRoster,
  addRosterShift, deleteRosterShift, eligibleCrew,
  publishRoster, deleteRoster, confirmAssignment, declineAssignment, rosteredPeopleIds,
  autoDeclineForSickDay, listOpenShifts, acceptCover,
  getRosterRules, updateRosterRules,
} from '../../db/queries/roster'

// Roster module.
// Crew availability, and the weekly roster generated from it. Nothing here writes
// to service_assignments — a draft roster is a proposal until it is published.

const rosterPlugin: FastifyPluginAsync = async (fastify) => {
  const member = [verifyBlnkAuth, requireAppAccess]
  const admin  = [verifyBlnkAuth, requireRole('admin', 'super')]

  const isAdmin = (req: FastifyRequest) =>
    req.user!.role === 'admin' || req.user!.role === 'super'

  // Whose row is being written. A member can only ever write their own; an admin
  // may name someone else, and falls back to their own person row when they don't.
  async function targetPersonId(req: FastifyRequest, bodyPersonId?: string): Promise<string> {
    if (bodyPersonId) {
      if (!isAdmin(req)) throw Errors.forbidden('cannot set unavailability for another person')
      return bodyPersonId
    }
    const person = await getPersonByUserId(req.user!.userId)
    if (!person) throw Errors.badRequest('no person record for this user')
    return person.id
  }

  // ── GET /unavailability ─────────────────────────────────────────────────────
  // Members always get their own days regardless of what they ask for. Admins get
  // the whole team, or one person when person_id is given.
  fastify.get('/unavailability', {
    preHandler: member,
    schema: { querystring: {
      type: 'object', required: ['from', 'to'],
      properties: {
        from:      { type: 'string' },   // YYYY-MM-DD inclusive
        to:        { type: 'string' },   // YYYY-MM-DD inclusive
        person_id: { type: 'string' },
      },
    } },
  }, async (req) => {
    const u = req.user!
    const q = req.query as { from: string; to: string; person_id?: string }
    const own = await callerPersonId(u.userId, u.role)   // null for admin/super
    const person_id = own ?? q.person_id
    return { unavailability: await listUnavailability({ from: q.from, to: q.to, person_id }) }
  })

  // ── POST /unavailability ────────────────────────────────────────────────────
  fastify.post('/unavailability', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['date'], additionalProperties: false,
      properties: {
        date:      { type: 'string', minLength: 10, maxLength: 10 },  // YYYY-MM-DD
        kind:      { type: 'string', enum: ['planned', 'sick'] },
        reason:    { type: ['string', 'null'], maxLength: 500 },
        person_id: { type: 'string', format: 'uuid' },                // admin only
      },
    } },
  }, async (req, reply) => {
    const body = req.body as { date: string; kind?: string; reason?: string | null; person_id?: string }
    const person_id = await targetPersonId(req, body.person_id)
    const row = await upsertUnavailability(
      { person_id, date: body.date, kind: body.kind, reason: body.reason },
      req.user!.userId,
    )

    // A sick day auto-declines any live assignments that person holds on that
    // date, then notifies all crew that shifts are open for cover.
    if (body.kind === 'sick') {
      const declined = await autoDeclineForSickDay(person_id, body.date)
      if (declined > 0) {
        // ponytail: one push per sick day, not per open shift — the cover screen
        // shows what's available and filters to what each person can do.
        const allTokens = await getPushTokensForModules([]).catch(() => [] as string[])
        if (allTokens.length > 0) {
          sendPush(allTokens, 'Cover needed', `${row?.person_name ?? 'Someone'} called in sick — open shifts are available.`, {
            screen: 'roster',
          })
        }
      }
    }

    return reply.status(201).send({ unavailability: row })
  })

  // ── DELETE /unavailability/:id ──────────────────────────────────────────────
  fastify.delete('/unavailability/:id', { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const u = req.user!
    // Members are scoped to their own rows — someone else's id 404s rather than
    // 403s, so this doesn't confirm the row exists.
    const own = await callerPersonId(u.userId, u.role)
    const removed = await deleteUnavailability(id, own)
    if (!removed) throw Errors.notFound('unavailability')
    return reply.status(204).send()
  })

  // ── Roster rules ────────────────────────────────────────────────────────────
  fastify.get('/roster-rules', { preHandler: admin }, async () => ({ rules: await getRosterRules() }))

  fastify.patch('/roster-rules', {
    preHandler: admin,
    schema: { body: {
      type: 'object', additionalProperties: false,
      properties: {
        min_rest_hours:       { type: 'integer', minimum: 0, maximum: 48 },
        max_consecutive_days: { type: 'integer', minimum: 1, maximum: 14 },
        max_daily_hours:      { type: 'integer', minimum: 1, maximum: 24 },
      },
    } },
  }, async (req) => {
    const body = req.body as { min_rest_hours?: number; max_consecutive_days?: number; max_daily_hours?: number }
    return { rules: await updateRosterRules(body, req.user!.userId) }
  })

  // ── GET /rosters ────────────────────────────────────────────────────────────
  // Admins see all rosters (draft + published). Members see published only so
  // they can navigate to their week and accept open shifts.
  fastify.get('/rosters', { preHandler: member }, async (req) => ({
    rosters: await listRosters(26, !isAdmin(req)),
  }))

  // ── POST /rosters/generate ──────────────────────────────────────────────────
  // Takes any date in the target week. Regenerating replaces any existing roster
  // for that week — draft or published. Published assignments are soft-removed
  // so the new draft starts clean; staff are notified when the new roster is
  // published.
  fastify.post('/rosters/generate', {
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['week'], additionalProperties: false,
      properties: { week: { type: 'string', minLength: 10, maxLength: 10 } },  // YYYY-MM-DD
    } },
  }, async (req, reply) => {
    const { week } = req.body as { week: string }
    const result = await generateRoster(week, req.user!.userId)
    return reply.status(201).send(result)
  })

  // ── GET /rosters/:id ────────────────────────────────────────────────────────
  // Members see the same week, filtered to the services they are actually on.
  fastify.get('/rosters/:id', { preHandler: member }, async (req) => {
    const { id } = req.params as { id: string }
    const u = req.user!
    const detail = await getRosterDetail(id)
    if (!detail) throw Errors.notFound('roster')

    const own = await callerPersonId(u.userId, u.role)
    if (!own) return { ...detail }
    return {
      roster: detail.roster,
      services: detail.services
        .filter(s => s.shifts.some(sh => sh.person_id === own))
        .map(s => {
          const mine = s.shifts.filter(sh => sh.person_id === own);
          const others = s.shifts.filter(sh => sh.person_id !== own);
          return { ...s, shifts: [...mine, ...others] };
        }),
    }
  })

  // ── DELETE /rosters/:id ──────────────────────────────────────────────────────
  // Soft-deletes the roster and removes its live assignments. The roster row
  // stays for traceability; a new roster can be generated for the same week.
  fastify.delete('/rosters/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const roster = await getRoster(id)
    if (!roster) throw Errors.notFound('roster')
    const removed = await deleteRoster(id)
    if (!removed) throw Errors.notFound('roster')

    // Notify affected crew that the roster has been withdrawn.
    const personIds = await rosteredPeopleIds(id)
    if (personIds.length > 0) {
      const tokens = await getPushTokensForPeople(personIds)
      sendPush(tokens, 'Roster withdrawn', 'The roster for your week has been withdrawn — a new one may follow.', {
        screen: 'roster',
      })
    }

    return reply.status(204).send()
  })

  // ── GET /rosters/:id/services/:serviceId/eligible ───────────────────────────
  // Who else could take this shift — powers the reassign picker on the review
  // screen, and the cover offer later.
  fastify.get('/rosters/:id/services/:serviceId/eligible', {
    preHandler: admin,
    schema: { querystring: {
      type: 'object', additionalProperties: false,
      properties: { override: { type: 'string' } },
    } },
  }, async (req) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string }
    const q = req.query as { override?: string }
    if (!await getRoster(id)) throw Errors.notFound('roster')
    return { crew: await eligibleCrew(serviceId, { rosterId: id, skipRules: q.override === 'true' }) }
  })

  // ── POST /rosters/:id/shifts ────────────────────────────────────────────────
  fastify.post('/rosters/:id/shifts', {
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['service_id', 'person_id'], additionalProperties: false,
      properties: {
        service_id:    { type: 'string', format: 'uuid' },
        person_id:     { type: 'string', format: 'uuid' },
        asset_id:      { type: ['string', 'null'] },
        role:          { type: ['string', 'null'] },
        rule_override: { type: 'boolean' },
      },
    } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const roster = await getRoster(id)
    if (!roster) throw Errors.notFound('roster')
    const body = req.body as { service_id: string; person_id: string; asset_id?: string | null; role?: string | null; rule_override?: boolean }
    const shift = await addRosterShift({ roster_id: id, ...body })
    return reply.status(201).send({ shift })
  })

  // ── DELETE /rosters/:id/shifts/:shiftId ─────────────────────────────────────
  fastify.delete('/rosters/:id/shifts/:shiftId', { preHandler: admin }, async (req, reply) => {
    const { id, shiftId } = req.params as { id: string; shiftId: string }
    const removed = await deleteRosterShift(id, shiftId)
    if (!removed) throw Errors.notFound('shift')
    return reply.status(204).send()
  })

  // ── POST /rosters/:id/publish ──────────────────────────────────────────────
  // Copies roster_shifts → service_assignments, sets status to published,
  // and pushes a notification to every rostered crew member.
  fastify.post('/rosters/:id/publish', { preHandler: admin }, async (req) => {
    const { id } = req.params as { id: string }
    const roster = await getRoster(id)
    if (!roster) throw Errors.notFound('roster')
    if (roster.status === 'published') throw Errors.conflict('already published — regenerate first to make changes')

    const published = await publishRoster(id, req.user!.userId)

    const personIds = await rosteredPeopleIds(id)
    const tokens = await getPushTokensForPeople(personIds)
    sendPush(tokens, 'Roster published', 'Your shifts for the week have been published — check the Roster tab.', {
      screen: 'roster', rosterId: id,
    })

    return { roster: published }
  })

  // ── POST /rosters/:id/assignments/:assignmentId/respond ────────────────────
  // Crew confirm or decline their rostered shift. Confirming clears a prior
  // decline and vice versa — there's always exactly one state.
  fastify.post('/rosters/:id/assignments/:assignmentId/respond', {
    preHandler: member,
    schema: { body: {
      type: 'object', required: ['action'], additionalProperties: false,
      properties: { action: { type: 'string', enum: ['confirm', 'decline'] } },
    } },
  }, async (req) => {
    const { assignmentId } = req.params as { id: string; assignmentId: string }
    const { action } = req.body as { action: 'confirm' | 'decline' }

    const person = await getPersonByUserId(req.user!.userId)
    if (!person) throw Errors.badRequest('no person record for this user')

    const result = action === 'confirm'
      ? await confirmAssignment(assignmentId, person.id)
      : await declineAssignment(assignmentId, person.id)

    if (!result) throw Errors.notFound('assignment')
    return { assignment: result }
  })

  // ── GET /rosters/:id/open-shifts ───────────────────────────────────────────
  // Shifts where someone declined (sick day or manual) but hasn't been removed.
  // Powers the cover screen — crew see what they could pick up.
  fastify.get('/rosters/:id/open-shifts', { preHandler: member }, async (req) => {
    const { id } = req.params as { id: string }
    const roster = await getRoster(id)
    if (!roster) throw Errors.notFound('roster')
    return { shifts: await listOpenShifts(id) }
  })

  // ── GET /rosters/:id/open-shifts/:assignmentId/eligible ────────────────────
  // Who could cover this specific open shift — same rules as generation, minus
  // the person who dropped out.
  fastify.get('/rosters/:id/open-shifts/:assignmentId/eligible', { preHandler: member }, async (req) => {
    const { id, assignmentId } = req.params as { id: string; assignmentId: string }
    const roster = await getRoster(id)
    if (!roster) throw Errors.notFound('roster')

    // Find the service and the declined person from the assignment.
    const [sa] = await query<{ service_id: string; subject_id: string }>(
      `SELECT service_id, subject_id FROM service_assignments
        WHERE id = $1 AND declined_at IS NOT NULL AND removed_at IS NULL`,
      [assignmentId],
    )
    if (!sa) throw Errors.notFound('open shift')

    return { crew: await eligibleCrew(sa.service_id, { exclude: [sa.subject_id] }) }
  })

  // ── POST /rosters/:id/open-shifts/:assignmentId/cover ──────────────────────
  // First-accept-wins. Soft-removes the declined person, inserts the covering
  // person in one transaction. If two people tap at the same time, the second
  // gets { covered: false } — "already covered".
  fastify.post('/rosters/:id/open-shifts/:assignmentId/cover', { preHandler: member }, async (req) => {
    const { id, assignmentId } = req.params as { id: string; assignmentId: string }

    const person = await getPersonByUserId(req.user!.userId)
    if (!person) throw Errors.badRequest('no person record for this user')

    const result = await acceptCover(assignmentId, person.id, id)
    if (!result.covered) throw Errors.conflict('this shift has already been covered')

    return { assignment: { id: result.newAssignmentId } }
  })
}

export default rosterPlugin
