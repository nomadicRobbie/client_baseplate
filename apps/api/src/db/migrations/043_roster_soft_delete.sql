-- Soft-delete for rosters. Admins can archive a published roster and generate
-- a fresh one for the same week. The UNIQUE on week_start needs adjusting so
-- a deleted roster doesn't block a new one.

ALTER TABLE rosters ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Drop the old unique, replace with a partial unique that ignores soft-deleted.
ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_week_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS rosters_week_start_active_uq
  ON rosters (week_start) WHERE deleted_at IS NULL;
