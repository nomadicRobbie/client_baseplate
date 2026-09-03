-- Tighten default max_consecutive_days from 6 to 5 (guarantees at least 2 days off
-- per 7-day window). Only update the singleton row if it still holds the old default
-- so a tenant that already tightened this manually is not affected.
ALTER TABLE roster_rules
  ALTER COLUMN max_consecutive_days SET DEFAULT 5;

UPDATE roster_rules SET max_consecutive_days = 5 WHERE id = true AND max_consecutive_days = 6;
