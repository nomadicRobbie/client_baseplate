-- Replace free-text location_label with a typed FK to the Facilities asset type.
-- Nullable in DB so existing rows and history stay intact; required at API layer.
ALTER TABLE service_templates
  DROP COLUMN location_label,
  ADD COLUMN facility_id UUID REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE scheduled_services
  DROP COLUMN location_label,
  ADD COLUMN facility_id UUID REFERENCES assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_templates_facility_idx   ON service_templates   (facility_id) WHERE facility_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduled_services_facility_idx  ON scheduled_services  (facility_id) WHERE facility_id IS NOT NULL;
