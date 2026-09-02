-- Backfill roles for asset types that were skipped by migration 018.
-- 018 used INSERT ... WHERE NOT EXISTS, so pre-existing rows kept roles = '{}'.
-- This UPDATE only touches rows that still have empty roles to avoid
-- overwriting any intentional customisation.

UPDATE asset_types SET roles = ARRAY['Driver', 'Operator']        WHERE name = 'Vehicles'        AND roles = '{}';
UPDATE asset_types SET roles = ARRAY['Employee', 'Contractor']    WHERE name = 'IT hardware'     AND roles = '{}';
UPDATE asset_types SET roles = ARRAY['Operator', 'Technician']    WHERE name = 'Plant & machinery' AND roles = '{}';
UPDATE asset_types SET roles = ARRAY['Manager', 'Site Contact']   WHERE name = 'Facilities'      AND roles = '{}';
