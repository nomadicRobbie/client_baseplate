-- Constrain person_module.module to the declared module keys.
-- Catches typos at the DB layer (was free-text TEXT with no guard).
-- When a new module is added to MODULE_MANIFEST, add it here too.
ALTER TABLE person_module
  ADD CONSTRAINT person_module_key_check
  CHECK (module IN ('asset', 'compliance', 'commerce', 'schedule', 'roster', 'analytics', 'locations'));
