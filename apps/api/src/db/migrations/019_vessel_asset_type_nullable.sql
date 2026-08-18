-- asset_type_id was NOT NULL + RESTRICT, which blocks deleting a type when
-- soft-deleted assets still reference it. Make it nullable and switch to SET NULL
-- so deleting a type silently clears the reference on already-deleted assets.
-- Active assets are still guarded by the assetTypeInUse check in the app.

ALTER TABLE vessel_assets
  ALTER COLUMN asset_type_id DROP NOT NULL;

ALTER TABLE vessel_assets
  DROP CONSTRAINT vessel_assets_asset_type_id_fkey,
  ADD CONSTRAINT vessel_assets_asset_type_id_fkey
    FOREIGN KEY (asset_type_id) REFERENCES vessel_asset_types(id) ON DELETE SET NULL;
