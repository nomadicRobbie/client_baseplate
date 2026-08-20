import type { Asset } from '@blnk/shared';
import { flush, type OutboxCommand } from './outbox';
import { getAccessToken } from './session';
import { readThrough } from './mirror';
import { listAssets, createAssetFault, createAssetMaintenanceLog, addAssetFaultStep, closeAssetFault } from './api';

const tok = () => getAccessToken()!;

// Resolve one asset for a route header from the (cached) fleet list — offline-safe,
// no extra fetch. Every asset sub-route enters via the fleet, so it's always cached.
export async function loadAsset(assetId: string): Promise<{ asset: Asset | null; offline: boolean }> {
  const r = await readThrough('asset:assets', () => listAssets(tok()));
  return { asset: r.value.assets.find((a) => a.id === assetId) ?? null, offline: r.stale };
}

// Replay one queued asset command. Each carries idempotency_key = the outbox key,
// so a retry after a lost ack is deduped server-side (exactly-once). Shared by every
// asset route so a flush drains the WHOLE queue regardless of which screen fired it.
async function sendCommand(c: OutboxCommand): Promise<void> {
  if (c.kind === 'LogFault') {
    const p = c.payload as { asset_id: string; name: string; description?: string; urgency?: string };
    await createAssetFault(tok(), { ...p, idempotency_key: c.key });
  } else if (c.kind === 'CompleteMaintenance') {
    const p = c.payload as { asset_id: string; fault_id?: string; task_name?: string; resolves_fault?: boolean; completed_date?: string };
    await createAssetMaintenanceLog(tok(), { ...p, idempotency_key: c.key });
  } else if (c.kind === 'AddFaultStep') {
    const p = c.payload as { fault_id: string; note: string };
    await addAssetFaultStep(tok(), p.fault_id, { note: p.note, idempotency_key: c.key });
  } else if (c.kind === 'CloseFault') {
    const p = c.payload as { fault_id: string; resolution_notes: string };
    await closeAssetFault(tok(), p.fault_id, { resolution_notes: p.resolution_notes, idempotency_key: c.key });
  }
}

// Drain the offline outbox. Returns { sent, remaining }.
export const syncAssetOutbox = () => flush(sendCommand);
