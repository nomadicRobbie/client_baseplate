-- People core — the canonical human directory, shared across modules. Always on
-- (not feature-gated): vessel, compliance, and future HR/messaging modules all
-- hang domain data off people.id rather than duplicating a roster.
--
-- A person may or may not have a login. user_id NULL = "login-less": the person
-- is in the roster and nameable on records (skipper, crew, inductee) but cannot
-- authenticate. user_id is the blnk_auth user id (JWT `sub`) — a logical link
-- only (blnk_auth is a separate service), so no foreign key, same convention as
-- compliance_records.created_by.

CREATE TABLE IF NOT EXISTS people (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE,                       -- blnk_auth user id; NULL = login-less
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,     -- soft state; people are never hard-deleted (referenced by records)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-module membership + domain role. Unifies "assign person to module" with
-- "their role there": a skipper is (vessel, manager) and absent from compliance.
-- `role` is module-defined text (vessel: admin|manager|user) — people core stores
-- it but does not interpret it; the consuming module validates its own roles.
CREATE TABLE IF NOT EXISTS person_module (
  person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, module)
);
CREATE INDEX IF NOT EXISTS person_module_lookup_idx ON person_module (module, role);
