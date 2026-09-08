import { flush, type OutboxCommand } from './outbox';
import { getAccessToken } from './session';
import { createComplianceRecord } from './api';

// Replay one queued compliance command. Idempotency_key = outbox key, so a
// retry after a lost ack is deduped server-side (exactly-once, same as asset).
// Cooling writes are intentionally excluded — they're time-anchored server-side
// and must not be queued.
async function sendCommand(c: OutboxCommand): Promise<void> {
  if (c.kind === 'LogComplianceRecord') {
    const p = c.payload as {
      record_type: string; entered_by: string; data: Record<string, unknown>;
      schedule_id?: string | null; datetime?: string | null;
    };
    await createComplianceRecord(getAccessToken()!, { ...p, idempotency_key: c.key });
  }
}

export const syncComplianceOutbox = () => flush(sendCommand);
