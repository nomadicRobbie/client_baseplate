-- Website CMS content blocks. Each row is one piece of managed content
-- (banner, announcement, or info block) shown on the client's public site.
-- The public endpoint at /public/website/content?type=X returns all active rows
-- of that type. Active = published AND within optional starts_at/ends_at window.
CREATE TYPE website_content_type AS ENUM ('banner', 'announcement', 'info');

CREATE TABLE IF NOT EXISTS website_content (
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

CREATE INDEX IF NOT EXISTS website_content_type_active_idx
  ON website_content (type, published, starts_at, ends_at);
