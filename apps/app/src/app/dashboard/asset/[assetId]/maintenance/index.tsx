import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetFault, AssetMaintenanceSchedule, AssetUpcomingItem, AssetScheduleAlert } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAssetFaults, listAssetSchedules, createAssetSchedule, getAssetUpcoming, createAssetMaintenanceLog, uploadAssetDocument } from '@/lib/api';
import type { FormSchema } from '@blnk/shared';
import { readThrough } from '@/lib/mirror';
import { loadAsset } from '@/lib/asset-sync';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge, Pill, Stepper, Toggle } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { StatusBadge, OfflineBanner } from '@/ui/status';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type ThemeT = ReturnType<typeof useTheme>;
const INTERVALS = ['Day', 'Week', 'Month', 'Year'];
const tok = () => getAccessToken()!;


const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  intervalRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  intervalPills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, flex: 1 },
  alertRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  alertBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  addAlertRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  dropZone: { borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.lg, alignItems: 'center' as const, gap: t.space.xs },
  docEntry: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingVertical: 4 },
  flex1: { flex: 1 },
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

export default function AssetMaintenance() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<Asset | null>(null);
  const [schedules, setSchedules] = useState<AssetMaintenanceSchedule[]>([]);
  const [dueById, setDueById] = useState<Record<string, AssetUpcomingItem>>({});
  const [openFaults, setOpenFaults] = useState<AssetFault[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // add-schedule form
  const [task, setTask] = useState('');
  const [intervalType, setIntervalType] = useState('Month');
  const [intervalValue, setIntervalValue] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [alerts, setAlerts] = useState<AssetScheduleAlert[]>([{ value: 7, unit: 'days' }]);
  const [aVal, setAVal] = useState('1');
  const [notifyManager, setNotifyManager] = useState(false);
  const [docUrls, setDocUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset }, sc, up, faultRes] = await Promise.all([
        loadAsset(assetId),
        readThrough('asset:schedules:' + assetId, () => listAssetSchedules(tok(), assetId)),
        readThrough('asset:upcoming:' + assetId, () => getAssetUpcoming(tok(), assetId)),
        readThrough('asset:faults:' + assetId, () => listAssetFaults(tok(), { asset_id: assetId })),
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

  if (features && !features.asset) return <Redirect href="/dashboard" />;

  const addAlert = () => { const v = Number(aVal); if (v > 0) setAlerts([...alerts, { value: v, unit: 'days' }]); };
  const removeAlert = (i: number) => setAlerts(alerts.filter((_, x) => x !== i));

  const markDone = async (sc: AssetMaintenanceSchedule) => {
    setMarkingId(sc.id); setMsg(null);
    try {
      await createAssetMaintenanceLog(tok(), {
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
      try { const { url } = await uploadAssetDocument(tok(), file); setDocUrls((prev) => [...prev, url]); }
      catch (e) { err(e); } finally { setUploading(false); }
    };
    input.click();
  };

  const saveSchedule = async (opts: { formSchema?: FormSchema } = {}) => {
    if (!task.trim()) { setMsg({ text: 'Task name is required.', tone: 'error' }); return null; }
    setBusy(true); setMsg(null);
    try {
      const { schedule } = await createAssetSchedule(tok(), {
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
    if (sc) router.push({ pathname: '/dashboard/asset/[assetId]/maintenance/[scheduleId]/form-builder', params: { assetId, scheduleId: sc.id } });
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Asset'}</Text>
      </Pressable>
      <Text variant="title">Maintenance</Text>
      {!loading && openFaults.length > 0 && (
        <Pressable onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/faults', params: { assetId } })} accessibilityRole="link" style={s.faultLink}>
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
                      onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/maintenance/[scheduleId]/form-builder', params: { assetId, scheduleId: sc.id } })}
                    />
                  )}
                  <Button
                    label="Mark as done"
                    variant="secondary"
                    loading={markingId === sc.id}
                    onPress={() =>
                      sc.form_schema?.fields?.length
                        ? router.push({ pathname: '/dashboard/asset/[assetId]/maintenance/[scheduleId]/complete', params: { assetId, scheduleId: sc.id } })
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
        <>
          <Card>
            <Text variant="heading">Schedule a task</Text>
            <TextField label="Asset name" value={task} onChangeText={setTask} placeholder="Weekly inspection" autoCapitalize="sentences" />

            <View style={s.section}>
              <Text variant="label" muted>Repeat every *</Text>
              <View style={s.intervalPills}>
                {INTERVALS.map((iv) => <Pill key={iv} label={iv} active={intervalType === iv} onPress={() => setIntervalType(iv)} />)}
              </View>
              {intervalType === 'Day' && (
                <View style={s.addAlertRow}>
                  <Text variant="label" muted style={s.flex1}>Custom interval (days)</Text>
                  <Stepper value={Number(intervalValue) || 1} onChange={(v) => setIntervalValue(String(v))} min={1} />
                </View>
              )}
            </View>

            <DateField label="Starts *" value={dueDate} onChange={setDueDate} placeholder="Select date" />

            <View style={s.section}>
              <Text variant="label" muted>Alerts</Text>
              {alerts.length > 0 && (
                <View style={s.alertRow}>
                  {alerts.map((a, i) => (
                    <Pressable key={i} onPress={() => removeAlert(i)} accessibilityRole="button"
                      accessibilityLabel={`Remove ${a.value} ${a.unit} alert`} style={s.alertBadge}>
                      <Text variant="small">{a.value} {a.unit} before</Text>
                      <Text variant="small" muted>✕</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={s.addAlertRow}>
                <Text variant="label" muted style={s.flex1}>Days before due</Text>
                <Stepper value={Number(aVal) || 1} onChange={(v) => setAVal(String(v))} min={1} />
              </View>
              <Button label="+ Add alert condition" variant="ghost" onPress={addAlert} />
              <Toggle value={notifyManager} onChange={setNotifyManager} label="Also notify manager" />
            </View>
          </Card>

          <Card>
            <Text variant="heading">Documents</Text>
            {docUrls.map((url, i) => (
              <View key={i} style={s.docEntry}>
                <Ionicons name="document-outline" size={18} color={t.color.primary} />
                <Text variant="small" numberOfLines={1} style={s.flex1}>{url.split('/').pop()}</Text>
                <Pressable onPress={() => setDocUrls((prev) => prev.filter((_, x) => x !== i))}
                  accessibilityRole="button" accessibilityLabel="Remove document">
                  <Ionicons name="close" size={18} color={t.color.textMuted} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={pickDocument} style={s.dropZone} accessibilityRole="button"
              disabled={uploading}>
              <Ionicons name="cloud-upload-outline" size={28} color={t.color.textMuted} />
              <View style={s.alertRow}>
                <Text variant="small" muted>Drop photos or</Text>
                <Text variant="small" color={t.color.primary}>{uploading ? 'Uploading…' : 'browse'}</Text>
              </View>
            </Pressable>
          </Card>

          <View style={s.taskDetailsRow}>
            <Button label="Build form" variant="secondary" onPress={addScheduleAndBuildForm} loading={busy} style={s.flex1} />
            <Button label="Create schedule" onPress={addSchedule} loading={busy} style={s.flex1} />
          </View>
        </>
      )}

    </Screen>
  );
}
