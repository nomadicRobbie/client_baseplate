-- Form schema for maintenance schedules (admin-defined field list).
-- Form data + attachments for maintenance logs (crew-filled at completion).
ALTER TABLE vessel_maintenance_schedules ADD COLUMN IF NOT EXISTS form_schema JSONB;
ALTER TABLE vessel_maintenance_logs      ADD COLUMN IF NOT EXISTS form_data   JSONB;
ALTER TABLE vessel_maintenance_logs      ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
