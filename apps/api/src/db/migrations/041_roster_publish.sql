-- Phase 3: publish + confirm columns on service_assignments.
-- All nullable, no backfill — existing assignments predate rostering.
ALTER TABLE service_assignments
  ADD COLUMN IF NOT EXISTS roster_id     UUID REFERENCES rosters(id),
  ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS service_assignments_roster_idx
  ON service_assignments (roster_id) WHERE roster_id IS NOT NULL;
