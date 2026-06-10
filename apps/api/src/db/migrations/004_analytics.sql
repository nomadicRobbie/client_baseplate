-- ── Analytics module ─────────────────────────────────────────────────────────
-- Registered only when FEATURE_ANALYTICS=true. Append-only event log — never
-- update rows. product_id is nullable (only set on product_view / add_to_cart).
-- Index on (event_type, created_at) covers the most common dashboard queries.
-- Partition by created_at range if volume demands it later.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT        NOT NULL,
  session_id  TEXT        NOT NULL,
  url         TEXT        NOT NULL,
  referrer    TEXT,
  product_id  UUID,
  meta        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_type_idx    ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS analytics_events_product_idx ON analytics_events(product_id) WHERE product_id IS NOT NULL;
