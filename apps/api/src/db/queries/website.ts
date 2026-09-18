import { query } from '../pool'

export type WebsiteContentType = 'banner' | 'announcement' | 'info'

export interface WebsiteContent {
  id: string
  type: WebsiteContentType
  title: string
  body: string | null
  image_url: string | null
  cta_label: string | null
  cta_url: string | null
  sort_order: number
  published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

// Active = published AND (no start OR start has passed) AND (no end OR end is future)
const ACTIVE_FILTER = `
  published = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
`

export async function getActiveContent(type: WebsiteContentType): Promise<WebsiteContent[]> {
  return query<WebsiteContent>(
    `SELECT * FROM website_content
     WHERE type = $1 AND ${ACTIVE_FILTER}
     ORDER BY sort_order ASC, created_at ASC`,
    [type],
  )
}

export async function listContent(type: WebsiteContentType): Promise<WebsiteContent[]> {
  return query<WebsiteContent>(
    `SELECT * FROM website_content
     WHERE type = $1
     ORDER BY sort_order ASC, created_at DESC`,
    [type],
  )
}

export async function createContent(
  data: Pick<WebsiteContent, 'type' | 'title' | 'body' | 'image_url' | 'cta_label' | 'cta_url' | 'sort_order' | 'published' | 'starts_at' | 'ends_at'>,
): Promise<WebsiteContent> {
  const rows = await query<WebsiteContent>(
    `INSERT INTO website_content
       (type, title, body, image_url, cta_label, cta_url, sort_order, published, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [data.type, data.title, data.body ?? null, data.image_url ?? null,
     data.cta_label ?? null, data.cta_url ?? null, data.sort_order,
     data.published, data.starts_at ?? null, data.ends_at ?? null],
  )
  return rows[0]
}

export async function updateContent(
  id: string,
  patch: Partial<Pick<WebsiteContent, 'title' | 'body' | 'image_url' | 'cta_label' | 'cta_url' | 'sort_order' | 'published' | 'starts_at' | 'ends_at'>>,
): Promise<WebsiteContent | null> {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined)
  if (fields.length === 0) return null
  const setClauses = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
  const values = fields.map(([, v]) => v)
  const rows = await query<WebsiteContent>(
    `UPDATE website_content SET ${setClauses} WHERE id = $1 RETURNING *`,
    [id, ...values],
  )
  return rows[0] ?? null
}

export async function deleteContent(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>('DELETE FROM website_content WHERE id = $1 RETURNING id', [id])
  return rows.length > 0
}
