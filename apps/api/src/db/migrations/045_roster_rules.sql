-- Editable roster rules. Single-row singleton — one set of rules per deployment.
-- Defaults match the hardcoded values that shipped with the module.
CREATE TABLE IF NOT EXISTS roster_rules (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- singleton: only one row
  min_rest_hours      INTEGER NOT NULL DEFAULT 10,
  max_consecutive_days INTEGER NOT NULL DEFAULT 6,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID
);

-- Seed the default row so reads never return null.
INSERT INTO roster_rules (id) VALUES (true) ON CONFLICT DO NOTHING;
