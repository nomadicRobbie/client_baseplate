-- Recurring compliance checks the operator defines (daily/weekly/monthly/interval),
-- per unit (label). These populate the "Today" view on the dates they're due.
CREATE TABLE IF NOT EXISTS compliance_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction  TEXT NOT NULL DEFAULT 'NZ',
  record_type   TEXT NOT NULL,                    -- which check (FK to the registry)
  label         TEXT NOT NULL,                    -- operator's name, e.g. "Main chiller"
  site_id       UUID REFERENCES compliance_sites(id),
  cadence       TEXT NOT NULL,                    -- daily | weekly | monthly | interval
  weekdays      INT[] NOT NULL DEFAULT '{}',      -- weekly: 0=Sun … 6=Sat
  day_of_month  INT,                              -- monthly: 1–31
  interval_days INT,                              -- interval: every N days
  anchor_date   DATE,                             -- interval: reference start date
  times_per_day INT NOT NULL DEFAULT 1,           -- completions required on a due day
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (jurisdiction, record_type)
    REFERENCES compliance_record_types (jurisdiction, code)
);
CREATE INDEX IF NOT EXISTS compliance_schedules_active_idx ON compliance_schedules (active);

-- Link a logged record back to the schedule it satisfies (for done-detection).
ALTER TABLE compliance_records ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES compliance_schedules(id);
CREATE INDEX IF NOT EXISTS compliance_records_schedule_idx ON compliance_records (schedule_id, datetime);
