-- Task notes and attached documents for maintenance schedules.
ALTER TABLE vessel_maintenance_schedules
  ADD COLUMN IF NOT EXISTS task_notes    TEXT,
  ADD COLUMN IF NOT EXISTS document_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
