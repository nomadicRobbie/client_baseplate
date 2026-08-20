import { query } from '../pool'
import type { FeedPost, FeedPostComment, FeedItem } from '@blnk/shared'
import { buildUpcoming } from '../../modules/asset/upcoming'
import { listActiveSchedules, scheduleDoneCounts } from './compliance'
import { isDueOn } from '../../modules/compliance/schedule'

// ── Types ────────────────────────────────────────────────────────────────────
interface FaultRow {
  id: string; asset_id: string; asset_name: string
  fault_name: string; urgency: string | null; status: string; created_at: string
  step_count: number
  latest_step: { note: string; created_at: string } | null
}

// ── Posts ─────────────────────────────────────────────────────────────────────
export async function createFeedPost(
  createdBy: string,
  authorName: string,
  body: string,
  modules: string[],
  mentions: string[],
  expiresAt?: Date,
): Promise<FeedPost> {
  const rows = await query<FeedPost>(
    `INSERT INTO feed_posts (created_by, author_name, body, modules, mentions, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_by, author_name, body, modules, mentions, image_urls,
               0::int AS comment_count, NULL AS latest_comment, created_at,
               expires_at::text AS expires_at`,
    [createdBy, authorName, body, modules, mentions, expiresAt ?? null],
  )
  return rows[0]
}

export async function deleteFeedPost(id: string, userId: string, isAdmin: boolean): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE feed_posts SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL AND ($2 OR created_by = $3)
     RETURNING id`,
    [id, isAdmin, userId],
  )
  return result.length > 0
}

// Returns null when the post doesn't exist, is deleted, or isn't visible to this user.
export async function getVisiblePost(
  postId: string,
  isAdmin: boolean,
  myModules: string[],
): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM feed_posts
     WHERE id = $1 AND deleted_at IS NULL
       AND ($2 OR modules = '{}' OR modules && $3)`,
    [postId, isAdmin, myModules],
  )
  return rows[0] ?? null
}

// ── Post comments ─────────────────────────────────────────────────────────────
export async function listPostComments(postId: string): Promise<FeedPostComment[]> {
  return query<FeedPostComment>(
    `SELECT id, post_id, created_by, author_name, body, created_at::text AS created_at
     FROM feed_post_comments
     WHERE post_id = $1
     ORDER BY created_at ASC`,
    [postId],
  )
}

export async function createPostComment(
  postId: string,
  createdBy: string,
  authorName: string,
  body: string,
): Promise<FeedPostComment> {
  const rows = await query<FeedPostComment>(
    `INSERT INTO feed_post_comments (post_id, created_by, author_name, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, post_id, created_by, author_name, body, created_at::text AS created_at`,
    [postId, createdBy, authorName, body],
  )
  return rows[0]
}

