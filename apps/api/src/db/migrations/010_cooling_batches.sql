-- Real-time cooling batches. A batch is tracked live while cooling (surfaces on
-- Today), then finalized into a standard `cooling` compliance_record on
-- completion so the audit log/history stays uniform.
CREATE TABLE IF NOT EXISTS compliance_cooling_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction  TEXT NOT NULL DEFAULT 'NZ',
  product       TEXT NOT NULL,
  site_id       UUID REFERENCES compliance_sites(id),
  started_by    TEXT NOT NULL,
  created_by    UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 60°C, cooling clock starts
  reached_21_at TIMESTAMPTZ,                          -- stage 1 done (≤ 2h from start)
  reached_5_at  TIMESTAMPTZ,                          -- stage 2 done (≤ 4h after 21°C)
  status        TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | done | discarded
  record_id     UUID REFERENCES compliance_records(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_cooling_status_idx ON compliance_cooling_batches (status);
