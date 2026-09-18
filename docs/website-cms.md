# Website CMS

The **Website** module (route `/dashboard/locations`, nav label "Website") lets admins manage content that appears on the client's blnk-built public website. This document covers the public API contract, the content model, and how to add a new content type.

---

## Architecture

The client website talks only to `client_api`. No auth is required for public reads. The dashboard app uses the standard authenticated API.

```
Public website  ──GET /public/website/content?type=banner──▶ client_api ──▶ website_content table
Dashboard app   ──GET /website/content?type=banner (auth)──▶ client_api ──▶ website_content table
```

The legacy `GET /public/location/next` endpoint is **permanent** — never remove it without a coordinated client-site deploy. It reads from the separate `locations` table and is unaffected by this module.

---

## Content types

| Type | Purpose | Fields used |
|---|---|---|
| `banner` | Hero / promotional banners | title, body, image_url, cta_label, cta_url, published |
| `announcement` | News posts / updates | title, body, published |
| `info` | Key/value blocks (About, Hours, Contact) | title (= key), body (= value), published |

---

## Active content definition

A row is **active** when ALL of these are true:
- `published = true`
- `starts_at IS NULL OR starts_at <= now()`
- `ends_at IS NULL OR ends_at > now()`

The public endpoint only returns active rows. The dashboard endpoint returns all rows (including drafts and expired) so admins can manage them.

---

## Public API (no auth)

### `GET /public/website/content?type=<type>`

Returns all active content of the given type, sorted by `sort_order ASC, created_at ASC`.

```json
{
  "content": [
    {
      "id": "uuid",
      "type": "banner",
      "title": "Summer Sale",
      "body": "Up to 30% off this weekend",
      "image_url": "https://cdn.example.com/banner.jpg",
      "cta_label": "Shop now",
      "cta_url": "/store",
      "sort_order": 0,
      "published": true,
      "starts_at": null,
      "ends_at": null,
      "created_at": "2026-09-18T00:00:00Z"
    }
  ]
}
```

Rate limited to 120 req/min.

---

## Dashboard API (admin auth required)

| Method | Path | Body |
|---|---|---|
| `GET` | `/website/content?type=<type>` | — |
| `POST` | `/website/content` | `{ type, title, body?, image_url?, cta_label?, cta_url?, sort_order?, published?, starts_at?, ends_at? }` |
| `PATCH` | `/website/content/:id` | any subset of POST body fields except `type` |
| `DELETE` | `/website/content/:id` | — |

---

## How to add a new content type

Five steps. Takes about 20 minutes.

### 1. Add to the enum in the migration

Create a new migration (next number after current highest):

```sql
ALTER TYPE website_content_type ADD VALUE 'gallery';
```

### 2. Update the query types

In `apps/api/src/db/queries/website.ts`, add the new value to the `WebsiteContentType` union:

```ts
export type WebsiteContentType = 'banner' | 'announcement' | 'info' | 'gallery'
```

### 3. Update the plugin validation

In `apps/api/src/modules/website/plugin.ts`, add the value to `VALID_TYPES`:

```ts
const VALID_TYPES: WebsiteContentType[] = ['banner', 'announcement', 'info', 'gallery']
```

### 4. Update the app API types

In `apps/app/src/lib/api.ts`:

```ts
export type WebsiteContentType = 'banner' | 'announcement' | 'info' | 'gallery';
```

### 5. Add a tab in the app screen

In `apps/app/src/app/dashboard/locations.tsx`:

1. Add `'gallery'` to the `Tab` type and `TAB_CONTENT_TYPE` map
2. Add a `Pill` entry in the tab row
3. Add the `ContentTab` render for the new tab

If the new type needs custom fields (e.g. `gallery` needs an image-only form), create a dedicated `GalleryTab` component following the same shape as `ContentTab`.

---

## Database schema

```sql
CREATE TYPE website_content_type AS ENUM ('banner', 'announcement', 'info');

CREATE TABLE website_content (
  id          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  type        website_content_type  NOT NULL,
  title       TEXT                  NOT NULL,
  body        TEXT,
  image_url   TEXT,
  cta_label   TEXT,
  cta_url     TEXT,
  sort_order  INT                   NOT NULL DEFAULT 0,
  published   BOOLEAN               NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ           NOT NULL DEFAULT now()
);
```

Migration: `apps/api/src/db/migrations/057_website_content.sql`

---

## Feature flag

This module is gated by `FEATURE_LOCATIONS=true`. The website plugin registers under the same flag as the legacy locations plugin.

---

## Files

| File | Purpose |
|---|---|
| `apps/api/src/db/migrations/057_website_content.sql` | DB migration |
| `apps/api/src/db/queries/website.ts` | DB queries |
| `apps/api/src/modules/website/plugin.ts` | API routes |
| `apps/app/src/lib/api.ts` | Client API calls (search `Website CMS`) |
| `apps/app/src/app/dashboard/locations.tsx` | Tabbed CMS screen |
| `apps/app/src/lib/nav.ts` | Nav entry (label "Website", href `/dashboard/locations`) |