// ── Feed assembly ─────────────────────────────────────────────────────────────
// Returns the last 30 days of activity, newest-first, up to `limit` items.
// Module filtering is enforced here — callers just pass their access context.
export async function listFeedItems(opts: {
  isAdmin: boolean
  myModules: string[]
  limit?: number
}): Promise<FeedItem[]> {
  const { isAdmin, myModules, limit = 50 } = opts
  const hasAsset = isAdmin || myModules.includes('asset')
  const hasCompliance = isAdmin || myModules.includes('compliance')
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const items: FeedItem[] = []

  // ── Asset faults (recently opened, with step preview) ────────────────────
  if (hasAsset) {
    const faults = await query<FaultRow>(
      `SELECT vf.id, vf.asset_id, va.name AS asset_name,
              vf.name AS fault_name, vf.urgency, vf.status,
              vf.created_at::text AS created_at,
              COUNT(vfs.id)::int AS step_count,
              (SELECT row_to_json(s) FROM (
                SELECT note, created_at::text AS created_at
                FROM asset_fault_steps
                WHERE fault_id = vf.id
                ORDER BY created_at DESC LIMIT 1
              ) s) AS latest_step
       FROM asset_faults vf
       JOIN assets va ON va.id = vf.asset_id
       LEFT JOIN asset_fault_steps vfs ON vfs.fault_id = vf.id
       WHERE vf.status = 'open'
         AND vf.created_at > $1
         AND va.status != 'deleted'
       GROUP BY vf.id, va.name
       ORDER BY vf.created_at DESC
       LIMIT 20`,
      [cutoff],
    )
    for (const f of faults) {
      items.push({
        kind: 'fault',
        module: 'asset',
        created_at: f.created_at,
        data: {
          id: f.id, asset_id: f.asset_id, asset_name: f.asset_name,
          fault_name: f.fault_name, urgency: f.urgency, status: f.status,
          step_count: f.step_count, latest_step: f.latest_step,
        },
      })
    }
  }

  // ── Asset maintenance (upcoming / overdue) ───────────────────────────────
  if (hasAsset) {
    const upcoming = await buildUpcoming()
    for (const u of upcoming.filter(x => x.level !== 'ok')) {
      items.push({
        kind: 'maintenance',
        module: 'asset',
        created_at: u.due_date ?? new Date().toISOString().slice(0, 10),
        data: { id: u.id, asset_id: u.asset_id, asset_name: '', task_name: u.title, due_date: u.due_date, level: u.level },
      })
    }
    const maintItems = items.filter(i => i.kind === 'maintenance')
    if (maintItems.length) {
      const assetIds = [...new Set(maintItems.map(i => (i.data as { asset_id: string }).asset_id))]
      const names = await query<{ id: string; name: string }>(
        `SELECT id, name FROM assets WHERE id = ANY($1)`,
        [assetIds],
      )
      const nameMap = Object.fromEntries(names.map(a => [a.id, a.name]))
      for (const item of maintItems) {
        (item.data as { asset_name: string }).asset_name = nameMap[(item.data as { asset_id: string }).asset_id] ?? ''
      }
    }
  }

  // ── Compliance: today's incomplete scheduled checks ───────────────────────
  if (hasCompliance) {
    const today = new Date().toISOString().slice(0, 10)
    const todayDate = new Date(today + 'T00:00:00')
    const [schedules, done] = await Promise.all([listActiveSchedules(), scheduleDoneCounts(today)])
    for (const sc of schedules.filter(s => isDueOn(s, todayDate))) {
      const done_count = done[sc.id] ?? 0
      const remaining = Math.max(0, sc.times_per_day - done_count)
      if (remaining === 0) continue
      items.push({
        kind: 'compliance',
        module: 'compliance',
        created_at: today,
        data: {
          schedule_id: sc.id,
          label: sc.label,
          record_type: sc.record_type,
          jurisdiction: sc.jurisdiction,
          done_count,
          remaining,
          times_per_day: sc.times_per_day,
          due_date: today,
        },
      })
    }
  }

  // ── Posts (with comment count + latest comment preview) ───────────────────
  const posts = await query<FeedPost>(
    `SELECT fp.id, fp.created_by, fp.author_name, up.avatar_url AS author_image_url,
            fp.body, fp.modules, fp.mentions, fp.image_urls,
            fp.created_at::text AS created_at,
            fp.expires_at::text AS expires_at,
            COUNT(fc.id)::int AS comment_count,
            (SELECT row_to_json(c) FROM (
              SELECT author_name, body, created_at::text AS created_at
              FROM feed_post_comments
              WHERE post_id = fp.id
              ORDER BY created_at DESC LIMIT 1
            ) c) AS latest_comment
     FROM feed_posts fp
     LEFT JOIN user_profile up ON up.user_id = fp.created_by::uuid
     LEFT JOIN feed_post_comments fc ON fc.post_id = fp.id
     WHERE fp.deleted_at IS NULL
       AND fp.created_at > $1
       AND (fp.expires_at IS NULL OR fp.expires_at > now())
       AND ($2 OR fp.modules = '{}' OR fp.modules && $3)
     GROUP BY fp.id, up.avatar_url
     ORDER BY fp.created_at DESC
     LIMIT 30`,
    [cutoff, isAdmin, myModules],
  )
  for (const p of posts) {
    items.push({ kind: 'post', module: null, created_at: p.created_at, data: p })
  }

  items.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return items.slice(0, limit)
}
