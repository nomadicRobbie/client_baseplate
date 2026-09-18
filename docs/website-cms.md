# Website CMS

The **Website** module (nav label "Website", route `/dashboard/locations`) lets admins manage content that appears on the blnk-built public website. This doc covers the public API contract, style token system, and how to extend the module.

**Terminology:** "website UI" = the client's public-facing website. "app UI" = the client-baseplate dashboard.

---

## Architecture

```
Public website  ── GET /public/website/content?type=banner&page=/ ──▶ client_api ──▶ website_content table
Dashboard app   ── GET /website/content?type=banner (auth) ─────────▶ client_api ──▶ website_content table
```

The legacy `GET /public/location/next` endpoint is **permanent** — it reads from the separate `locations` table and is unaffected by this module. Never remove it without a coordinated website deploy.

---

## Content types

| Type | Renders as | Trigger |
|---|---|---|
| `banner` | Top-of-page strip | On page load, filtered by current path |
| `announcement` | Modal overlay | On second page view (tracked in localStorage) |
| `info` | Key/value blocks | Fetched on demand by the website |

---

## Active content rule

A row is **active** when ALL of the following are true:
- `published = true`
- `starts_at IS NULL OR starts_at <= now()`
- `ends_at IS NULL OR ends_at > now()`

The public endpoint returns only active rows. The dashboard returns all rows so admins can manage drafts.

---

## Public API (no auth)

### `GET /public/website/content?type=<type>[&page=<path>]`

Returns all active content of the requested type. For banners, pass the current page path to filter by target.

```
GET /public/website/content?type=banner&page=/store
GET /public/website/content?type=announcement
GET /public/website/content?type=info
```

**Response:**
```json
{
  "content": [
    {
      "id": "uuid",
      "type": "banner",
      "title": "Free shipping this weekend",
      "body": null,
      "image_url": null,
      "cta_label": "Shop now",
      "cta_url": "/store",
      "sort_order": 0,
      "published": true,
      "starts_at": null,
      "ends_at": null,
      "style": {
        "bg_token": "primary",
        "text_token": "primaryText",
        "font_token": "heading"
      },
      "page_targets": ["*"],
      "created_at": "2026-09-18T00:00:00Z"
    }
  ]
}
```

Rate limited to 120 req/min.

---

## Style token system

Style tokens are string keys that map to CSS variables on the website. The website **never receives hex values** — it resolves tokens through its own theme. This means if the brand color changes, all banners update automatically.

### Token → CSS variable mapping

```
bg_token / text_color fields:
  primary    → var(--color-primary)      // org brand_color
  accent     → var(--color-accent)       // org accent_color
  surface    → var(--color-surface)
  surfaceAlt → var(--color-surface-alt)
  primaryText → var(--color-primary-text)
  text       → var(--color-text)
  textMuted  → var(--color-text-muted)

font_token:
  heading    → var(--font-heading)
  body       → var(--font-body)
```

The website CSS must define these variables. The app UI uses `org.brand_color` and `org.accent_color` to preview swatches, but only stores the token name.

---

## Banner style schema

```ts
interface BannerStyle {
  bg_token:   string   // 'primary' | 'accent' | 'surface' | 'surfaceAlt'
  text_token: string   // 'primaryText' | 'text' | 'textMuted'
  font_token: string   // 'heading' | 'body'
}
```

### Banner page targeting

`page_targets` is an array of paths. The server filters by `page_targets @> ['*']` OR `page_targets @> [requested_page]`. Null `page_targets` returns for any page.

**Example website fetch:**
```js
const res = await fetch(`/public/website/content?type=banner&page=${window.location.pathname}`)
const { content } = await res.json()
// Render each banner using content.style tokens
```

---

## Announcement style schema

```ts
interface AnnouncementStyle {
  layout:          'centered' | 'split-left' | 'split-right'
  bg_token:        string   // 'surface' | 'surfaceAlt' | 'primary' | 'accent'
  overlay_opacity: number   // 0 | 0.2 | 0.5 | 0.7  — backdrop dim level
}
```

### Layout definitions

