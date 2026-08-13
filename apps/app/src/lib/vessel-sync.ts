import type { VesselAsset } from '@blnk/shared';
import { flush, type OutboxCommand } from './outbox';
import { getAccessToken } from './session';
import { readThrough } from './mirror';
import { listVesselAssets, createVesselFault, createVesselMaintenanceLog } from './api';

const tok = () => getAccessToken()!;

// Resolve one asset for a route header from the (cached) fleet list — offline-safe,
// no extra fetch. Every vessel sub-route enters via the fleet, so it's always cached.
export async function loadAsset(assetId: string): Promise<{ asset: VesselAsset | null; offline: boolean }> {
  const r = await readThrough('vessel:assets', () => listVesselAssets(tok()));
  return { asset: r.value.assets.find((a) => a.id === assetId) ?? null, offline: r.stale };
}

// Replay one queued vessel command. Each carries idempotency_key = the outbox key,
// so a retry after a lost ack is deduped server-side (exactly-once). Shared by every
// vessel route so a flush drains the WHOLE queue regardless of which screen fired it.
async function sendCommand(c: OutboxCommand): Promise<void> {
  if (c.kind === 'LogFault') {
    const p = c.payload as { asset_id: string; name: string; description?: string; urgency?: string };
    await createVesselFault(tok(), { ...p, idempotency_key: c.key });
  } else if (c.kind === 'CompleteMaintenance') {
    const p = c.payload as { asset_id: string; fault_id?: string; task_name?: string; resolves_fault?: boolean; completed_date?: string };
    await createVesselMaintenanceLog(tok(), { ...p, idempotency_key: c.key });
  }
}

// Drain the offline outbox. Returns { sent, remaining }.
export const syncVesselOutbox = () => flush(sendCommand);
