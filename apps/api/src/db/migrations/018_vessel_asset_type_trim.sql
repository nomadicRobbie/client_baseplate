-- Trim over-seeded asset types down to five core categories.
-- Only removes types that have no assets assigned to them.

DELETE FROM vessel_asset_types
WHERE name IN (
  'Office equipment', 'IT hardware', 'Software / Licences',
  'Plant & machinery', 'Facilities', 'Security & access',
  'Specialist equipment', 'Marine equipment'
)
AND id NOT IN (
  SELECT DISTINCT asset_type_id FROM vessel_assets WHERE status <> 'deleted'
);

-- Re-seed the five we keep (skip if already present from a partial run).
INSERT INTO vessel_asset_types (name, roles)
SELECT name, roles FROM (VALUES
  ('Vehicles',       ARRAY['Driver', 'Operator']),
  ('IT hardware',    ARRAY['Employee', 'Contractor']),
  ('Plant & machinery', ARRAY['Operator', 'Technician']),
  ('Marine vessels', ARRAY['Captain', 'First Mate', 'Engineer', 'Crew', 'Observer']),
  ('Facilities',     ARRAY['Manager', 'Site Contact'])
) AS t(name, roles)
WHERE NOT EXISTS (
  SELECT 1 FROM vessel_asset_types v WHERE v.name = t.name
);
