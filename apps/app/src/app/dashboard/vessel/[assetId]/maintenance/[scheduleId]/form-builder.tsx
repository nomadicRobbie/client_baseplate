import { useState, useEffect } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FormField, FormFieldType } from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import { listVesselSchedules, updateVesselSchedule } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge, Notice } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const FIELD_TYPES: { type: FormFieldType; label: string }[] = [
  { type: 'boolean',  label: 'Yes / No' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'text',     label: 'Text' },
  { type: 'number',   label: 'Number' },
  { type: 'date',     label: 'Date' },
];

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  boolean:  'Yes / No',
  checkbox: 'Checkbox',
  text:     'Text',
  number:   'Number',
  date:     'Date',
  photo:    'Photo',
};

const uid = () => Math.random().toString(36).slice(2, 9);

const makePillStyle = (t: ThemeT, sel: boolean) => ({
  paddingVertical: t.space.sm,
  paddingHorizontal: t.space.md,
  borderRadius: t.radius.pill,
  borderWidth: 1,
  borderColor: sel ? t.color.primary : t.color.border,
  backgroundColor: sel ? t.color.primary : 'transparent' as const,
});

const makeStyles = (t: ThemeT) => ({
  backBtn:    { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  typeRow:    { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  addRow:     { gap: t.space.sm },
  reqRow:     { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  toggle:     (on: boolean) => ({
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: on ? t.color.primary : t.color.border,
    justifyContent: 'center' as const, paddingHorizontal: 3,
  }),
  toggleKnob: (on: boolean) => ({
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: t.color.primaryText,
    alignSelf: on ? 'flex-end' as const : 'flex-start' as const,
  }),
  fieldRow:   { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.sm },
  fieldInfo:  { flex: 1, gap: 2 },
  fieldMeta:  { flexDirection: 'row' as const, gap: t.space.xs, alignItems: 'center' as const },
  emptyHint:  { paddingVertical: t.space.md },
});

export default function FormBuilder() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId, scheduleId } = useLocalSearchParams<{ assetId: string; scheduleId: string }>();

  const [fields, setFields] = useState<FormField[] | null>(null);
  const [taskName, setTaskName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // new-field form
  const [newType, setNewType] = useState<FormFieldType>('checkbox');
  const [newLabel, setNewLabel] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  useEffect(() => {
    readThrough('vessel:schedules:' + assetId, () => listVesselSchedules(getAccessToken()!, assetId))
      .then(({ value }) => {
        const sc = value.schedules.find((s) => s.id === scheduleId);
        if (!sc) { setLoadError('Schedule not found.'); return; }
        setTaskName(sc.task_name);
        setFields(sc.form_schema?.fields ?? []);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [assetId, scheduleId]);

  const addField = () => {
    if (!newLabel.trim()) { setMsg({ text: 'Field label is required.', tone: 'error' }); return; }
    setFields((prev) => [...(prev ?? []), { id: uid(), type: newType, label: newLabel.trim(), required: newRequired }]);
    setNewLabel(''); setNewRequired(false); setMsg(null);
  };

  const removeField = (id: string) => setFields((prev) => (prev ?? []).filter((f) => f.id !== id));

  const save = async () => {
    if (!fields) return;
    setBusy(true); setMsg(null);
    try {
      await updateVesselSchedule(getAccessToken()!, scheduleId, { form_schema: { fields } });
      setMsg({ text: 'Form saved.', tone: 'success' });
      setTimeout(() => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId } }), 800);
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const goBack = () => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId } });

  if (loadError) return (
    <Screen>
      <Pressable onPress={goBack} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Maintenance</Text>
      </Pressable>
      <Notice message={loadError} tone="error" />
    </Screen>
  );

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={goBack} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Maintenance</Text>
      </Pressable>
      <Text variant="title">Task form</Text>
      {!!taskName && <Text variant="label" muted>{taskName}</Text>}

      {/* Existing fields */}
      <Card>
        <Text variant="heading">Fields</Text>
        {fields === null && <Text muted>Loading…</Text>}
        {fields?.length === 0 && <Text muted style={s.emptyHint}>No fields yet. Add one below.</Text>}
        {fields?.map((f) => (
          <View key={f.id} style={s.fieldRow}>
            <View style={s.fieldInfo}>
              <Text>{f.label}</Text>
              <View style={s.fieldMeta}>
                <Badge label={FIELD_TYPE_LABELS[f.type]} tone="neutral" />
                {f.required && <Badge label="Required" tone="accent" />}
              </View>
            </View>
            <Pressable onPress={() => removeField(f.id)} accessibilityRole="button" accessibilityLabel={`Remove field ${f.label}`}>
              <Ionicons name="trash-outline" size={18} color={t.color.textMuted} />
            </Pressable>
          </View>
        ))}
      </Card>

      {/* Add a field */}
      <Card>
        <Text variant="heading">Add a field</Text>
        <View style={s.addRow}>
          <Text variant="label" muted>Field type</Text>
          <View style={s.typeRow}>
            {FIELD_TYPES.map(({ type, label }) => (
              <Pressable key={type} onPress={() => setNewType(type)} accessibilityRole="button" style={makePillStyle(t, newType === type)}>
                <Text variant="label" color={newType === type ? t.color.primaryText : t.color.text}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <TextField label="Label" value={newLabel} onChangeText={setNewLabel} placeholder="Field label" autoCapitalize="sentences" />
          <View style={s.reqRow}>
            <Text variant="label">Required</Text>
            <Pressable onPress={() => setNewRequired((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: newRequired }} style={s.toggle(newRequired)}>
              <View style={s.toggleKnob(newRequired)} />
            </Pressable>
          </View>
          <Button label="Add field" variant="secondary" onPress={addField} />
        </View>
      </Card>

      <Button label="Save form" onPress={save} loading={busy} disabled={!fields || fields.length === 0} />

    </Screen>
  );
}
