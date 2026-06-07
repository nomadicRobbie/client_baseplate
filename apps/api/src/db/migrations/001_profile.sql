-- ── Organisation profile (singleton) ───────────────────────────────────────
-- One row for this client's org. Holds branding/theme (auto-applied by the app)
-- and org-level contact info. Any admin edits it; it applies to everyone.
-- enforce_singleton keeps it to a single row.
CREATE TABLE IF NOT EXISTS client_profile (
  id               INT         PRIMARY KEY DEFAULT 1,
  org_name         TEXT,
  logo_url         TEXT,
  brand_color      TEXT,        -- hex, e.g. #2a7f62 → theme primary
  accent_color     TEXT,        -- hex → theme accent
  support_email    TEXT,
  timezone         TEXT,
  locale           TEXT,
  currency         TEXT,
  updated_by       UUID,        -- blnk_auth user id of last editor
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enforce_singleton BOOLEAN    NOT NULL DEFAULT TRUE,
  CONSTRAINT client_profile_singleton UNIQUE (enforce_singleton)
);

-- ── Per-user profile (client-owned contact data) ────────────────────────────
-- Keyed by the blnk_auth user id. The display NAME lives in blnk_auth; this
-- holds the client-specific contact details collected at onboarding.
CREATE TABLE IF NOT EXISTS user_profile (
  user_id           UUID        PRIMARY KEY,   -- blnk_auth users.id
  contact_email     TEXT,
  phone             TEXT,
  preferred_contact TEXT,        -- email | phone | sms | in_app
  timezone          TEXT,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
