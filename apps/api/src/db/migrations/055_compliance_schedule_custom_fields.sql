ALTER TABLE compliance_schedules
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '[]';
