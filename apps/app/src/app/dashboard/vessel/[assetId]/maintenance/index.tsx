import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselFault, VesselMaintenanceSchedule, VesselUpcomingItem, VesselScheduleAlert } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselFaults, listVesselSchedules, createVesselSchedule, getVesselUpcoming, createVesselMaintenanceLog, uploadVesselDocument } from '@/lib/api';
import type { FormSchema } from '@blnk/shared';
import { readThrough } from '@/lib/mirror';
import { loadAsset } from '@/lib/vessel-sync';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { StatusBadge, OfflineBanner } from '@/ui/status';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type ThemeT = ReturnType<typeof useTheme>;
const INTERVALS = ['Days', 'Weeks', 'Months', 'Years'];
const UNITS: VesselScheduleAlert['unit'][] = ['hours', 'days', 'weeks'];
const tok = () => getAccessToken()!;

const makePillStyles = (t: ThemeT) => ({
  pill: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
});

const Pill = ({ label, sel, onPress, t }: { label: string; sel: boolean; onPress: () => void; t: ThemeT }) => {
  const pillStyles = makePillStyles(t);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={pillStyles.pill(sel)}>
      <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{label}</Text>
    </Pressable>
  );
};

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  intervalRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  intervalInput: { width: 72 },
  intervalPills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, flex: 1 },
  alertRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  alertBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  addAlertRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  alertInput: { width: 64 },
  scheduleItem: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: t.space.sm, paddingVertical: t.space.sm },
  scheduleInfo: { flex: 1, gap: 2 },
  scheduleAlerts: { gap: t.space.xs, marginTop: 2 },
  scheduleAlertPills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  scheduleActions: { alignItems: 'flex-end' as const, justifyContent: 'space-between' as const, alignSelf: 'stretch' as const, marginLeft: t.space.md },
  scheduleButtons: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  faultLink: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  taskDetailsRow: { flexDirection: 'row' as const, gap: t.space.sm },
  docRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  docChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  docName: { maxWidth: 180 },
  editFormBtn: { alignSelf: 'flex-start' as const },
});

