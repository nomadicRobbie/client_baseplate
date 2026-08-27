import { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetFault } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAssetFaults } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { enqueue, pending as pendingCommands, pendingCount } from '@/lib/outbox';
import { syncAssetOutbox, loadAsset } from '@/lib/asset-sync';
import { useOnReconnect } from '@/lib/use-reconnect';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel, Button, FieldRow, Badge } from '@/ui/components';
import { StatusBadge, urgencyLevel, OfflineBanner, PendingSyncBanner } from '@/ui/status';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  input: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 8 },
  emptyHint: { paddingHorizontal: 4 },
  flex1: { flex: 1 },
  resolveIndent: { paddingLeft: t.space.sm },
  urgencyGroup: { gap: 6 },
  urgencyRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  urgencyBtn: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  pendingInfo: { flex: 1, gap: 2 },
  faultRow: { borderBottomWidth: 1, borderColor: t.color.border, paddingHorizontal: t.space.lg, paddingVertical: 10, gap: t.space.sm },
  faultRowLast: { borderBottomWidth: 0 },
  faultHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  faultInfo: { flex: 1, gap: 2 },
  faultFooter: { alignItems: 'flex-end' as const },
  stepsList: { gap: 2, paddingLeft: t.space.sm },
  actions: { gap: t.space.sm },
  actionRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
});

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const tok = () => getAccessToken()!;

