-- Food safety compliance module — jurisdiction-agnostic engine, seed-driven rules.
-- Country-specific record types are seeded in separate numbered migrations
-- (007_compliance_nz.sql). Adding a country = new seed migration, no code change.
-- Gated per tenant by FEATURE_COMPLIANCE.

-- Sites: multi-site + mobile "home base" (food trucks). Records attribute to one.
CREATE TABLE IF NOT EXISTS compliance_sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  address      TEXT,
  is_home_base BOOLEAN NOT NULL DEFAULT false,   -- mobile / market-stall nominated base
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Record-type registry — the country-pluggable heart of the module.
-- One row per record type per jurisdiction. `field_schema` drives the form UI;
-- `critical_limit` drives automatic pass/fail evaluation. Both JSONB so a new
-- country (or an updated MPI template version) is pure seed data.
CREATE TABLE IF NOT EXISTS compliance_record_types (
  jurisdiction   TEXT NOT NULL DEFAULT 'NZ',       -- ISO-ish country/rule-set key
  code           TEXT NOT NULL,                    -- e.g. 'fridge_temp'
  label          TEXT NOT NULL,
  category       TEXT,                             -- UI grouping (temperature, receiving…)
  tiers          TEXT[] NOT NULL DEFAULT '{}',     -- {FCP,NP1,NP2,NP3}
  frequency      TEXT,                             -- daily|per_batch|per_delivery|on_change|periodic|per_incident|reference
  mandatory      BOOLEAN NOT NULL DEFAULT true,    -- false = "demonstrate"/conditional
  field_schema   JSONB NOT NULL DEFAULT '[]',      -- [{key,label,type,unit?,options?,required?}]
  critical_limit JSONB,                            -- {field,op,value} rule; null = no auto-check
  sort_order     INT NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (jurisdiction, code)
);

-- The universal record entry (requirements doc Section 3). Universal fields are
-- real columns; type-specific fields live in `data` per the type's field_schema.
CREATE TABLE IF NOT EXISTS compliance_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction         TEXT NOT NULL DEFAULT 'NZ',
  record_type          TEXT NOT NULL,
  site_id              UUID REFERENCES compliance_sites(id),
  entered_by           TEXT NOT NULL,                 -- staff name/initials on the check
  created_by           UUID,                          -- blnk user id from the JWT
  datetime             TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the check happened (editable)
  result               TEXT NOT NULL DEFAULT 'na',    -- pass | fail | na
  data                 JSONB NOT NULL DEFAULT '{}',   -- type-specific fields
  corrective_action_id UUID REFERENCES compliance_records(id),  -- links a fail to its CA record
  attachment_url       TEXT,
  voided_at            TIMESTAMPTZ,                    -- soft-void only; never hard-delete (retention)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (jurisdiction, record_type)
    REFERENCES compliance_record_types (jurisdiction, code)
);
CREATE INDEX IF NOT EXISTS compliance_records_type_idx ON compliance_records (record_type, datetime DESC);
CREATE INDEX IF NOT EXISTS compliance_records_site_idx ON compliance_records (site_id, datetime DESC);

-- Trusted supplier list (doc 4.8) — a referenced lookup, so its own table.
CREATE TABLE IF NOT EXISTS compliance_suppliers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  contact      TEXT,
  products     TEXT,
  registration TEXT,                              -- Food Act / Animal Products reg no.
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
