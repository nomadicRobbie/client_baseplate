ALTER TABLE client_profile
  ADD COLUMN IF NOT EXISTS website_pages TEXT[] NOT NULL DEFAULT '{}';