export default function AssetFaults() {
  const t = useTheme();
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features } = useAuth();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [faults, setFaults] = useState<AssetFault[]>([]);
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
      const r = await readThrough('asset:faults:' + assetId, () => listAssetFaults(tok(), { asset_id: assetId }));
      setFaults(r.value.faults); setOffline(r.stale);
    } catch (e) { err(e); }
  };
  const doSync = async (): Promise<number> => {
    const { remaining } = await syncAssetOutbox();
    setPending(remaining);
    await loadFaults();
    return remaining;
  };
  useEffect(() => {
    void (async () => { const { asset } = await loadAsset(assetId); setAsset(asset); })();
    void loadFaults(); void doSync();
  }, [assetId]);
  useOnReconnect(() => { void doSync(); });

  if (features && !features.asset) return <Redirect href="/dashboard" />;

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
  const addStep = async (f: AssetFault) => {
    if (!note.trim()) { setMsg({ text: 'Add a note for the step.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('AddFaultStep', { fault_id: f.id, note: note.trim() });
    setNote(''); setPending(pendingCount());
    try { queued(await doSync(), 'Step recorded.'); } finally { setBusy(false); }
  };
  // Close with just a note — no maintenance record required.
  const closeWithNote = async (f: AssetFault) => {
    if (!note.trim()) { setMsg({ text: 'Add a closing note.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    enqueue('CloseFault', { fault_id: f.id, resolution_notes: note.trim() });
    setNote(''); setActiveId(null); setPending(pendingCount());
    try { queued(await doSync(), 'Fault closed.'); } finally { setBusy(false); }
  };
  const open = faults.filter((f) => f.status !== 'closed');
  const closed = faults.filter((f) => f.status === 'closed');
  const pendingLogged = pendingCommands()
    .filter((c) => c.kind === 'LogFault' && (c.payload as { asset_id: string }).asset_id === assetId)
    .map((c) => ({ key: c.key, ...(c.payload as { name: string; description?: string; urgency?: string }) }));
  const pendingCloseIds = new Set(
    pendingCommands().filter((c) => c.kind === 'CloseFault')
      .map((c) => (c.payload as { fault_id?: string }).fault_id).filter((id): id is string => !!id),
  );
  const pendingStepsByFault: Record<string, string[]> = {};
  for (const c of pendingCommands()) if (c.kind === 'AddFaultStep') {
    const p = c.payload as { fault_id: string; note: string };
    (pendingStepsByFault[p.fault_id] ??= []).push(p.note);
  }

  const s = makeStyles(t);

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Asset'}</Text>
      </Pressable>
      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => void doSync()} busy={busy} />

      <View style={s.section}>
        <SectionLabel>Log a fault</SectionLabel>
        <GroupedCard>
          <FieldRow label="Fault" displayValue={fName}>
            <TextInput value={fName} onChangeText={setFName} placeholder="Fault name"
              autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
          </FieldRow>
          <FieldRow label="Description" displayValue={fDesc} last>
            <TextInput value={fDesc} onChangeText={setFDesc} placeholder="Optional"
              autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
          </FieldRow>
        </GroupedCard>
        <View style={s.urgencyGroup}>
          <Text variant="label" muted>Urgency</Text>
          <View style={s.urgencyRow}>
            {URGENCIES.map((u) => {
              const sel = fUrgency === u;
              return (
                <Pressable key={u} onPress={() => setFUrgency(u)} accessibilityRole="button"
                  style={s.urgencyBtn(sel)}>
                  <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{u}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Button label="Log fault" onPress={logFault} loading={busy} />
      </View>

      <View style={s.section}>
        <SectionLabel right={open.length + pendingLogged.length > 0 ? <Text variant="small" muted>{open.length + pendingLogged.length}</Text> : undefined}>Open faults</SectionLabel>
        {open.length === 0 && pendingLogged.length === 0
          ? <Text muted style={s.emptyHint}>No open faults.</Text>
          : (
            <GroupedCard>
              {pendingLogged.map((p, i) => (
                <GRow key={p.key} last={i === pendingLogged.length - 1 && open.length === 0}>
                  <View style={s.pendingInfo}>
                    <Text>{p.name}</Text>
                    {!!p.description && <Text variant="small" muted>{p.description}</Text>}
                  </View>
                  {!!p.urgency && <StatusBadge level={urgencyLevel(p.urgency)} label={p.urgency} />}
                  <Badge label="pending sync" tone="accent" />
                </GRow>
              ))}
              {open.map((f, i) => {
                const expanded = activeId === f.id;
                const closing = pendingCloseIds.has(f.id);
                const pSteps = pendingStepsByFault[f.id] ?? [];
                return (
                  <View key={f.id} style={[s.faultRow, i === open.length - 1 && s.faultRowLast]}>
                    <View style={s.faultHeader}>
                      <View style={s.faultInfo}>
                        <Text>{f.name}</Text>
                        {!!f.description && <Text variant="small" muted>{f.description}</Text>}
                      </View>
                      {!!f.urgency && <StatusBadge level={urgencyLevel(f.urgency)} label={f.urgency} />}
                    </View>

                    {(f.steps?.length > 0 || pSteps.length > 0) && (
                      <View style={s.stepsList}>
                        {f.steps.map((st) => (
                          <Text key={st.id} variant="small" muted>• {st.note}{st.kind === 'close' ? ' (closed)' : ''} · {formatDMY(st.created_at)}</Text>
                        ))}
                        {pSteps.map((n, j) => <Text key={`p${j}`} variant="small" muted>• {n} · pending sync</Text>)}
                      </View>
                    )}

                    {expanded ? (
                      <View style={s.actions}>
                        <TextInput value={note} onChangeText={setNote} placeholder="Note — what was done, or the next step"
                          autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
                        <View style={s.actionRow}>
                          <Button label="Add step" variant="secondary" onPress={() => addStep(f)} loading={busy} />
                          <Button label="Close with note" onPress={() => closeWithNote(f)} loading={busy} />
                          <Button label="Cancel" variant="ghost" onPress={() => { setActiveId(null); setNote(''); }} />
                        </View>
                      </View>
                    ) : (
                      <View style={s.faultFooter}>
                        {closing
                          ? <Badge label="closing — pending sync" tone="accent" />
                          : <Button label="Update" variant="secondary" onPress={() => { setActiveId(f.id); setNote(''); }} />}
                      </View>
                    )}
                  </View>
                );
              })}
            </GroupedCard>
          )}
      </View>

      {closed.length > 0 && (
        <View style={s.section}>
          <SectionLabel right={<Text variant="small" muted>{closed.length}</Text>}>Closed</SectionLabel>
          <GroupedCard>
            {closed.map((f, i) => (
              <View key={f.id} style={[s.faultRow, i === closed.length - 1 && s.faultRowLast]}>
                <View style={s.faultHeader}>
                  <Text style={s.flex1} muted>{f.name}</Text>
                  <StatusBadge level="closed" label="closed" />
                </View>
                {!!f.resolution_notes && <Text variant="small" muted style={s.resolveIndent}>{f.resolution_notes}</Text>}
              </View>
            ))}
          </GroupedCard>
        </View>
      )}

    </Screen>
  );
}
