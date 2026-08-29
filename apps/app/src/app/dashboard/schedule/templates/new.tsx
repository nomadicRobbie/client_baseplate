import { useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { createServiceTemplate } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button, Badge } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const DAYS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
];

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  field: { gap: t.space.xs },
  input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  row: { flexDirection: 'row' as const, gap: t.space.sm },
  flex1: { flex: 1 },
  dayRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  dayBtn: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  sectionHead: { marginTop: t.space.sm },
});

export default function NewTemplateScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);

  const [name, setName] = useState('');
  const [duration, setDuration] = useState('240');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('0');
  // Recurrence
  const [useRecurrence, setUseRecurrence] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('09:00');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const toggleDay = (d: number) => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!duration || isNaN(Number(duration)) || Number(duration) < 1) e.duration = 'Must be a positive number';
    if (!timezone.trim()) e.timezone = 'Timezone is required';
    if (useRecurrence && days.length === 0) e.days = 'Select at least one day';
    if (useRecurrence && !time.match(/^\d{2}:\d{2}$/)) e.time = 'Use HH:MM format';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true); setMsg(null);
    try {
      await createServiceTemplate(getAccessToken()!, {
        name: name.trim(),
        duration_minutes: Number(duration),
        default_capacity: Number(capacity) || 0,
        location_label: location.trim() || null,
        timezone: timezone.trim(),
        required_roles: [],
        required_asset_types: [],
        recurrence: useRecurrence ? { days: days.sort((a, b) => a - b), time } : null,
        active: true,
      });
      router.back();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Templates</Text>
      </Pressable>

      <Text variant="title">New template</Text>

      <View style={s.field}>
        <Text variant="label">Name</Text>
        <TextInput
          value={name}
          onChangeText={v => { setName(v); setErrors(prev => ({ ...prev, name: '' })); }}
          placeholder="e.g. Morning dive charter"
          placeholderTextColor={t.color.textMuted}
          style={[s.input, errors.name ? { borderColor: t.color.danger } : undefined]}
        />
        {errors.name ? <Text variant="small" color={t.color.danger}>{errors.name}</Text> : null}
      </View>

      <View style={s.row}>
        <View style={[s.field, s.flex1]}>
          <Text variant="label">Duration (minutes)</Text>
          <TextInput
            value={duration}
            onChangeText={v => { setDuration(v); setErrors(prev => ({ ...prev, duration: '' })); }}
            keyboardType="numeric"
            placeholderTextColor={t.color.textMuted}
            style={[s.input, errors.duration ? { borderColor: t.color.danger } : undefined]}
          />
          {errors.duration ? <Text variant="small" color={t.color.danger}>{errors.duration}</Text> : null}
        </View>

        <View style={[s.field, s.flex1]}>
          <Text variant="label">Default capacity</Text>
          <TextInput
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="numeric"
            placeholderTextColor={t.color.textMuted}
            style={s.input}
          />
        </View>
      </View>

      <View style={s.field}>
        <Text variant="label">Timezone</Text>
        <TextInput
          value={timezone}
          onChangeText={v => { setTimezone(v); setErrors(prev => ({ ...prev, timezone: '' })); }}
          placeholder="e.g. Pacific/Auckland"
          placeholderTextColor={t.color.textMuted}
          style={[s.input, errors.timezone ? { borderColor: t.color.danger } : undefined]}
        />
        {errors.timezone ? <Text variant="small" color={t.color.danger}>{errors.timezone}</Text> : null}
      </View>

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

      {/* Recurrence toggle */}
      <View style={s.sectionHead}>
        <Pressable
          onPress={() => setUseRecurrence(v => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: useRecurrence }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}
        >
          <Ionicons
            name={useRecurrence ? 'checkbox' : 'square-outline'}
            size={20}
            color={useRecurrence ? t.color.primary : t.color.textMuted}
          />
          <Text variant="label">Recurring schedule</Text>
        </Pressable>
      </View>

      {useRecurrence && (
        <>
          <View style={s.field}>
            <Text variant="label">Repeat on</Text>
            <View style={s.dayRow}>
              {DAYS.map(d => (
                <Pressable
                  key={d.value}
                  onPress={() => { toggleDay(d.value); setErrors(prev => ({ ...prev, days: '' })); }}
                  style={s.dayBtn(days.includes(d.value))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: days.includes(d.value) }}
                >
                  <Text variant="small" color={days.includes(d.value) ? t.color.bg : t.color.text}>
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {errors.days ? <Text variant="small" color={t.color.danger}>{errors.days}</Text> : null}
          </View>

          <View style={s.field}>
            <Text variant="label">Start time (HH:MM)</Text>
            <TextInput
              value={time}
              onChangeText={v => { setTime(v); setErrors(prev => ({ ...prev, time: '' })); }}
              placeholder="09:00"
              placeholderTextColor={t.color.textMuted}
              style={[s.input, errors.time ? { borderColor: t.color.danger } : undefined]}
            />
            {errors.time ? <Text variant="small" color={t.color.danger}>{errors.time}</Text> : null}
          </View>
        </>
      )}

      <Button label="Create template" onPress={save} loading={saving} />
    </Screen>
  );
}
