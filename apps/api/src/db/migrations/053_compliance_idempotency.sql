-- Idempotency key for compliance records — enables exactly-once offline replay.
-- NULL values are excluded from the unique index so plain online writes (no key)
-- never conflict with each other.
ALTER TABLE compliance_records
  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX compliance_records_idempotency_key_uidx
  ON compliance_records (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
