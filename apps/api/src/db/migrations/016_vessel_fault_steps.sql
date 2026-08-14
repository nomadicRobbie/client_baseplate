-- Fault resolution timeline. A fault often takes several actions to resolve (part
-- ordered → part arrived → fitted), recorded as append-only steps. Closing a fault
-- records a final step too. kind: 'step' = progress note; 'close' = the closing note.
-- idempotency_key lets a queued AddFaultStep/CloseFault replay exactly-once offline.
CREATE TABLE IF NOT EXISTS vessel_fault_steps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fault_id         UUID NOT NULL REFERENCES vessel_faults(id) ON DELETE CASCADE,
  note             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'step',   -- step | close
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key  TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS vessel_fault_steps_fault_idx ON vessel_fault_steps (fault_id, created_at);
