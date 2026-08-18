-- Normalize vehicle asset type name to plural convention and backfill fields.
-- Handles two cases:
--   a) only 'vehicle' exists → rename to 'Vehicles', then seed fields
--   b) both 'vehicle' and 'Vehicles' exist → point assets at 'Vehicles', drop duplicate, seed fields
DO $$
DECLARE
  vehicles_id uuid;
  vehicle_id  uuid;
BEGIN
  SELECT id INTO vehicles_id FROM vessel_asset_types WHERE name = 'Vehicles' LIMIT 1;
  SELECT id INTO vehicle_id  FROM vessel_asset_types WHERE name = 'vehicle'  LIMIT 1;

  IF vehicles_id IS NOT NULL AND vehicle_id IS NOT NULL THEN
    UPDATE vessel_assets SET asset_type_id = vehicles_id WHERE asset_type_id = vehicle_id;
    DELETE FROM vessel_asset_types WHERE id = vehicle_id;
  ELSIF vehicle_id IS NOT NULL THEN
    UPDATE vessel_asset_types SET name = 'Vehicles' WHERE id = vehicle_id;
    SELECT id INTO vehicles_id FROM vessel_asset_types WHERE name = 'Vehicles' LIMIT 1;
  END IF;

  -- Seed fields on Vehicles if still empty
  UPDATE vessel_asset_types
  SET fields = '[
    {"key":"registration", "label":"Registration plate","type":"text","required":true},
    {"key":"make",         "label":"Make",              "type":"text"},
    {"key":"model",        "label":"Model",             "type":"text"},
    {"key":"year",         "label":"Year",              "type":"number"},
    {"key":"fuel_type",    "label":"Fuel type",         "type":"select","options":["Petrol","Diesel","Electric","Hybrid","LPG"]},
    {"key":"odometer_km",  "label":"Odometer",          "type":"number","unit":"km"}
  ]'
  WHERE name = 'Vehicles'
    AND fields = '[]'::jsonb;
END $$;
