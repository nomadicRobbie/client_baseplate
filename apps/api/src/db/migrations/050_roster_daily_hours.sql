-- Add max_daily_hours rule. Caps total hours worked across all services in a
-- single calendar day. Same-day services no longer trigger the inter-shift rest
-- check — rest only applies between calendar days.
ALTER TABLE roster_rules
  ADD COLUMN IF NOT EXISTS max_daily_hours INTEGER NOT NULL DEFAULT 8;
