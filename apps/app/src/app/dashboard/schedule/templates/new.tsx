import { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetType } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { createServiceTemplate, listAssets, listAssetTypes } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/ui/components';
import { SelectField } from '@/ui/select-field';
import { WeekdayRecurrencePicker, type RecurrenceValue } from '@/ui/weekday-recurrence-picker';
import { localDate } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const today = localDate;

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  field: { gap: t.space.xs },
  input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  row: { flexDirection: 'row' as const, gap: t.space.sm },
  flex1: { flex: 1 },
  divider: { height: 1, backgroundColor: t.color.border, marginVertical: t.space.sm },
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
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState('0');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [useRecurrence, setUseRecurrence] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceValue>({ days: [], time: '09:00', startDate: today(), endDate: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    const tok = getAccessToken()!;
    Promise.all([listAssets(tok), listAssetTypes(tok)])
      .then(([a, at]) => { setAssets(a.assets); setAssetTypes(at.asset_types); })
      .catch(() => {});
  }, []);

  const facilitiesTypeId = assetTypes.find(at => at.name === 'Facilities')?.id;
  const facilities = assets.filter(a => a.asset_type_id === facilitiesTypeId);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!duration || isNaN(Number(duration)) || Number(duration) < 1) e.duration = 'Must be a positive number';
    if (!timezone.trim()) e.timezone = 'Timezone is required';
    if (useRecurrence) {
      if (recurrence.days.length === 0) e.days = 'Select at least one day';
      if (!recurrence.time.match(/^\d{2}:\d{2}$/)) e.time = 'Use HH:MM format';
      if (!recurrence.startDate) e.startDate = 'Start date is required';
    }
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
        facility_id: facilityId,
        timezone: timezone.trim(),
        required_roles: [],
        required_asset_types: [],
        default_asset_id: null,
        recurrence: useRecurrence
          ? { days: recurrence.days, time: recurrence.time, startDate: recurrence.startDate, endDate: recurrence.endDate }
          : null,
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

      {facilities.length > 0 && (
        <SelectField
          label="Facility"
          value={facilityId}
          onChange={setFacilityId}
          placeholder="None"
          options={facilities.map(f => ({ label: f.name, value: f.id }))}
        />
      )}

      <View style={s.divider} />

      {/* Recurrence toggle */}
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

      {useRecurrence && (
        <WeekdayRecurrencePicker
          value={recurrence}
          onChange={v => { setRecurrence(v); setErrors(prev => ({ ...prev, days: '', time: '', startDate: '', endDate: '' })); }}
          errors={errors}
        />
      )}

      <Button label="Create template" onPress={save} loading={saving} />
    </Screen>
  );
}
