-- Vessel / asset management module — initial build (pilot scope).
-- Source: TVM AppSheet schema (19 tables). This migration covers only the PILOT
-- vertical slice per the build plan (blnk/docs/tvm_vessel_module.md):
--   Foundations  — asset types, assets, components, personnel↔asset assignments
--   Fault→Maint. — faults, maintenance schedules, maintenance logs
-- The other 12 AppSheet tables (trips, compliance, drills, checklists, documents,
-- incidents, inductions, monthly checks) are later migrations, added as those
-- phases ship. Gated at the plugin by FEATURE_VESSEL; the tables exist regardless.
--
-- PERSONNEL = the `people` core (migration 011). Vessel does NOT have its own
-- personnel table: person references are FKs to people(id); the Admin/Manager/User
-- domain role lives in person_module.role (module 'vessel'); who-crews-which-vessel
-- is vessel_asset_assignments below.
--
-- Conventions (match compliance): UUID PKs; created_by/updated_by are blnk user ids
-- (JWT sub, logical link, no cross-service FK); soft state via status/active — no
-- hard delete of referenced structural records (FKs RESTRICT/SET NULL accordingly).
-- Evidence images are Cloudinary URLs for now (TEXT[]); a first-party asset service
-- swaps the storage later without touching the row shape.

-- ── Asset types (Asset Type 1:M Assets) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS vessel_asset_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                       -- e.g. 'Vessels', 'Vehicles'
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Assets (the fleet — vessels, and other managed assets) ──────────────────
CREATE TABLE IF NOT EXISTS vessel_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type_id     UUID NOT NULL REFERENCES vessel_asset_types(id) ON DELETE RESTRICT,
  parent_asset_id   UUID REFERENCES vessel_assets(id) ON DELETE SET NULL,   -- asset hierarchy
  name              TEXT NOT NULL,
  mnz_number        TEXT,                           -- Maritime NZ registration
  mmsi              TEXT,
  call_sign         TEXT,
  fuel_capacity     NUMERIC,                        -- litres
  refuel_threshold  NUMERIC,
  location          TEXT,
  condition         TEXT,
  supplier          TEXT,
  date_purchased    DATE,
  image_url         TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | retired | …  (soft state)
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_assets_type_idx   ON vessel_assets (asset_type_id);
CREATE INDEX IF NOT EXISTS vessel_assets_parent_idx ON vessel_assets (parent_asset_id);

-- ── Components (Assets 1:M Components; components self-nest) ─────────────────
CREATE TABLE IF NOT EXISTS vessel_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             UUID NOT NULL REFERENCES vessel_assets(id) ON DELETE RESTRICT,
  parent_component_id  UUID REFERENCES vessel_components(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  category             TEXT,                          -- e.g. 'Engine'
  quantity             NUMERIC,
  serial_number        TEXT,
  model                TEXT,
  manufacturer         TEXT,
  install_date         DATE,
  critical_component   BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_components_asset_idx  ON vessel_components (asset_id);
CREATE INDEX IF NOT EXISTS vessel_components_parent_idx ON vessel_components (parent_component_id);

-- ── Personnel ↔ asset assignments (AppSheet Personnel.Assigned_Assets / Skipper /
--    Crew, normalised into a join). Who operates which vessel, in what capacity. ─
CREATE TABLE IF NOT EXISTS vessel_asset_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  asset_id    UUID NOT NULL REFERENCES vessel_assets(id) ON DELETE CASCADE,
  role        TEXT,                                  -- skipper | crew | … (nullable)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, asset_id)
);
CREATE INDEX IF NOT EXISTS vessel_assignments_asset_idx  ON vessel_asset_assignments (asset_id);
CREATE INDEX IF NOT EXISTS vessel_assignments_person_idx ON vessel_asset_assignments (person_id);

-- ── Fault report log (reported defects; lifecycle: open → assigned → closed,
--    closure requires linked maintenance evidence — enforced in the app) ──────
CREATE TABLE IF NOT EXISTS vessel_faults (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         UUID NOT NULL REFERENCES vessel_assets(id) ON DELETE RESTRICT,
  component_id     UUID REFERENCES vessel_components(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  image_urls       TEXT[] NOT NULL DEFAULT '{}',     -- AppSheet Image 1..5 → array
  urgency          TEXT,                             -- Low | Medium | High | Critical
  status           TEXT NOT NULL DEFAULT 'open',     -- open | assigned | closed
  reported_by      UUID REFERENCES people(id),       -- (default NO ACTION: keep history)
  reported_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_to      UUID REFERENCES people(id),
  resolution_notes TEXT,
  signed_by        UUID REFERENCES people(id),       -- sign-off locks the record (app-enforced)
  signed_at        TIMESTAMPTZ,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_faults_asset_idx  ON vessel_faults (asset_id, status);
CREATE INDEX IF NOT EXISTS vessel_faults_assignee_idx ON vessel_faults (assigned_to);

-- ── Maintenance schedules (persistent definition of recurring work) ─────────
CREATE TABLE IF NOT EXISTS vessel_maintenance_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID NOT NULL REFERENCES vessel_assets(id) ON DELETE RESTRICT,
  component_id      UUID REFERENCES vessel_components(id) ON DELETE SET NULL,
  task_name         TEXT NOT NULL,
  interval_type     TEXT,                            -- Months | Hours | …
  interval_value    NUMERIC,
  initial_due_date  DATE,
  alert_days        INT,
  alert_hours       NUMERIC,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  -- checklist_template_id added when the checklists table lands (later phase)
);
CREATE INDEX IF NOT EXISTS vessel_maint_sched_asset_idx ON vessel_maintenance_schedules (asset_id);

-- ── Maintenance log (append-only completion evidence). May come from a schedule
--    OR from a fault (Fault 0:M Maintenance Log) — both links nullable. ────────
CREATE TABLE IF NOT EXISTS vessel_maintenance_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id       UUID REFERENCES vessel_maintenance_schedules(id) ON DELETE SET NULL,
  fault_id          UUID REFERENCES vessel_faults(id) ON DELETE SET NULL,
  asset_id          UUID NOT NULL REFERENCES vessel_assets(id) ON DELETE RESTRICT,
  component_id      UUID REFERENCES vessel_components(id) ON DELETE SET NULL,
  task_name         TEXT,
  maintenance_type  TEXT,                            -- Scheduled | Unscheduled | …
  completed_date    DATE,
  usage_at_service  NUMERIC,                         -- engine hours / usage at service
  supplier          TEXT,
  image_urls        TEXT[] NOT NULL DEFAULT '{}',
  resolves_fault    BOOLEAN NOT NULL DEFAULT false,  -- "Resolve related fault report?"
  resolution_notes  TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'complete',
  completed_by      UUID REFERENCES people(id),
  signed_by         UUID REFERENCES people(id),
  signed_at         TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_maint_log_asset_idx    ON vessel_maintenance_logs (asset_id, completed_date DESC);
CREATE INDEX IF NOT EXISTS vessel_maint_log_schedule_idx ON vessel_maintenance_logs (schedule_id);
CREATE INDEX IF NOT EXISTS vessel_maint_log_fault_idx    ON vessel_maintenance_logs (fault_id);
