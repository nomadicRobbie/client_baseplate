-- Location appearances for the client's public-site banner.
CREATE TABLE IF NOT EXISTS locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location    TEXT        NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the public "next event" query
CREATE INDEX IF NOT EXISTS locations_starts_at_idx ON locations (starts_at);
