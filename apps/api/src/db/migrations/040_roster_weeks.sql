-- Roster module, phase 2 — the weekly roster and its draft shifts.
--
-- A roster is a planning wrapper, not a second crew register. Draft shifts live
-- in roster_shifts where nothing else in the app reads them; publishing (phase 3)
-- copies them into service_assignments, which the manifest, feed and availability
-- endpoints already query. That keeps one answer to "who is on this service".
--
-- Two statuses only. A published roster stays editable — weeks change and people
-- call in sick — so there is no third state implying it is locked.

CREATE TYPE roster_status_enum AS ENUM ('draft', 'published');

CREATE TABLE IF NOT EXISTS rosters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Always a Monday: callers normalise with date_trunc('week', d)::date. UNIQUE
  -- makes regeneration an update of one week rather than a pile of duplicates.
  week_start   DATE NOT NULL UNIQUE,
  status       roster_status_enum NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID
);

CREATE INDEX IF NOT EXISTS rosters_week_idx ON rosters (week_start DESC);

-- Staging for a draft. Deliberately NOT the source of truth for live crew:
-- publish writes these into service_assignments and these rows stay behind as a
-- record of what was originally proposed.
CREATE TABLE IF NOT EXISTS roster_shifts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id  UUID NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES scheduled_services(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- The asset this person crews, i.e. why the generator picked them. Kept so the
  -- review screen can explain each row rather than just asserting it.
  asset_id   UUID REFERENCES assets(id) ON DELETE SET NULL,
  role       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One shift per person per service: re-running generation must not stack.
  UNIQUE (roster_id, service_id, person_id)
);

CREATE INDEX IF NOT EXISTS roster_shifts_roster_idx  ON roster_shifts (roster_id);
CREATE INDEX IF NOT EXISTS roster_shifts_service_idx ON roster_shifts (service_id);
CREATE INDEX IF NOT EXISTS roster_shifts_person_idx  ON roster_shifts (person_id);
