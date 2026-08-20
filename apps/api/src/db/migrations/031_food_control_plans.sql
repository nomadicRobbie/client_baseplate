-- Food Control Plans — named plan entities that own compliance schedules and
-- can be assigned to assets. Enables multi-plan tenants (one per site/asset)
-- and per-staff plan scoping.
--
-- Relationship map:
--   food_control_plans  1:M  compliance_schedules  (via plan_id)
--   vessel_assets       M:1  food_control_plans     (via food_control_plan_id — asset owns a plan)
--   people              M:M  food_control_plans     (via person_plan — staff see only their plans)
--
-- Backward compatible: existing compliance_schedules rows have plan_id = NULL
-- and remain fully functional. Admins see all plans; members see only assigned ones.

CREATE TABLE IF NOT EXISTS food_control_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'FCP',  -- FCP | NP1 | NP2 | NP3
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Asset optionally owns a control plan.
ALTER TABLE vessel_assets
  ADD COLUMN IF NOT EXISTS food_control_plan_id UUID REFERENCES food_control_plans(id) ON DELETE SET NULL;

-- Schedules optionally belong to a plan (NULL = unscoped / pre-migration).
ALTER TABLE compliance_schedules
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES food_control_plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS compliance_schedules_plan_idx ON compliance_schedules (plan_id);

-- Staff ↔ plan assignment. Non-admin members see only their assigned plans.
CREATE TABLE IF NOT EXISTS person_plan (
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  plan_id   UUID NOT NULL REFERENCES food_control_plans(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, plan_id)
);
CREATE INDEX IF NOT EXISTS person_plan_plan_idx ON person_plan (plan_id);
