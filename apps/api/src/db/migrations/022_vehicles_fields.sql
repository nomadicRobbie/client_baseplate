-- Set field definitions on the Vehicles asset type.
-- Migration 021 ran before the vehicle naming was resolved, leaving this empty.
UPDATE vessel_asset_types
SET fields = '[
  {"key":"registration", "label":"Registration plate","type":"text","required":true},
  {"key":"make",         "label":"Make",              "type":"text"},
  {"key":"model",        "label":"Model",             "type":"text"},
  {"key":"year",         "label":"Year",              "type":"number"},
  {"key":"fuel_type",    "label":"Fuel type",         "type":"select","options":["Petrol","Diesel","Electric","Hybrid","LPG"]},
  {"key":"odometer_km",  "label":"Odometer",          "type":"number","unit":"km"}
]'
WHERE name = 'Vehicles';
