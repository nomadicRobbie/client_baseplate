-- Phase 3: weekday recurrence for asset maintenance schedules
ALTER TABLE asset_maintenance_schedules
  ADD COLUMN IF NOT EXISTS weekdays       int[]       NULL,
  ADD COLUMN IF NOT EXISTS recurrence_end_date date  NULL;
