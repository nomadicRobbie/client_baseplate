import { useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { createService } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/ui/components';
import { DateTimeField } from '@/ui/datetime-field';

// ponytail: UUIDv4 — sufficient for offline-safe IDs here; UUIDv7 adds no value without a batch sync layer
function uuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  field: { gap: t.space.xs },
  input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  row: { flexDirection: 'row' as const, gap: t.space.sm },
  flex1: { flex: 1 },
});

function localISOString(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addHours(iso: string, h: number): string {
  const d = new Date(iso);
  d.setHours(d.getHours() + h);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function NewServiceScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);

  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState(localISOString());
  const [endsAt, setEndsAt] = useState(addHours(localISOString(), 4));
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!startsAt) e.startsAt = 'Start time is required';
    if (!endsAt) e.endsAt = 'End time is required';
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) e.endsAt = 'Must be after start';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true); setMsg(null);
    try {
      const tok = getAccessToken()!;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await createService(tok, {
        id: uuid4(),
        name: name.trim(),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        timezone: tz,
        location_label: location.trim() || null,
        notes: notes.trim(),
        status: 'planned',
      });
      router.replace({ pathname: '/dashboard/schedule/[serviceId]', params: { serviceId: r.service.id } });
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
        <Text variant="small" color={t.color.primary}>Schedule</Text>
      </Pressable>

      <Text variant="title">New service</Text>

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
        <View style={s.flex1}>
          <DateTimeField
            label="Starts"
            value={startsAt}
            onChange={v => { setStartsAt(v); setErrors(prev => ({ ...prev, startsAt: '' })); }}
            error={errors.startsAt}
          />
        </View>
        <View style={s.flex1}>
          <DateTimeField
            label="Ends"
            value={endsAt}
            onChange={v => { setEndsAt(v); setErrors(prev => ({ ...prev, endsAt: '' })); }}
            error={errors.endsAt}
          />
        </View>
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

      <View style={s.field}>
        <Text variant="label">Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any notes for the crew…"
          placeholderTextColor={t.color.textMuted}
          multiline
          style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
        />
      </View>

      <Button label="Create service" onPress={save} loading={saving} />
    </Screen>
  );
}
