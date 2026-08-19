-- Auto-generated short ID for each scheduled check unit so it can be
-- pre-filled (read-only) when staff complete the check, ensuring consistency.
ALTER TABLE compliance_schedules
  ADD COLUMN IF NOT EXISTS unit_id TEXT NOT NULL DEFAULT upper(substring(gen_random_uuid()::text, 1, 6));
