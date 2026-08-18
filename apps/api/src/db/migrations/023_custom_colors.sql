-- Custom colour overrides per org. Keys match ColorTokens (bg, surface, etc.).
ALTER TABLE client_profile ADD COLUMN IF NOT EXISTS custom_colors JSONB NOT NULL DEFAULT '{}';