| Value | Description |
|---|---|
| `centered` | Heading + body + CTA centered in the modal; image optional above heading |
| `split-left` | Image fills the left half; text + CTA in the right half |
| `split-right` | Text + CTA in the left half; image fills the right half |

### Announcement trigger (website frontend)

The modal shows on the visitor's **second page view of the current session** — e.g. navigating from Home to Shop. The session counter resets when the tab is closed. Each announcement is only ever shown once per browser (tracked in `localStorage`) so it won't repeat on the next session.

```js
// On every client-side page navigation:

// sessionStorage resets when the tab closes — counts views within this session only.
const count = parseInt(sessionStorage.getItem('pv_count') ?? '0') + 1
sessionStorage.setItem('pv_count', String(count))

if (count === 2) {
  // localStorage persists across sessions — tracks which announcements have been seen.
  const shownRaw = localStorage.getItem('shown_announcements') ?? '[]'
  const shown = JSON.parse(shownRaw)

  const res = await fetch('/public/website/content?type=announcement')
  const { content } = await res.json()

  const unseen = content.filter(a => !shown.includes(a.id))
  if (unseen.length > 0) {
    showModal(unseen[0])
    localStorage.setItem('shown_announcements', JSON.stringify([...shown, unseen[0].id]))
  }
}
```

**Behaviour summary:**
- User opens site, visits Home → navigates to Shop → modal fires (second page of session)
- User closes tab, reopens site → counter resets; modal does **not** fire again for announcements already seen
- Admin publishes a new announcement → it has a new `id`, so `shown_announcements` doesn't contain it → shows on next session's second page view

---

## Dashboard API (admin auth)

| Method | Path | Body |
|---|---|---|
| `GET` | `/website/content?type=<type>` | — |
| `POST` | `/website/content` | `{ type, title, body?, image_url?, cta_label?, cta_url?, sort_order?, published?, style?, page_targets? }` |
| `PATCH` | `/website/content/:id` | any subset of POST body (except `type`) |
| `DELETE` | `/website/content/:id` | — |

---

## Known pages (app UI + website contract)

The banner page picker in the app UI is driven by `KNOWN_PAGES` in `apps/app/src/app/dashboard/locations.tsx`. When a new page is added to the website, add its path there too. This is the single source of truth for the page list.

Current known pages: `*` (all), `/`, `/store`, `/about`, `/contact`, `/menu`, `/events`.

---

## Database schema

```sql
CREATE TYPE website_content_type AS ENUM ('banner', 'announcement', 'info');

CREATE TABLE website_content (
  id           UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  type         website_content_type  NOT NULL,
  title        TEXT                  NOT NULL,
  body         TEXT,
  image_url    TEXT,
  cta_label    TEXT,
  cta_url      TEXT,
  sort_order   INT                   NOT NULL DEFAULT 0,
  published    BOOLEAN               NOT NULL DEFAULT true,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  style        JSONB,
  page_targets TEXT[],
  created_at   TIMESTAMPTZ           NOT NULL DEFAULT now()
);
```

Migrations: `057_website_content.sql`, `058_website_content_style.sql`

---

## How to add a new content type

Five steps:

1. **Migration** — `ALTER TYPE website_content_type ADD VALUE 'gallery'`
2. **Query types** — add to `WebsiteContentType` union in `apps/api/src/db/queries/website.ts`
3. **Plugin validation** — add to `VALID_TYPES` in `apps/api/src/modules/website/plugin.ts`
4. **App API types** — add to `WebsiteContentType` in `apps/app/src/lib/api.ts`
5. **App screen** — add tab to `TABS` in `locations.tsx` and create a dedicated tab component

---

## Files

| File | Purpose |
|---|---|
| `apps/api/src/db/migrations/057_website_content.sql` | Base table |
| `apps/api/src/db/migrations/058_website_content_style.sql` | style + page_targets columns |
| `apps/api/src/db/queries/website.ts` | DB queries |
| `apps/api/src/modules/website/plugin.ts` | API routes |
| `apps/app/src/lib/api.ts` | Client API + style types (search `Website CMS`) |
| `apps/app/src/app/dashboard/locations.tsx` | App UI — tabbed CMS screen |
| `apps/app/src/lib/nav.ts` | Nav entry (label "Website") |
