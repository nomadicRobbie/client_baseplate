-- Rule override flag. When an admin manually assigns someone who would
-- normally be blocked by rest/consecutive-days rules, this records that
-- the assignment was a deliberate override rather than a generator pick.
ALTER TABLE roster_shifts
  ADD COLUMN IF NOT EXISTS rule_override BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE service_assignments
  ADD COLUMN IF NOT EXISTS rule_override BOOLEAN NOT NULL DEFAULT false;
