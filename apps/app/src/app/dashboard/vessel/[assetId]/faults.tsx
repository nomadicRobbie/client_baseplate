import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselFault } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselFaults } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { enqueue, pending as pendingCommands, pendingCount } from '@/lib/outbox';
import { syncVesselOutbox, loadAsset } from '@/lib/vessel-sync';
import { useOnReconnect } from '@/lib/use-reconnect';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge, Notice } from '@/ui/components';
import { StatusBadge, urgencyLevel, OfflineBanner, PendingSyncBanner } from '@/ui/status';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const today = () => new Date().toISOString().slice(0, 10);
const tok = () => getAccessToken()!;

export default function VesselFaults() {
  const t = useTheme();
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features } = useAuth();

  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [faults, setFaults] = useState<VesselFault[]>([]);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(pendingCount());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  // log-fault form
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fUrgency, setFUrgency] = useState('Medium');
  // resolve flow — which fault's actions are open, and the shared note
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  const loadFaults = async () => {
    try {
      const r = await readThrough('vessel:faults:' + assetId, () => listVesselFaults(tok(), { asset_id: assetId }));
      setFaults(r.value.faults); setOffline(r.stale);
    } catch (e) { err(e); }
  };
  const doSync = async (): Promise<number> => {
    const { remaining } = await syncVesselOutbox();
    setPending(remaining);
    await loadFaults();
    return remaining;
  };
  useEffect(() => {
    void (async () => { const { asset } = await loadAsset(assetId); setAsset(asset); })();
    void loadFaults(); void doSync();
  }, [assetId]);
  useOnReconnect(() => { void doSync(); });

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const queued = (remaining: number, done: string) =>
    setMsg(remaining === 0 ? { text: done, tone: 'success' } : { text: `Queued offline — ${remaining} waiting to sync.`, tone: 'info' });

  const logFault = async () => {
    if (!fName.trim()) { setMsg({ text: 'Fault name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('LogFault', { asset_id: assetId, name: fName.trim(), description: fDesc.trim() || undefined, urgency: fUrgency });
    setFName(''); setFDesc(''); setFUrgency('Medium'); setPending(pendingCount());
    try { queued(await doSync(), 'Fault logged.'); } finally { setBusy(false); }
  };
  // Progress step — records what's been done, fault stays open.
  const addStep = async (f: VesselFault) => {
    if (!note.trim()) { setMsg({ text: 'Add a note for the step.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('AddFaultStep', { fault_id: f.id, note: note.trim() });
    setNote(''); setPending(pendingCount());
    try { queued(await doSync(), 'Step recorded.'); } finally { setBusy(false); }
  };
  // Close with just a note — no maintenance record required.
  const closeWithNote = async (f: VesselFault) => {
    if (!note.trim()) { setMsg({ text: 'Add a closing note.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('CloseFault', { fault_id: f.id, resolution_notes: note.trim() });
    setNote(''); setActiveId(null); setPending(pendingCount());
    try { queued(await doSync(), 'Fault closed.'); } finally { setBusy(false); }
  };
  // Close with a full maintenance record.
  const closeWithMaintenance = async (f: VesselFault) => {
    setBusy(true); setMsg(null);
    enqueue('CompleteMaintenance', { asset_id: assetId, fault_id: f.id, resolves_fault: true, task_name: note.trim() || 'Repair', completed_date: today() });
    setNote(''); setActiveId(null); setPending(pendingCount());
    try { queued(await doSync(), 'Maintenance logged — fault closed.'); } finally { setBusy(false); }
  };

  const open = faults.filter((f) => f.status !== 'closed');
  const closed = faults.filter((f) => f.status === 'closed');
  const pendingLogged = pendingCommands()
    .filter((c) => c.kind === 'LogFault' && (c.payload as { asset_id: string }).asset_id === assetId)
    .map((c) => ({ key: c.key, ...(c.payload as { name: string; description?: string; urgency?: string }) }));
  const pendingCloseIds = new Set(
    pendingCommands().filter((c) => c.kind === 'CompleteMaintenance' || c.kind === 'CloseFault')
      .map((c) => (c.payload as { fault_id?: string }).fault_id).filter((id): id is string => !!id),
  );
  const pendingStepsByFault: Record<string, string[]> = {};
  for (const c of pendingCommands()) if (c.kind === 'AddFaultStep') {
    const p = c.payload as { fault_id: string; note: string };
    (pendingStepsByFault[p.fault_id] ??= []).push(p.note);
  }

  return (
    <Screen>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId } })} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Vessel'}</Text>
      </Pressable>
      <Text variant="title">Faults</Text>

      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => void doSync()} busy={busy} />

      {/* Log a fault */}
      <Card>
        <Text variant="heading">Log a fault</Text>
        <TextField label="Fault" value={fName} onChangeText={setFName} placeholder="e.g. Navigation light corrosion" autoCapitalize="sentences" />
        <TextField label="Description" value={fDesc} onChangeText={setFDesc} placeholder="Optional" autoCapitalize="sentences" />
        <View style={{ gap: 6 }}>
          <Text variant="label" muted>Urgency</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {URGENCIES.map((u) => {
              const sel = fUrgency === u;
              return (
                <Pressable key={u} onPress={() => setFUrgency(u)} accessibilityRole="button"
                  style={{ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                  <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{u}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Button label="Log fault" onPress={logFault} loading={busy} />
      </Card>

      {/* Open faults */}
      <Card>
        <Text variant="heading">Open faults {open.length ? `(${open.length})` : ''}</Text>
        {pendingLogged.map((p) => (
          <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text>{p.name}</Text>
              {!!p.description && <Text variant="small" muted>{p.description}</Text>}
            </View>
            {!!p.urgency && <StatusBadge level={urgencyLevel(p.urgency)} label={p.urgency} />}
            <Badge label="pending sync" tone="accent" />
          </View>
        ))}
        {open.length === 0 && pendingLogged.length === 0 ? <Text muted>No open faults.</Text> : open.map((f) => {
          const expanded = activeId === f.id;
          const closing = pendingCloseIds.has(f.id);
          const pSteps = pendingStepsByFault[f.id] ?? [];
          return (
            <View key={f.id} style={{ paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, gap: t.space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text>{f.name}</Text>
                  {!!f.description && <Text variant="small" muted>{f.description}</Text>}
                </View>
                {!!f.urgency && <StatusBadge level={urgencyLevel(f.urgency)} label={f.urgency} />}
              </View>

              {/* Resolution timeline */}
              {(f.steps?.length > 0 || pSteps.length > 0) && (
                <View style={{ gap: 2, paddingLeft: t.space.sm }}>
                  {f.steps.map((s) => (
                    <Text key={s.id} variant="small" muted>• {s.note}{s.kind === 'close' ? ' (closed)' : ''} · {formatDMY(s.created_at)}</Text>
                  ))}
                  {pSteps.map((n, i) => <Text key={`p${i}`} variant="small" muted>• {n} · pending sync</Text>)}
                </View>
              )}

              {closing ? (
                <View style={{ flexDirection: 'row' }}><Badge label="closing — pending sync" tone="accent" /></View>
              ) : expanded ? (
                <View style={{ gap: t.space.sm }}>
                  <TextField label="Note (what was done, or the next step)" value={note} onChangeText={setNote} placeholder="e.g. Ordered replacement connector" autoCapitalize="sentences" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
                    <Button label="Add step" variant="secondary" onPress={() => addStep(f)} loading={busy} />
                    <Button label="Close with note" onPress={() => closeWithNote(f)} loading={busy} />
                    <Button label="Log maintenance & close" onPress={() => closeWithMaintenance(f)} loading={busy} />
                    <Button label="Cancel" variant="ghost" onPress={() => { setActiveId(null); setNote(''); }} />
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => { setActiveId(f.id); setNote(''); }} accessibilityRole="button">
                  <Text variant="small" color={t.color.primary}>Resolve</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>

      {/* Closed history */}
      {closed.length > 0 && (
        <Card>
          <Text variant="heading">Closed ({closed.length})</Text>
          {closed.map((f) => (
            <View key={f.id} style={{ paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                <Text style={{ flex: 1 }} muted>{f.name}</Text>
                <StatusBadge level="closed" label="closed" />
              </View>
              {!!f.resolution_notes && <Text variant="small" muted style={{ paddingLeft: t.space.sm }}>{f.resolution_notes}</Text>}
            </View>
          ))}
        </Card>
      )}

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
