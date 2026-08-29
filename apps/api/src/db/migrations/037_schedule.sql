-- Schedule register — the trip board for marine operations.
-- Stores planned services (dated instances), recurring templates, crew/asset
-- assignments from the existing People and Asset registers, and an append-only
-- event log. No tenant_id: this is single-tenant-per-deployment (same as all
-- other tables in this schema). Isolation is at the deploy level.

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE service_status_enum AS ENUM (
  'draft', 'planned', 'confirmed', 'completed', 'cancelled'
);

CREATE TYPE service_subject_type_enum AS ENUM ('person', 'asset');

CREATE TYPE service_event_type_enum AS ENUM (
  'created', 'rescheduled', 'capacity_changed', 'assigned',
  'unassigned', 'cancelled', 'completed', 'note_added'
);

-- ── service_templates — the recurring definition ──────────────────────────────
CREATE TABLE IF NOT EXISTS service_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  duration_minutes     INT NOT NULL,
  default_capacity     INT NOT NULL DEFAULT 0,
  location_label       TEXT,
  timezone             TEXT NOT NULL,              -- IANA e.g. 'Pacific/Auckland'
  required_roles       JSONB NOT NULL DEFAULT '[]', -- [{role,count}]
  required_asset_types JSONB NOT NULL DEFAULT '[]', -- [{asset_type_id,count}]
  recurrence           JSONB,                      -- {days:[0..6],time:'HH:MM'} — generation input only
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── scheduled_services — the register itself ──────────────────────────────────
-- id is client-supplied (UUIDv7) so offline creation never collides.
CREATE TABLE IF NOT EXISTS scheduled_services (
  id                   UUID PRIMARY KEY,
  template_id          UUID REFERENCES service_templates(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,              -- snapshot from template at generation
  starts_at            TIMESTAMPTZ NOT NULL,
  ends_at              TIMESTAMPTZ NOT NULL,
  timezone             TEXT NOT NULL,              -- snapshot — IANA
  location_label       TEXT,
  capacity             INT NOT NULL DEFAULT 0,
  required_roles       JSONB NOT NULL DEFAULT '[]', -- snapshot
  status               service_status_enum NOT NULL DEFAULT 'draft',
  cancellation_reason  TEXT,
  external_ref         TEXT,
  notes                TEXT NOT NULL DEFAULT '',
  version              INT NOT NULL DEFAULT 1,     -- optimistic concurrency for offline merge
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID
);

-- Unique constraint on (template_id, starts_at) drives idempotent generation:
-- ON CONFLICT (template_id, starts_at) DO NOTHING skips already-created rows.
-- Partial index excludes one-offs (template_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_services_template_starts_idx
  ON scheduled_services (template_id, starts_at)
  WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS scheduled_services_window_idx  ON scheduled_services (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS scheduled_services_status_idx  ON scheduled_services (status);
CREATE INDEX IF NOT EXISTS scheduled_services_updated_idx ON scheduled_services (updated_at);

-- ── service_assignments — links into People and Asset registers ───────────────
-- subject_id is a logical FK to people.id or assets.id (same convention as
-- created_by/updated_by throughout this schema — no cross-table FK enforcement).
-- Never DELETE: soft-remove via removed_at.
CREATE TABLE IF NOT EXISTS service_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES scheduled_services(id) ON DELETE RESTRICT,
  subject_type service_subject_type_enum NOT NULL,
  subject_id   UUID NOT NULL,
  role         TEXT,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by  UUID,
  removed_at   TIMESTAMPTZ,
  removed_by   UUID
);

CREATE INDEX IF NOT EXISTS service_assignments_service_idx
  ON service_assignments (service_id)
  WHERE removed_at IS NULL;

-- ── scheduled_service_events — append-only audit log ─────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_service_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES scheduled_services(id) ON DELETE RESTRICT,
  event_type  service_event_type_enum NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  actor_id    UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_events_service_idx ON scheduled_service_events (service_id);

-- Enforce append-only at the DB level via a trigger (fires for all roles
-- including superusers) plus a REVOKE as a second layer for non-superuser
-- app roles in production.
CREATE OR REPLACE FUNCTION scheduled_service_events_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scheduled_service_events is append-only: DELETE is not permitted (event_id: %)', OLD.id;
END;
$$;

CREATE TRIGGER no_delete_scheduled_service_events
  BEFORE DELETE ON scheduled_service_events
  FOR EACH ROW EXECUTE FUNCTION scheduled_service_events_no_delete();

REVOKE DELETE ON scheduled_service_events FROM "ting-test";
