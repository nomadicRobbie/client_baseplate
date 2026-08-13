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
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fUrgency, setFUrgency] = useState('Medium');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rNotes, setRNotes] = useState('');

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

  // Offline-first: queue, then try to sync. Stays queued and replays if unreachable.
  const logFault = async () => {
    if (!fName.trim()) { setMsg({ text: 'Fault name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('LogFault', { asset_id: assetId, name: fName.trim(), description: fDesc.trim() || undefined, urgency: fUrgency });
    setFName(''); setFDesc(''); setFUrgency('Medium'); setPending(pendingCount());
    try {
      const remaining = await doSync();
      setMsg(remaining === 0 ? { text: 'Fault logged.', tone: 'success' } : { text: `Queued offline — ${remaining} waiting to sync.`, tone: 'info' });
    } finally { setBusy(false); }
  };
  const resolveFault = async (f: VesselFault) => {
    setBusy(true); setMsg(null);
    enqueue('CompleteMaintenance', { asset_id: assetId, fault_id: f.id, resolves_fault: true, task_name: rNotes.trim() || 'Repair', completed_date: today() });
    setResolvingId(null); setRNotes(''); setPending(pendingCount());
    try {
      const remaining = await doSync();
      setMsg(remaining === 0 ? { text: 'Maintenance logged — fault closed.', tone: 'success' } : { text: `Queued offline — ${remaining} waiting to sync.`, tone: 'info' });
    } finally { setBusy(false); }
  };

  const open = faults.filter((f) => f.status !== 'closed');
  const closed = faults.filter((f) => f.status === 'closed');
  const pendingLogged = pendingCommands()
    .filter((c) => c.kind === 'LogFault' && (c.payload as { asset_id: string }).asset_id === assetId)
    .map((c) => ({ key: c.key, ...(c.payload as { name: string; description?: string; urgency?: string }) }));
  const pendingResolveIds = new Set(
    pendingCommands().filter((c) => c.kind === 'CompleteMaintenance')
      .map((c) => (c.payload as { fault_id?: string }).fault_id).filter((id): id is string => !!id),
  );

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
        {open.length === 0 && pendingLogged.length === 0 ? <Text muted>No open faults.</Text> : open.map((f) => (
          <View key={f.id} style={{ paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, gap: t.space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text>{f.name}</Text>
                {!!f.description && <Text variant="small" muted>{f.description}</Text>}
              </View>
              {!!f.urgency && <StatusBadge level={urgencyLevel(f.urgency)} label={f.urgency} />}
            </View>
            {pendingResolveIds.has(f.id) ? (
              <View style={{ flexDirection: 'row' }}><Badge label="resolving — pending sync" tone="accent" /></View>
            ) : resolvingId === f.id ? (
              <View style={{ gap: t.space.sm }}>
                <TextField label="What was done" value={rNotes} onChangeText={setRNotes} placeholder="Maintenance carried out" autoCapitalize="sentences" />
                <View style={{ flexDirection: 'row', gap: t.space.sm }}>
                  <Button label="Log maintenance & close" onPress={() => resolveFault(f)} loading={busy} />
                  <Button label="Cancel" variant="ghost" onPress={() => { setResolvingId(null); setRNotes(''); }} />
                </View>
              </View>
            ) : (
              <Pressable onPress={() => { setResolvingId(f.id); setRNotes(''); }} accessibilityRole="button">
                <Text variant="small" color={t.color.primary}>Resolve (log maintenance)</Text>
              </Pressable>
            )}
          </View>
        ))}
      </Card>

      {/* Closed history */}
      {closed.length > 0 && (
        <Card>
          <Text variant="heading">Closed ({closed.length})</Text>
          {closed.map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border }}>
              <Text style={{ flex: 1 }} muted>{f.name}</Text>
              <StatusBadge level="closed" label="closed" />
            </View>
          ))}
        </Card>
      )}

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