export default function VesselMaintenance() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [schedules, setSchedules] = useState<VesselMaintenanceSchedule[]>([]);
  const [dueById, setDueById] = useState<Record<string, VesselUpcomingItem>>({});
  const [openFaults, setOpenFaults] = useState<VesselFault[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // add-schedule form
  const [task, setTask] = useState('');
  const [intervalType, setIntervalType] = useState('Months');
  const [intervalValue, setIntervalValue] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [alerts, setAlerts] = useState<VesselScheduleAlert[]>([{ value: 7, unit: 'days' }]);
  const [aVal, setAVal] = useState('1');
  const [aUnit, setAUnit] = useState<VesselScheduleAlert['unit']>('days');
  const [docUrls, setDocUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset }, sc, up, faultRes] = await Promise.all([
        loadAsset(assetId),
        readThrough('vessel:schedules:' + assetId, () => listVesselSchedules(tok(), assetId)),
        readThrough('vessel:upcoming:' + assetId, () => getVesselUpcoming(tok(), assetId)),
        readThrough('vessel:faults:' + assetId, () => listVesselFaults(tok(), { asset_id: assetId })),
      ]);
      setAsset(asset); setSchedules(sc.value.schedules);
      setDueById(Object.fromEntries(up.value.items.map((i) => [i.id, i])));
      const URGENCY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      setOpenFaults(
        faultRes.value.faults
          .filter((f) => f.status !== 'closed')
          .sort((a, b) => (URGENCY_ORDER[a.urgency ?? ''] ?? 4) - (URGENCY_ORDER[b.urgency ?? ''] ?? 4)),
      );
      setOffline(sc.stale || up.stale || faultRes.stale);
    } catch (e) { err(e); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const addAlert = () => { const v = Number(aVal); if (v > 0) setAlerts([...alerts, { value: v, unit: aUnit }]); };
  const removeAlert = (i: number) => setAlerts(alerts.filter((_, x) => x !== i));

  const markDone = async (sc: VesselMaintenanceSchedule) => {
    setMarkingId(sc.id); setMsg(null);
    try {
      await createVesselMaintenanceLog(tok(), {
        asset_id: assetId, schedule_id: sc.id, task_name: sc.task_name,
        completed_date: new Date().toISOString().slice(0, 10),
      });
      setMsg({ text: `${sc.task_name} marked complete.`, tone: 'success' });
      await load();
    } catch (e) { err(e); } finally { setMarkingId(null); }
  };

  const pickDocument = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setUploading(true);
      try { const { url } = await uploadVesselDocument(tok(), file); setDocUrls((prev) => [...prev, url]); }
      catch (e) { err(e); } finally { setUploading(false); }
    };
    input.click();
  };

  const saveSchedule = async (opts: { formSchema?: FormSchema } = {}) => {
    if (!task.trim()) { setMsg({ text: 'Task name is required.', tone: 'error' }); return null; }
    setBusy(true); setMsg(null);
    try {
      const { schedule } = await createVesselSchedule(tok(), {
        asset_id: assetId, task_name: task.trim(),
        interval_type: intervalType, interval_value: Number(intervalValue) || 1,
        initial_due_date: dueDate.trim() || undefined, alerts,

        document_urls: docUrls.length ? docUrls : undefined,
        form_schema: opts.formSchema,
      });
      setTask(''); setDueDate(''); setDocUrls([]);
      return schedule;
    } catch (e) { err(e); return null; } finally { setBusy(false); }
  };

  const addSchedule = async () => {
    const sc = await saveSchedule();
    if (sc) { setMsg({ text: 'Schedule added.', tone: 'success' }); await load(); }
  };

  const addScheduleAndBuildForm = async () => {
    const sc = await saveSchedule();
    if (sc) router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance/[scheduleId]/form-builder', params: { assetId, scheduleId: sc.id } });
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Vessel'}</Text>
      </Pressable>
      <Text variant="title">Maintenance</Text>
      {!loading && openFaults.length > 0 && (
        <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/faults', params: { assetId } })} accessibilityRole="link" style={s.faultLink}>
          <Ionicons name="warning-outline" size={14} color={t.color.danger} />
          <Text variant="small" color={t.color.danger}>
            {openFaults.length} open {openFaults.length === 1 ? 'fault' : 'faults'} — tap to view
          </Text>
        </Pressable>
      )}

      <OfflineBanner offline={offline} />

      <Card>
        <View style={s.sectionHeader}>
          <Text variant="heading">Scheduled tasks</Text>
          {schedules.length > 0 && <Text variant="small" muted>{schedules.length}</Text>}
        </View>
        {loading ? <Text muted>Loading…</Text> : schedules.length === 0 ? <Text muted>No scheduled maintenance yet.</Text> : schedules.map((sc) => {
          const due = dueById[sc.id];
          const level = due?.level === 'over' ? 'over' : due?.level === 'due' ? 'due' : 'ok';
          const sub = [`Every ${sc.interval_value ?? ''} ${sc.interval_type ?? ''}`.trim(), due?.due_date ? `Due ${formatDMY(due.due_date)}` : null].filter(Boolean).join(' · ');
          return (
            <View key={sc.id} style={s.scheduleItem}>
              <View style={s.scheduleInfo}>
                <Text>{sc.task_name}</Text>
                <Text variant="small" muted>{sub}</Text>
                {sc.alerts?.length > 0 && (
                  <View style={s.scheduleAlerts}>
                    <Text variant="small" muted>Reminders:</Text>
                    <View style={s.scheduleAlertPills}>
                      {sc.alerts.map((a, i) => <Badge key={i} label={`${a.value} ${a.unit} before`} tone="neutral" />)}
                    </View>
                  </View>
                )}
                {!!sc.task_notes && <Text variant="small" muted>{sc.task_notes}</Text>}
                {sc.document_urls?.length > 0 && (
                  <View style={s.docRow}>
                    {sc.document_urls.map((url, i) => (
                      <Pressable key={i} onPress={() => { if (Platform.OS === 'web') window.open(url, '_blank'); }} accessibilityRole="link" style={s.docChip}>
                        <Ionicons name="document-outline" size={12} color={t.color.primary} />
                        <Text variant="small" color={t.color.primary} numberOfLines={1} style={s.docName}>{url.split('/').pop()}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
              <View style={s.scheduleActions}>
                {due && <StatusBadge level={level} label={due.level === 'over' ? 'Overdue' : due.level === 'due' ? 'Due soon' : 'OK'} />}
                <View style={s.scheduleButtons}>
                  {isAdmin && (
                    <Button
                      label={sc.form_schema ? 'Edit form' : 'Build form'}
                      variant="secondary"
                      onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance/[scheduleId]/form-builder', params: { assetId, scheduleId: sc.id } })}
                    />
                  )}
                  <Button
                    label="Mark as done"
                    variant="secondary"
                    loading={markingId === sc.id}
                    onPress={() =>
                      sc.form_schema?.fields?.length
                        ? router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance/[scheduleId]/complete', params: { assetId, scheduleId: sc.id } })
                        : markDone(sc)
                    }
                  />
                </View>
              </View>
            </View>
          );
        })}
      </Card>

      {isAdmin && (
        <Card>
          <Text variant="heading">Schedule a task</Text>
          <TextField label="Task" value={task} onChangeText={setTask} placeholder="Weekly inspection" autoCapitalize="sentences" />
          <View style={s.section}>
            <Text variant="label" muted>Every</Text>
            <View style={s.intervalRow}>
              <View style={s.intervalInput}><TextField label="" value={intervalValue} onChangeText={setIntervalValue} placeholder="1" keyboardType="number-pad" /></View>
              <View style={s.intervalPills}>
                {INTERVALS.map((iv) => <Pill key={iv} label={iv} sel={intervalType === iv} onPress={() => setIntervalType(iv)} t={t} />)}
              </View>
            </View>
          </View>

          <DateField label="First due date" value={dueDate} onChange={setDueDate} placeholder="Select date" />

          {/* Multiple reminder alerts (e.g. 7 days / 1 day / 1 hour before) */}
          <View style={s.section}>
            <Text variant="label" muted>Alerts before due</Text>
            <View style={s.alertRow}>
              {alerts.length === 0 && <Text variant="small" muted>No alerts.</Text>}
              {alerts.map((a, i) => (
                <Pressable key={i} onPress={() => removeAlert(i)} accessibilityRole="button" accessibilityLabel={`Remove ${a.value} ${a.unit} alert`}
                  style={s.alertBadge}>
                  <Text variant="small">{a.value} {a.unit} before</Text>
                  <Text variant="small" muted>✕</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.addAlertRow}>
              <View style={s.alertInput}><TextField label="" value={aVal} onChangeText={setAVal} placeholder="1" keyboardType="number-pad" /></View>
              {UNITS.map((u) => <Pill key={u} label={u} sel={aUnit === u} onPress={() => setAUnit(u)} t={t} />)}
              <Button label="Add" variant="secondary" onPress={addAlert} />
            </View>
          </View>

          {docUrls.length > 0 && (
            <View style={s.docRow}>
              {docUrls.map((url, i) => (
                <View key={i} style={s.docChip}>
                  <Text variant="small" numberOfLines={1} style={s.docName}>{url.split('/').pop()}</Text>
                  <Pressable onPress={() => setDocUrls((prev) => prev.filter((_, x) => x !== i))} accessibilityRole="button" accessibilityLabel="Remove document">
                    <Text variant="small" muted>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={s.taskDetailsRow}>
            <Button label={uploading ? 'Uploading…' : 'Attach file'} variant="secondary" onPress={pickDocument} disabled={uploading} />
            <Button label="Build form" variant="secondary" onPress={addScheduleAndBuildForm} loading={busy} />
            <Button label="Add schedule" onPress={addSchedule} loading={busy} />
          </View>
        </Card>
      )}

    </Screen>
  );
}
