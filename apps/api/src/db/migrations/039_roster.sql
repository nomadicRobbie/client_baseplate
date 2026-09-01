-- Roster module, phase 1 — the days crew cannot work.
--
-- Only exceptions are stored: no row means available. Asking everyone to declare
-- positive availability every week is far more data entry for the same answer.
--
-- `kind` separates leave booked weeks ahead from a sick day called in on the
-- morning. Identical shape, different consequence: planned leave is read by the
-- generator before a roster exists, while a sick day lands on a week that is
-- already published and opens those shifts for cover.
--
-- No tenant_id — single-tenant-per-deployment, same as every other table here.

CREATE TABLE IF NOT EXISTS person_unavailability (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'planned',
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  -- One row per person per day: re-declaring a day updates it rather than
  -- stacking duplicates the generator would have to de-dupe.
  UNIQUE (person_id, date),
  CONSTRAINT person_unavailability_kind_chk CHECK (kind IN ('planned', 'sick'))
);

-- Range scan for "who is off this week" (generator + admin team view).
CREATE INDEX IF NOT EXISTS person_unavailability_date_idx
  ON person_unavailability (date);

-- Covers "my days off between these dates" without touching the table.
CREATE INDEX IF NOT EXISTS person_unavailability_person_date_idx
  ON person_unavailability (person_id, date);
