-- Add schema-driven particulars to asset manager.
-- fields[] on the type defines what to collect; particulars{} on the asset stores it.

ALTER TABLE vessel_asset_types
  ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '[]';

ALTER TABLE vessel_assets
  ADD COLUMN IF NOT EXISTS particulars JSONB NOT NULL DEFAULT '{}';

-- Seed field definitions for the five standard types.
UPDATE vessel_asset_types SET fields = '[
  {"key":"mmsi",               "label":"MMSI",             "type":"text"},
  {"key":"call_sign",          "label":"Call sign",         "type":"text"},
  {"key":"mnz_number",         "label":"MNZ registration",  "type":"text"},
  {"key":"fuel_capacity_l",    "label":"Fuel capacity",     "type":"number","unit":"litres"},
  {"key":"refuel_threshold_l", "label":"Refuel at",         "type":"number","unit":"litres"},
  {"key":"hours",              "label":"Engine hours",      "type":"number","unit":"hrs"}
]' WHERE name = 'Marine vessels';

UPDATE vessel_asset_types SET fields = '[
  {"key":"registration", "label":"Registration plate","type":"text","required":true},
  {"key":"make",         "label":"Make",              "type":"text"},
  {"key":"model",        "label":"Model",             "type":"text"},
  {"key":"year",         "label":"Year",              "type":"number"},
  {"key":"fuel_type",    "label":"Fuel type",         "type":"select","options":["Petrol","Diesel","Electric","Hybrid","LPG"]},
  {"key":"odometer_km",  "label":"Odometer",          "type":"number","unit":"km"}
]' WHERE name = 'Vehicles';

UPDATE vessel_asset_types SET fields = '[
  {"key":"serial_number",   "label":"Serial number",  "type":"text"},
  {"key":"make",            "label":"Make",           "type":"text"},
  {"key":"model",           "label":"Model",          "type":"text"},
  {"key":"purchase_date",   "label":"Purchase date",  "type":"date"},
  {"key":"warranty_expires","label":"Warranty expiry","type":"date"}
]' WHERE name = 'IT hardware';

UPDATE vessel_asset_types SET fields = '[
  {"key":"serial_number","label":"Serial number",   "type":"text"},
  {"key":"make",         "label":"Make",            "type":"text"},
  {"key":"model",        "label":"Model",           "type":"text"},
  {"key":"next_service", "label":"Next service",    "type":"date"},
  {"key":"hours",        "label":"Hours reading",   "type":"number","unit":"hrs"}
]' WHERE name = 'Plant & machinery';

UPDATE vessel_asset_types SET fields = '[
  {"key":"facility_type", "label":"Facility type",  "type":"text","placeholder":"e.g. Office, Accommodation, Staff home"},
  {"key":"address",       "label":"Address",         "type":"text"},
  {"key":"max_occupancy", "label":"Max occupancy",   "type":"number","unit":"people"}
]' WHERE name = 'Facilities';
