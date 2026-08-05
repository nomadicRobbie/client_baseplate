-- De-brand: rename the legacy ETO-specific table/index to generic names.
-- No-op on fresh installs (005 already creates `locations`); on databases
-- provisioned before the rename it migrates the old `eto_locations` in place,
-- preserving existing rows.
ALTER TABLE IF EXISTS eto_locations RENAME TO locations;
ALTER INDEX IF EXISTS eto_locations_starts_at_idx RENAME TO locations_starts_at_idx;

-- The primary-key constraint keeps its original auto-generated name after a
-- table rename. Rename it too, guarded so fresh installs (already
-- `locations_pkey`) are untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eto_locations_pkey') THEN
    ALTER TABLE locations RENAME CONSTRAINT eto_locations_pkey TO locations_pkey;
  END IF;
END $$;
