-- Offline idempotency for Complete Maintenance (mirrors 013 for faults). A queued
-- CompleteMaintenance command replays safely: the same key returns the existing
-- log, and its fault-close side effect is naturally idempotent (closing an
-- already-closed fault is a no-op). NULL = an online request with no key.
ALTER TABLE vessel_maintenance_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
