-- Add roles array to asset types.
-- roles = ordered list of valid assignment role labels for this asset type.
-- Tenants define their own types and set roles when creating/updating a type.
-- Existing types default to empty array; add roles via PATCH /vessel/asset-types/:id.

ALTER TABLE vessel_asset_types
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}';
