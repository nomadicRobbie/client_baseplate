import { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, RequiredRole } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { createService, createServiceTemplate, generateServiceInstances, listAssets } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/ui/components';
import { DateTimeField } from '@/ui/datetime-field';
import { SelectField } from '@/ui/select-field';
import { WeekdayRecurrencePicker, type RecurrenceValue } from '@/ui/weekday-recurrence-picker';

// ponytail: UUIDv4 — sufficient for offline-safe IDs here
function uuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function localISOString(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function addDays(date: string, n: number): string {
  return new Date(new Date(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  field: { gap: t.space.xs },
  input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  inputError: { borderColor: t.color.danger },
  divider: { height: 1, backgroundColor: t.color.border, marginVertical: t.space.xs },
  toggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  roleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  roleChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.xs,
    backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill,
    paddingHorizontal: t.space.md, paddingVertical: t.space.xs,
  },
  roleInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  roleNameInput: { flex: 1, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.sm, color: t.color.text, fontSize: 14 },
  roleCountInput: { width: 48, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.sm, color: t.color.text, fontSize: 14, textAlign: 'center' as const },
});

export default function AddServiceScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);

  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState(localISOString());
  const [duration, setDuration] = useState('240');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [repeats, setRepeats] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceValue>({
    days: [], time: '09:00', startDate: todayStr(), endDate: null,
  });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [roles, setRoles] = useState<RequiredRole[]>([]);
  const [newRole, setNewRole] = useState('');
  const [newRoleCount, setNewRoleCount] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    listAssets(getAccessToken()!).then(r => setAssets(r.assets)).catch(() => {});
  }, []);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const clearErr = (...keys: string[]) =>
    setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))));

  const addRole = () => {
    const r = newRole.trim();
    if (!r) return;
    const c = Math.max(1, parseInt(newRoleCount, 10) || 1);
    const existing = roles.find(x => x.role.toLowerCase() === r.toLowerCase());
    if (existing) {
      setRoles(roles.map(x => x === existing ? { ...x, count: x.count + c } : x));
    } else {
      setRoles([...roles, { role: r, count: c }]);
    }
    setNewRole('');
    setNewRoleCount('1');
  };

  const removeRole = (idx: number) => setRoles(roles.filter((_, i) => i !== idx));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!duration || isNaN(Number(duration)) || Number(duration) < 1) e.duration = 'Must be a positive number';
    if (!repeats) {
      if (!startsAt) e.startsAt = 'Start time is required';
    } else {
      if (recurrence.days.length === 0) e.days = 'Select at least one day';
      if (!recurrence.startDate) e.startDate = 'Start date is required';
      if (recurrence.endDate !== null && !recurrence.endDate) e.endDate = 'Pick an end date or set indefinite';
    }
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true); setMsg(null);
    try {
      const tok = getAccessToken()!;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const durationMin = Number(duration);

      if (!repeats) {
        const start = new Date(startsAt);
        const end = new Date(start.getTime() + durationMin * 60_000);
        const r = await createService(tok, {
          id: uuid4(),
          name: name.trim(),
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          timezone: tz,
          location_label: location.trim() || null,
          notes: notes.trim(),
          status: 'planned',
          asset_id: assetId,
          required_roles: roles,
        });
        router.replace({ pathname: '/dashboard/schedule/[serviceId]', params: { serviceId: r.service.id } });
      } else {
        const tmpl = await createServiceTemplate(tok, {
          name: name.trim(),
          duration_minutes: durationMin,
          default_capacity: 0,
          location_label: location.trim() || null,
          timezone: tz,
          required_roles: roles,
          required_asset_types: [],
          default_asset_id: assetId,
          recurrence: {
            days: recurrence.days,
            time: recurrence.time,
            startDate: recurrence.startDate,
            endDate: recurrence.endDate,
          },
          active: true,
        });
        const from = recurrence.startDate;
        const to = recurrence.endDate ?? addDays(from, 365);
        await generateServiceInstances(tok, tmpl.template.id, from, to);
        router.replace('/dashboard/schedule');
      }
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Schedule</Text>
      </Pressable>

      <Text variant="title">Add to schedule</Text>

      {/* Name */}
      <View style={s.field}>
        <Text variant="label">Name</Text>
        <TextInput
          value={name}
          onChangeText={v => { setName(v); clearErr('name'); }}
          placeholder="e.g. Morning dive charter"
          placeholderTextColor={t.color.textMuted}
          style={[s.input, errors.name ? s.inputError : undefined]}
        />
        {errors.name ? <Text variant="small" color={t.color.danger}>{errors.name}</Text> : null}
      </View>

      {/* Start time — one-off only */}
      {!repeats && (
        <DateTimeField
          label="Starts"
          value={startsAt}
          onChange={v => { setStartsAt(v); clearErr('startsAt'); }}
          error={errors.startsAt}
        />
      )}

      {/* Duration */}
      <View style={s.field}>
        <Text variant="label">Duration (minutes)</Text>
        <TextInput
          value={duration}
          onChangeText={v => { setDuration(v); clearErr('duration'); }}
          keyboardType="numeric"
          placeholderTextColor={t.color.textMuted}
          style={[s.input, errors.duration ? s.inputError : undefined]}
        />
        {errors.duration ? <Text variant="small" color={t.color.danger}>{errors.duration}</Text> : null}
      </View>

      {/* Location */}
      <View style={s.field}>
        <Text variant="label">Location (optional)</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="e.g. Pier 4, Westhaven"
          placeholderTextColor={t.color.textMuted}
          style={s.input}
        />
      </View>

      {/* Notes */}
      <View style={s.field}>
        <Text variant="label">Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any notes for the crew…"
          placeholderTextColor={t.color.textMuted}
          multiline
          style={[s.input, { minHeight: 72, textAlignVertical: 'top' }]}
        />
      </View>

      {/* Asset */}
      {assets.length > 0 && (
        <SelectField
          label="Asset (optional)"
          value={assetId}
          onChange={setAssetId}
          placeholder="None"
          options={assets.map(a => ({ label: a.name, value: a.id }))}
        />
      )}

      {/* Required roles */}
      <View style={s.field}>
        <Text variant="label">Required crew (optional)</Text>
        {roles.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs }}>
            {roles.map((r, i) => (
              <Pressable key={i} onPress={() => removeRole(i)} style={s.roleChip} accessibilityRole="button">
                <Text variant="small">{r.count}x {r.role}</Text>
                <Ionicons name="close" size={14} color={t.color.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
        <View style={s.roleInputRow}>
          <TextInput
            value={newRole}
            onChangeText={setNewRole}
            placeholder="e.g. Skipper"
            placeholderTextColor={t.color.textMuted}
            style={s.roleNameInput}
            onSubmitEditing={addRole}
          />
          <TextInput
            value={newRoleCount}
            onChangeText={setNewRoleCount}
            keyboardType="numeric"
            placeholderTextColor={t.color.textMuted}
            style={s.roleCountInput}
          />
          <Pressable onPress={addRole} accessibilityRole="button" accessibilityLabel="Add role">
            <Ionicons name="add-circle-outline" size={24} color={t.color.primary} />
          </Pressable>
        </View>
      </View>

      <View style={s.divider} />

      {/* Repeats toggle */}
      <Pressable
        onPress={() => setRepeats(v => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: repeats }}
        style={s.toggle}
      >
        <Ionicons
          name={repeats ? 'repeat' : 'repeat-outline'}
          size={20}
          color={repeats ? t.color.primary : t.color.textMuted}
        />
        <Text variant="label" color={repeats ? t.color.primary : t.color.text}>Repeating event</Text>
      </Pressable>

      {repeats && (
        <WeekdayRecurrencePicker
          value={recurrence}
          onChange={v => { setRecurrence(v); clearErr('days', 'startDate', 'endDate'); }}
          errors={errors}
        />
      )}

      <Button label="Add to schedule" onPress={save} loading={saving} />
    </Screen>
  );
}
