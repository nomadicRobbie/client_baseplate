import { useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { createService, createServiceTemplate, generateServiceInstances } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/ui/components';
import { DateTimeField } from '@/ui/datetime-field';
import { WeekdayRecurrencePicker, type RecurrenceValue } from '@/ui/weekday-recurrence-picker';
import { localDate } from '@/lib/format';

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

function addDays(date: string, n: number): string {
  return localDate(new Date(new Date(date).getTime() + n * 86_400_000));
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
    days: [], time: '09:00', startDate: localDate(), endDate: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const clearErr = (...keys: string[]) =>
    setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))));

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
        });
        router.replace({ pathname: '/dashboard/schedule/[serviceId]', params: { serviceId: r.service.id } });
      } else {
        const tmpl = await createServiceTemplate(tok, {
          name: name.trim(),
          duration_minutes: durationMin,
          default_capacity: 0,
          location_label: location.trim() || null,
          timezone: tz,
          required_roles: [],
          required_asset_types: [],
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
