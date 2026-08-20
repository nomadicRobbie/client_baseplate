-- Rename vessel_* tables to asset_* (module renamed from 'vessel' to 'asset').
-- vessel_assets → assets (dropping the redundant prefix).
-- All other tables keep the asset_ prefix for clarity.

ALTER TABLE vessel_asset_types         RENAME TO asset_types;
ALTER TABLE vessel_assets              RENAME TO assets;
ALTER TABLE vessel_asset_assignments   RENAME TO asset_assignments;
ALTER TABLE vessel_components          RENAME TO asset_components;
ALTER TABLE vessel_faults              RENAME TO asset_faults;
ALTER TABLE vessel_fault_steps         RENAME TO asset_fault_steps;
ALTER TABLE vessel_maintenance_schedules RENAME TO asset_maintenance_schedules;
ALTER TABLE vessel_maintenance_logs    RENAME TO asset_maintenance_logs;

-- Rename indexes to match new table names.
ALTER INDEX IF EXISTS vessel_assets_type_idx   RENAME TO assets_type_idx;
ALTER INDEX IF EXISTS vessel_assets_parent_idx RENAME TO assets_parent_idx;
ALTER INDEX IF EXISTS vessel_components_asset_idx  RENAME TO asset_components_asset_idx;
ALTER INDEX IF EXISTS vessel_components_parent_idx RENAME TO asset_components_parent_idx;
ALTER INDEX IF EXISTS vessel_assignments_asset_idx  RENAME TO asset_assignments_asset_idx;
ALTER INDEX IF EXISTS vessel_assignments_person_idx RENAME TO asset_assignments_person_idx;

-- Update module name string stored in person_module rows.
UPDATE person_module SET module = 'asset' WHERE module = 'vessel';
