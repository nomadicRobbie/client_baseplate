-- Assign orphan schedules (plan_id IS NULL) to the oldest active food control plan.
-- Orphans pre-date the plan_id column and legally belong to one specific plan;
-- the oldest plan is the original real plan — duplicates created after the feature
-- already have their own plan_id set correctly.
-- If no active plan exists the UPDATE matches zero rows and is a no-op.
UPDATE compliance_schedules
SET plan_id = (
  SELECT id FROM food_control_plans
  WHERE active = true
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE plan_id IS NULL;
