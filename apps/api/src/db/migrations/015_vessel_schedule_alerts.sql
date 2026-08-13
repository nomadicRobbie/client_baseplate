-- Multiple reminder alerts per maintenance schedule (e.g. 7 days / 1 day / 1 hour
-- before due). Array of {value, unit} with unit ∈ hours|days|weeks. Used now for the
-- dashboard "due soon" window (the largest alert); firing a notification at each
-- offset lands with the automation phase. The single alert_days/alert_hours columns
-- stay for existing rows; new writes use `alerts`.
ALTER TABLE vessel_maintenance_schedules ADD COLUMN IF NOT EXISTS alerts JSONB NOT NULL DEFAULT '[]';
