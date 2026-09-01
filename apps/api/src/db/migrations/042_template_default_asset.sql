ALTER TABLE service_templates
  ADD COLUMN IF NOT EXISTS default_asset_id UUID REFERENCES assets(id);
