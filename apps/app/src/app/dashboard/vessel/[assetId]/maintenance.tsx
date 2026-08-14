import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselMaintenanceSchedule, VesselUpcomingItem, VesselScheduleAlert } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselSchedules, createVesselSchedule, getVesselUpcoming } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { loadAsset } from '@/lib/vessel-sync';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge, Notice } from '@/ui/components';
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
  intervalRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  intervalInput: { width: 72 },
  intervalPills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, flex: 1 },
  alertRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  alertBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  addAlertRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  alertInput: { width: 64 },
  scheduleItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border },
  scheduleInfo: { flex: 1, gap: 2 },
  scheduleAlerts: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs, marginTop: 2 },
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
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  // add-schedule form
  const [task, setTask] = useState('');
  const [intervalType, setIntervalType] = useState('Months');
  const [intervalValue, setIntervalValue] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [alerts, setAlerts] = useState<VesselScheduleAlert[]>([{ value: 7, unit: 'days' }]);
  const [aVal, setAVal] = useState('1');
  const [aUnit, setAUnit] = useState<VesselScheduleAlert['unit']>('days');

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset }, sc, up] = await Promise.all([
        loadAsset(assetId),
        readThrough('vessel:schedules:' + assetId, () => listVesselSchedules(tok(), assetId)),
        readThrough('vessel:upcoming:' + assetId, () => getVesselUpcoming(tok(), assetId)),
      ]);
      setAsset(asset); setSchedules(sc.value.schedules);
      setDueById(Object.fromEntries(up.value.items.map((i) => [i.id, i])));
      setOffline(sc.stale || up.stale);
    } catch (e) { err(e); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const addAlert = () => { const v = Number(aVal); if (v > 0) setAlerts([...alerts, { value: v, unit: aUnit }]); };
  const removeAlert = (i: number) => setAlerts(alerts.filter((_, x) => x !== i));

  const addSchedule = async () => {
    if (!task.trim()) { setMsg({ text: 'Task name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createVesselSchedule(tok(), {
        asset_id: assetId, task_name: task.trim(),
        interval_type: intervalType, interval_value: Number(intervalValue) || 1,
        initial_due_date: dueDate.trim() || undefined, alerts,
      });
      setTask(''); setDueDate('');
      setMsg({ text: 'Schedule added.', tone: 'success' });
      await load();
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Vessel'}</Text>
      </Pressable>
      <Text variant="title">Maintenance</Text>

      <OfflineBanner offline={offline} />

      {isAdmin && (
        <Card>
          <Text variant="heading">Add a scheduled task</Text>
          <TextField label="Task" value={task} onChangeText={setTask} placeholder="e.g. Hull inspection" autoCapitalize="sentences" />
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

          <Button label="Add schedule" onPress={addSchedule} loading={busy} />
        </Card>
      )}

      <Card>
        <Text variant="heading">Scheduled tasks {schedules.length ? `(${schedules.length})` : ''}</Text>
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
                    {sc.alerts.map((a, i) => <Badge key={i} label={`${a.value} ${a.unit}`} tone="neutral" />)}
                  </View>
                )}
              </View>
              {due && <StatusBadge level={level} label={due.level === 'over' ? 'Overdue' : due.level === 'due' ? 'Due soon' : 'OK'} />}
            </View>
          );
        })}
      </Card>

      <Card>
        <Text muted>To record completed work, resolve a fault from the Faults section — that logs maintenance against it. A dedicated &quot;complete scheduled task&quot; flow lands in a later step.</Text>
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
