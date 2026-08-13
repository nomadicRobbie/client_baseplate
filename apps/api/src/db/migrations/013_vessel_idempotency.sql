-- Offline command idempotency (spike) — fault logging.
-- A queued LogFault command carries a client-generated idempotency_key. Replaying
-- it (the offline outbox re-sends until acked) must not create a duplicate: the
-- second insert with the same key returns the existing fault. NULL = an online
-- request with no key — multiple NULLs are fine, UNIQUE treats them as distinct.
-- (Pilot proves the pattern on faults; generalise to other commands with the full
-- offline build.)
ALTER TABLE vessel_faults ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
