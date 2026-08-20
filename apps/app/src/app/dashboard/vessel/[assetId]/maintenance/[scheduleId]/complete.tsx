import { useState, useEffect } from 'react';
import { View, Pressable, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FormField, FormResponseData, VesselMaintenanceSchedule } from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import { listVesselSchedules, createVesselMaintenanceLog, uploadVesselDocument } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice } from '@/ui/components';
import { DateField } from '@/ui/date-field';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn:     { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  fieldBlock:  { gap: t.space.sm, paddingVertical: t.space.sm },
  label:       { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  boolRow:     { flexDirection: 'row' as const, gap: t.space.sm },
  boolPill:    (sel: boolean, positive: boolean) => ({
    flex: 1, paddingVertical: t.space.sm, alignItems: 'center' as const,
    borderRadius: t.radius.md, borderWidth: 1,
    borderColor: sel ? (positive ? t.color.primary : t.color.danger) : t.color.border,
    backgroundColor: sel ? (positive ? t.color.primary : t.color.danger) : 'transparent' as const,
  }),
  checkRow:    { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  checkBox:    (checked: boolean) => ({
    width: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1.5,
    borderColor: checked ? t.color.primary : t.color.border,
    backgroundColor: checked ? t.color.primary : 'transparent' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  }),
  docRow:      { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs },
  docChip:     { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  docName:     { maxWidth: 180 },
  requiredStar:{ color: t.color.danger },
  errorText:   { color: t.color.danger },
});

// ── Field renderers ────────────────────────────────────────────────────────────

function BooleanField({ field, value, onChange, s, t }: {
  field: FormField; value: boolean | null;
  onChange: (v: boolean) => void; s: ReturnType<typeof makeStyles>; t: ThemeT;
}) {
  return (
    <View style={s.fieldBlock}>
      <FieldLabel field={field} s={s} t={t} />
      <View style={s.boolRow}>
        <Pressable style={s.boolPill(value === true, true)} onPress={() => onChange(true)} accessibilityRole="button">
          <Text variant="label" color={value === true ? t.color.primaryText : t.color.text}>Yes</Text>
        </Pressable>
        <Pressable style={s.boolPill(value === false, false)} onPress={() => onChange(false)} accessibilityRole="button">
          <Text variant="label" color={value === false ? t.color.primaryText : t.color.text}>No</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CheckboxField({ field, value, onChange, s, t }: {
  field: FormField; value: boolean;
  onChange: (v: boolean) => void; s: ReturnType<typeof makeStyles>; t: ThemeT;
}) {
  return (
    <View style={s.fieldBlock}>
      <Pressable style={s.checkRow} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
        <View style={s.checkBox(value)}>
          {value && <Ionicons name="checkmark" size={14} color={t.color.primaryText} />}
        </View>
        <Text>{field.label}{field.required && <Text style={s.requiredStar}> *</Text>}</Text>
      </Pressable>
    </View>
  );
}

function FieldLabel({ field, s, t }: { field: FormField; s: ReturnType<typeof makeStyles>; t: ThemeT }) {
  return (
    <View style={s.label}>
      <Text variant="label">{field.label}</Text>
      {field.required && <Text variant="label" style={s.requiredStar}>*</Text>}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CompleteTask() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId, scheduleId } = useLocalSearchParams<{ assetId: string; scheduleId: string }>();

  const [schedule, setSchedule] = useState<VesselMaintenanceSchedule | null>(null);
  const [loadError, setLoadError] = useState('');
  const [formData, setFormData] = useState<FormResponseData>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    readThrough('vessel:schedules:' + assetId, () => listVesselSchedules(getAccessToken()!, assetId))
      .then(({ value }) => {
        const sc = value.schedules.find((s) => s.id === scheduleId);
        if (!sc) { setLoadError('Schedule not found.'); return; }
        setSchedule(sc);
        // seed boolean fields as null (unanswered), rest empty
        const initial: FormResponseData = {};
        for (const f of sc.form_schema?.fields ?? []) {
          initial[f.id] = f.type === 'boolean' ? null : f.type === 'checkbox' ? false : '';
        }
        setFormData(initial);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [assetId, scheduleId]);

  const setField = (id: string, value: FormResponseData[string]) => {
    setFormData((prev) => ({ ...prev, [id]: value }));
    setFieldErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const pickFile = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setUploading(true);
      try { const { url } = await uploadVesselDocument(getAccessToken()!, file); setAttachments((prev) => [...prev, url]); }
      catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Upload failed', tone: 'error' }); }
      finally { setUploading(false); }
    };
    input.click();
  };

  const validate = (fields: FormField[]): boolean => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (!f.required) continue;
      const val = formData[f.id];
      if (f.type === 'boolean' && val === null) errors[f.id] = 'Required';
      else if (f.type === 'checkbox' && val !== true) errors[f.id] = 'Must be checked';
      else if ((f.type === 'text' || f.type === 'date') && !String(val ?? '').trim()) errors[f.id] = 'Required';
      else if (f.type === 'number' && (val === '' || val === null || isNaN(Number(val)))) errors[f.id] = 'Required';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    const fields = schedule?.form_schema?.fields ?? [];
    if (!validate(fields)) { setMsg({ text: 'Please fill in all required fields.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      // coerce number fields from string to number before storing
      const coerced: FormResponseData = { ...formData };
      for (const f of fields) {
        if (f.type === 'number' && typeof coerced[f.id] === 'string') coerced[f.id] = Number(coerced[f.id]);
      }
      await createVesselMaintenanceLog(getAccessToken()!, {
        asset_id: assetId, schedule_id: scheduleId,
        task_name: schedule?.task_name,
        completed_date: new Date().toISOString().slice(0, 10),
        form_data: coerced,
        attachments: attachments.length ? attachments : undefined,
      });
      router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId } });
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

  const fields = schedule?.form_schema?.fields ?? [];

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={goBack} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Maintenance</Text>
      </Pressable>
      <Text variant="title">Complete task</Text>
      {!!schedule?.task_name && <Text variant="label" muted>{schedule.task_name}</Text>}

      {schedule === null && !loadError && <Text muted>Loading…</Text>}

      {fields.length > 0 && (
        <Card>
          {fields.map((f) => {
            const val = formData[f.id];
            const error = fieldErrors[f.id];
            return (
              <View key={f.id}>
                {f.type === 'boolean' && (
                  <BooleanField field={f} value={val as boolean | null} onChange={(v) => setField(f.id, v)} s={s} t={t} />
                )}
                {f.type === 'checkbox' && (
                  <CheckboxField field={f} value={!!val} onChange={(v) => setField(f.id, v)} s={s} t={t} />
                )}
                {f.type === 'text' && (
                  <View style={s.fieldBlock}>
                    <FieldLabel field={f} s={s} t={t} />
                    <TextField label="" value={String(val ?? '')} onChangeText={(v) => setField(f.id, v)} placeholder="Enter text…" autoCapitalize="sentences" />
                  </View>
                )}
                {f.type === 'number' && (
                  <View style={s.fieldBlock}>
                    <FieldLabel field={f} s={s} t={t} />
                    <TextField label="" value={String(val ?? '')} onChangeText={(v) => setField(f.id, v)} placeholder="0" keyboardType="number-pad" />
                  </View>
                )}
                {f.type === 'date' && (
                  <View style={s.fieldBlock}>
                    <FieldLabel field={f} s={s} t={t} />
                    <DateField label="" value={String(val ?? '')} onChange={(v) => setField(f.id, v)} placeholder="Select date" />
                  </View>
                )}
                {!!error && <Text variant="small" style={s.errorText}>{error}</Text>}
              </View>
            );
          })}
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <Text variant="heading">Attachments</Text>
        {attachments.length > 0 && (
          <View style={s.docRow}>
            {attachments.map((url, i) => (
              <View key={i} style={s.docChip}>
                <Text variant="small" numberOfLines={1} style={s.docName}>{url.split('/').pop()}</Text>
                <Pressable onPress={() => setAttachments((prev) => prev.filter((_, x) => x !== i))} accessibilityRole="button" accessibilityLabel="Remove attachment">
                  <Text variant="small" muted>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Button label={uploading ? 'Uploading…' : 'Attach file'} variant="secondary" onPress={pickFile} disabled={uploading} />
      </Card>

      <Button label="Mark complete" onPress={submit} loading={busy} />

    </Screen>
  );
}
