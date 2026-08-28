import { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  ComplianceRecordType, ComplianceRecord, ComplianceFieldSpec, ComplianceSchedule, ScheduleDue, CoolingBatch,
} from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import {
  getRecordTypes, getComplianceRecords, createComplianceRecord, updateComplianceRecord,
  getSchedulesDue, listSchedules, createSchedule, updateSchedule, deleteSchedule, type NewSchedule,
  startCooling, getActiveCooling, reachCoolingStage, discardCooling, listPlans,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { evalLimit, describeLimit } from '@/lib/compliance';
import { Screen, Text, Card, GroupedCard, GRow, SectionLabel, Button, Notice, Badge, Pill } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { TempPicker } from '@/ui/temp-picker';
import { recordIcon } from '@/ui/record-icon';
import { useTheme } from '@/theme';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' | 'info' } | null;
type Editing = { type: ComplianceRecordType; record?: ComplianceRecord; schedule?: ComplianceSchedule; required?: boolean } | null;
type FormData = Record<string, string | boolean | string[]>;
type Tab = 'today' | 'records' | 'history';
type HistoryRange = 'today' | 'week' | '30d' | 'all';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGE_OPTS: [HistoryRange, string][] = [['today', 'Today'], ['week', 'This week'], ['30d', 'Last 30 days'], ['all', 'All']];

// ── Pure helpers ─────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function startOfWeekMonday(now = new Date()): Date {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
function rangeStart(range: HistoryRange): Date | null {
  const now = new Date();
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
  if (range === 'week') return startOfWeekMonday(now);
  if (range === '30d') { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 30); return d; }
  return null;
}
function todayLocal(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function cadenceText(sc: ComplianceSchedule): string {
  if (sc.cadence === 'weekly') return 'Weekly · ' + sc.weekdays.map((d) => WEEKDAYS[d]).join(' ');
  if (sc.cadence === 'monthly') return `Monthly · day ${sc.day_of_month}`;
  if (sc.cadence === 'interval') return `Every ${sc.interval_days} days`;
  return sc.times_per_day > 1 ? `Daily · ×${sc.times_per_day}` : 'Daily';
}
function initData(schema: ComplianceFieldSpec[], record?: ComplianceRecord): FormData {
  const d: FormData = {};
  for (const f of schema) {
    const existing = record?.data?.[f.key];
    if (f.type === 'bool') d[f.key] = existing === true;
    else if (f.type === 'multiselect') d[f.key] = Array.isArray(existing) ? (existing as string[]) : [];
    else d[f.key] = existing === undefined || existing === null ? '' : String(existing);
  }
  return d;
}
function toPayload(schema: ComplianceFieldSpec[], data: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema) {
    const v = data[f.key];
    if (f.type === 'number') { if (v !== '') out[f.key] = Number(v); }
    else if (f.type === 'bool') out[f.key] = v === true;
    else if (f.type === 'multiselect') out[f.key] = v;
    else if (v !== '') out[f.key] = v;
  }
  return out;
}
const UNIT_KEYS = ['unit_id', 'product', 'food', 'item', 'dish', 'supplier', 'equipment', 'area'];
function identifyUnit(data: Record<string, unknown>, schedule?: ComplianceSchedule): string {
  if (schedule?.label) return schedule.label;
  for (const k of UNIT_KEYS) { const v = data[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
}
function summarizeFailure(schema: ComplianceFieldSpec[], data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of schema) {
    const v = data[f.key];
    if (v === '' || v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) parts.push(`${f.label}: ${v.join(', ')}`); continue; }
    if (typeof v === 'boolean') { parts.push(`${f.label}: ${v ? 'Yes' : 'No'}`); continue; }
    parts.push(`${f.label}: ${v}${f.unit ? ` ${f.unit}` : ''}`);
  }
  return parts.join(' · ');
}
function caComplete(ca?: ComplianceRecord): boolean {
  const d = ca?.data ?? {};
  return Boolean(d.action_taken || d.cause || d.prevention);
}

// ── Cooling batch helpers ────────────────────────────────────────────────────
const H2 = 2 * 3_600_000, H4 = 4 * 3_600_000;
function coolingStage(b: CoolingBatch): { stage: 'stage1' | 'stage2'; label: string; deadline: number } {
  if (!b.reached_21_at) return { stage: 'stage1', label: 'Cool to 21 °C', deadline: Date.parse(b.started_at) + H2 };
  return { stage: 'stage2', label: 'Cool to 5 °C', deadline: Date.parse(b.reached_21_at) + H4 };
}
function humanDur(ms: number): string {
  const abs = Math.abs(ms), h = Math.floor(abs / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(t: ThemeT) {
  const soft = { passBg: t.color.success + '22', passInk: t.color.success, failBg: t.color.danger + '22', failInk: t.color.danger, limitBg: t.color.success + '18', limitBorder: t.color.success + '44' };
  return { soft, s: StyleSheet.create({
    seg: { flexDirection: 'row', backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill, padding: 4, marginVertical: t.space.md },
    segBtn: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.pill },
    segBtnOn: { backgroundColor: t.color.primary },
    statsRow: { flexDirection: 'row' },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    statNum: { fontSize: t.size.xl, fontWeight: '800', color: t.color.primary },
    whereAtRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 64, paddingHorizontal: t.space.md, paddingVertical: t.space.sm },
    whereAtRowBorder: { borderTopWidth: 1, borderTopColor: t.color.border },
    whereAtFraction: { width: 64, fontSize: 26, fontWeight: '800' as const, lineHeight: 28, letterSpacing: -1, color: t.color.text, fontFamily: t.font.mono },
    whereAtOf: { fontSize: 16, color: t.color.textMuted },
    quickRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 56, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border },
    quickIconChip: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.space.md },
    chip: { alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt },
    dueDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color.accent },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
    quickItem: { flexGrow: 1, flexBasis: '47%' },
    input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, minHeight: 44, fontSize: t.size.md, color: t.color.text },
    limitBox: { backgroundColor: soft.limitBg, borderWidth: 1, borderColor: soft.limitBorder, borderRadius: t.radius.md, padding: t.space.md },
    verdict: { borderRadius: t.radius.md, padding: t.space.md, flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    logItem: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm, paddingHorizontal: t.space.lg },
    failBadge: { backgroundColor: t.color.danger, paddingHorizontal: 8, paddingVertical: 2, borderRadius: t.radius.sm },
    caBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: t.space.sm, paddingVertical: 6, borderRadius: t.radius.sm, borderWidth: 1 },
    formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    formHeaderMain: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flex: 1 },
    fieldGroup: { gap: t.space.xs },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
    back: { paddingVertical: t.space.sm, alignSelf: 'flex-start' },
    scheduleItemMeta: { flex: 1 },
    scheduleItemActions: { flexDirection: 'row', gap: t.space.xs },
    categoryGroup: { gap: t.space.sm, marginBottom: t.space.md },
    categoryLabel: { textTransform: 'capitalize' },
    coolingContainer: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    coolingInfo: { flex: 1 },
    historyLogRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    historyLogInfo: { flex: 1, gap: 2 },
    historyLogActions: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    pendingCAContainer: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    pendingCAAlert: { borderWidth: 1, borderColor: t.color.danger },
    flex1: { flex: 1 },
    flexGrow1: { flexGrow: 1 },
    marginTopMd: { marginTop: t.space.md },
    marginTopSm: { marginTop: t.space.sm },
  }) };
}
function chipSize(size: number) { return { width: size, height: size }; }
function useStyles() { return makeStyles(useTheme()); }


// ── Small components ─────────────────────────────────────────────────────────
function ResultPill({ result }: { result: ComplianceRecord['result'] }) {
  const { s } = useStyles();
  if (result === 'pass') return <Badge label="Pass" tone="success" />;
  if (result === 'na') return <Badge label="—" tone="neutral" />;
  return <View style={s.failBadge}><Text variant="small" color="#ffffff">Fail</Text></View>;
}
function IconChip({ code, category, size = 44 }: { code: string; category?: string | null; size?: number }) {
  const t = useTheme();
  const { s } = useStyles();
  return (
    <View style={[s.chip, chipSize(size)]}>
      <Ionicons name={recordIcon(code, category)} size={Math.round(size * 0.5)} color={t.color.primary} />
    </View>
  );
}
function Field({ spec, value, onChange }: {
  spec: ComplianceFieldSpec; value: string | boolean | string[]; onChange: (v: string | boolean | string[]) => void;
}) {
  const t = useTheme();
  const { s } = useStyles();
  const label = spec.label + (spec.unit ? ` (${spec.unit})` : '') + (spec.required ? ' *' : '');
  return (
    <View style={s.fieldGroup}>
      <Text variant="label" muted>{label}</Text>
      {spec.type === 'bool' ? (
        <View style={s.rowWrap}>
          <Pill label="Pass" active={value === true} onPress={() => onChange(true)} />
          <Pill label="Fail" active={value === false} onPress={() => onChange(false)} />
        </View>
      ) : spec.type === 'enum' ? (
        <View style={s.rowWrap}>
          {(spec.options ?? []).map((o) => (
            <Pill key={o} label={o} active={value === o} onPress={() => onChange(value === o ? '' : o)} />
          ))}
        </View>
      ) : spec.type === 'multiselect' ? (
        <View style={s.rowWrap}>
          {(spec.options ?? []).map((o) => {
            const arr = (value as string[]) ?? [];
            const on = arr.includes(o);
            return <Pill key={o} label={o} active={on} onPress={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} />;
          })}
        </View>
      ) : spec.type === 'date' ? (
        <DateField label="" value={value as string} onChange={onChange} />
      ) : (
        <TextInput value={value as string} onChangeText={onChange}
          keyboardType={spec.type === 'number' ? 'numeric' : 'default'}
          placeholderTextColor={t.color.textMuted} style={s.input} />
      )}
    </View>
  );
}

function EnteredByRow({ value, onChange, last }: { value: string; onChange: (v: string) => void; last?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const border = { borderBottomWidth: last && !open ? 0 : 1, borderBottomColor: t.color.border };
  return (
    <>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button"
        style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.sm }, border]}>
        <Text variant="label" style={{ flex: 1 }}>Name</Text>
        <Text variant="small" muted numberOfLines={1}>{value || 'Required'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={[{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md }, { borderBottomWidth: last ? 0 : 1, borderBottomColor: t.color.border }]}>
          <TextInput value={value} onChangeText={onChange} autoFocus placeholder="Who did this check?"
            placeholderTextColor={t.color.textMuted}
            style={{ borderBottomWidth: 2, borderBottomColor: t.color.primary, paddingVertical: t.space.sm, fontSize: t.size.md, color: t.color.text }} />
        </View>
      )}
    </>
  );
}
function InlineField({ spec, value, onChange, last }: {
  spec: ComplianceFieldSpec; value: string | boolean | string[];
  onChange: (v: string | boolean | string[]) => void; last?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const border = { borderBottomWidth: last ? 0 : 1, borderBottomColor: t.color.border };
  if (spec.type === 'bool' || spec.type === 'enum' || spec.type === 'multiselect') {
    return (
      <View style={[border, { paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, gap: t.space.xs }]}>
        <Text variant="small" muted>{spec.label}{spec.required ? ' *' : ''}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {spec.type === 'bool' ? (
            <>
              <Pill label="Pass" active={value === true} onPress={() => onChange(true)} />
              <Pill label="Fail" active={value === false} onPress={() => onChange(false)} />
            </>
          ) : spec.type === 'enum' ? (
            (spec.options ?? []).map((o) => (
              <Pill key={o} label={o} active={value === o} onPress={() => onChange(value === o ? '' : o)} />
            ))
          ) : (
            (spec.options ?? []).map((o) => {
              const arr = (value as string[]) ?? [];
              const on = arr.includes(o);
              return <Pill key={o} label={o} active={on} onPress={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} />;
            })
          )}
        </View>
      </View>
    );
  }
  const displayVal = value as string;
  const isTemp = spec.type === 'number' && spec.unit?.includes('°');

  if (isTemp) {
    return (
      <View style={[border, { paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }]}>
        <Text variant="label" muted style={{ paddingTop: t.space.md }}>{spec.label}{spec.unit ? ` (${spec.unit})` : ''}{spec.required ? ' *' : ''}</Text>
        <TempPicker value={displayVal} onChange={(v) => onChange(v)} />
      </View>
    );
  }

  return (
    <>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button"
        style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.sm }, { borderBottomWidth: last && !open ? 0 : 1, borderBottomColor: t.color.border }]}>
        <Text variant="label" style={{ flex: 1 }}>{spec.label}{spec.unit ? ` (${spec.unit})` : ''}</Text>
        <Text variant="small" muted numberOfLines={1} style={{ maxWidth: 100 }}>
          {displayVal || (spec.required ? 'Required' : '')}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={[{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md }, border]}>
          {spec.type === 'date'
            ? <DateField label="" value={displayVal} onChange={onChange} />
            : <TextInput value={displayVal} onChangeText={onChange} autoFocus
                keyboardType={spec.type === 'number' ? 'numeric' : 'default'}
                placeholderTextColor={t.color.textMuted}
                placeholder={spec.required ? 'Required' : 'Optional'}
                style={{ borderBottomWidth: 2, borderBottomColor: t.color.primary, paddingVertical: t.space.sm, fontSize: t.size.md, color: t.color.text }} />}
        </View>
      )}
    </>
  );
}

// ── Schedule editor ──────────────────────────────────────────────────────────
function ScheduleEditor({ types, edit, defaultPlanId, onSaved, onCancel }: {
  types: ComplianceRecordType[]; edit: ComplianceSchedule | null;
  defaultPlanId?: string; onSaved: () => void; onCancel: () => void;
}) {
  const { s } = useStyles();
  const [recordType, setRecordType] = useState(edit?.record_type ?? types[0]?.code ?? '');
  const [label, setLabel] = useState(edit?.label ?? '');
  const [cadence, setCadence] = useState<NewSchedule['cadence']>(edit?.cadence ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(edit?.weekdays ?? []);
  const [dayOfMonth, setDayOfMonth] = useState(edit?.day_of_month ? String(edit.day_of_month) : '1');
  const [intervalDays, setIntervalDays] = useState(edit?.interval_days ? String(edit.interval_days) : '2');
  const [timesPerDay, setTimesPerDay] = useState(edit?.times_per_day ? String(edit.times_per_day) : '1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!recordType) { setErr('Pick a check type.'); return; }
    if (!label.trim()) { setErr('Give it a name (e.g. Main chiller).'); return; }
    if (cadence === 'weekly' && weekdays.length === 0) { setErr('Pick at least one weekday.'); return; }
    setBusy(true); setErr('');
    const body: NewSchedule = {
      record_type: recordType, label: label.trim(), cadence,
      weekdays: cadence === 'weekly' ? weekdays : [],
      day_of_month: cadence === 'monthly' ? Number(dayOfMonth) : null,
      interval_days: cadence === 'interval' ? Number(intervalDays) : null,
      anchor_date: cadence === 'interval' ? todayLocal() : null,
      times_per_day: Math.max(1, Number(timesPerDay) || 1),
      plan_id: edit?.plan_id ?? defaultPlanId ?? null,
    };
    try {
      const token = getAccessToken()!;
      if (edit) await updateSchedule(token, edit.id, body); else await createSchedule(token, body);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Card>
      {err ? <Notice message={err} tone="error" /> : null}

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Check type *</Text>
        {Object.entries(
          types.reduce<Record<string, ComplianceRecordType[]>>((g, ty) => {
            (g[ty.category ?? 'Other'] ??= []).push(ty);
            return g;
          }, {})
        ).map(([cat, list]) => (
          <View key={cat} style={s.categoryGroup}>
            <View style={s.rowWrap}>
              <Text variant="small" muted style={s.categoryLabel}>{cat}</Text>
              <Badge label={String(list.length)} tone="neutral" />
            </View>
            <View style={s.rowWrap}>
              {list.map((ty) => <Pill key={ty.code} label={ty.label} active={recordType === ty.code} onPress={() => setRecordType(ty.code)} />)}
            </View>
          </View>
        ))}
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Name it (so staff know which one) *</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="Unit name" style={s.input} />
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Repeats *</Text>
        <View style={s.rowWrap}>
          {(['daily', 'weekly', 'monthly', 'interval'] as const).map((c) => (
            <Pill key={c} label={c === 'interval' ? 'Every N days' : c[0].toUpperCase() + c.slice(1)} active={cadence === c} onPress={() => setCadence(c)} />
          ))}
        </View>
      </View>

      {cadence === 'weekly' && (
        <View style={s.fieldGroup}>
          <Text variant="label" muted>On which days *</Text>
          <View style={s.rowWrap}>
            {WEEKDAYS.map((w, i) => (
              <Pill key={w} label={w} active={weekdays.includes(i)}
                onPress={() => setWeekdays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])} />
            ))}
          </View>
        </View>
      )}
      {cadence === 'monthly' && (
        <View style={s.fieldGroup}>
          <Text variant="label" muted>Day of month (1–31)</Text>
          <TextInput value={dayOfMonth} onChangeText={setDayOfMonth} keyboardType="numeric" style={s.input} />
        </View>
      )}
      {cadence === 'interval' && (
        <View style={s.fieldGroup}>
          <Text variant="label" muted>Every N days</Text>
          <TextInput value={intervalDays} onChangeText={setIntervalDays} keyboardType="numeric" style={s.input} />
        </View>
      )}

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Times per day</Text>
        <TextInput value={timesPerDay} onChangeText={setTimesPerDay} keyboardType="numeric" style={s.input} />
      </View>

      <View style={s.rowWrap}>
        <Button label={edit ? 'Save changes' : 'Add schedule'} onPress={save} loading={busy} style={s.flexGrow1} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={s.flexGrow1} />
      </View>
    </Card>
  );
}

// ── Schedules manager ────────────────────────────────────────────────────────
function SchedulesManager({ types, typeByCode, isAdmin, planId, onBack }: {
  types: ComplianceRecordType[]; typeByCode: Record<string, ComplianceRecordType>;
  isAdmin: boolean; planId: string; onBack: () => void;
}) {
  const t = useTheme();
  const { s } = useStyles();
  const [schedules, setSchedules] = useState<ComplianceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState<{ edit: ComplianceSchedule | null } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const all = (await listSchedules(getAccessToken()!)).schedules;
      // Show schedules for this plan + unscoped (null) for backward compat
      setSchedules(all.filter((sc) => sc.plan_id === planId || sc.plan_id === null));
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [planId]);

  const remove = async (id: string) => {
    try { await deleteSchedule(getAccessToken()!, id); await load(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
  };

  return (
    <>
      <Pressable onPress={onBack} accessibilityRole="button" style={s.back}>
        <Text variant="label" color={t.color.primary}>‹ Back to Today</Text>
      </Pressable>
      <Text muted>Recurring checks that appear on Today when they're due.</Text>
      {msg && <Notice message={msg.text} tone={msg.tone} />}

      <View style={{ gap: 8 }}>
        <SectionLabel right={schedules.length > 0 ? <Text variant="small" muted>{schedules.length}</Text> : undefined}>Scheduled checks</SectionLabel>
        {loading
          ? <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>
          : schedules.length === 0
            ? <Text muted style={{ paddingHorizontal: 4 }}>No schedules yet. Add one below.</Text>
            : (
              <GroupedCard>
                {schedules.map((sc, i) => (
                  <GRow key={sc.id} last={i === schedules.length - 1}>
                    <IconChip code={sc.record_type} category={typeByCode[sc.record_type]?.category} size={34} />
                    <View style={s.scheduleItemMeta}>
                      <Text variant="label">{sc.label}</Text>
                      <Text variant="small" muted>{typeByCode[sc.record_type]?.label ?? sc.record_type} · {cadenceText(sc)} · ID: {sc.unit_id}</Text>
                    </View>
                    {isAdmin && (
                      <View style={s.scheduleItemActions}>
                        <Pressable onPress={() => setForm({ edit: sc })} accessibilityLabel="Edit" hitSlop={8}><Ionicons name="pencil" size={18} color={t.color.textMuted} /></Pressable>
                        <Pressable onPress={() => remove(sc.id)} accessibilityLabel="Delete" hitSlop={8}><Ionicons name="trash-outline" size={18} color={t.color.danger} /></Pressable>
                      </View>
                    )}
                  </GRow>
                ))}
              </GroupedCard>
            )}
      </View>

      {isAdmin && (form ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>{form.edit ? 'Edit scheduled check' : 'New scheduled check'}</SectionLabel>
          <ScheduleEditor types={types} edit={form.edit} defaultPlanId={planId}
            onSaved={() => { setForm(null); void load(); }} onCancel={() => setForm(null)} />
        </View>
      ) : (
        <Button label="+ Add scheduled check" onPress={() => setForm({ edit: null })} />
      ))}
    </>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function CompliancePlanView() {
  const t = useTheme();
  const { s, soft } = useStyles();
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { user, features } = useAuth();
  const { data: profile } = useProfile();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const userName = profile?.me?.name ?? '';

  const [planName, setPlanName] = useState<string>('');
  const [planTier, setPlanTier] = useState<string>('');
  const [types, setTypes] = useState<ComplianceRecordType[]>([]);
  const [records, setRecords] = useState<ComplianceRecord[]>([]);
  const [due, setDue] = useState<ScheduleDue[]>([]);
  const [cooling, setCooling] = useState<CoolingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [manage, setManage] = useState(false);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('all');
  const [showCoolingStart, setShowCoolingStart] = useState(false);
  const [coolingProduct, setCoolingProduct] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const [editing, setEditing] = useState<Editing>(null);
  const [enteredBy, setEnteredBy] = useState('');
  const [data, setData] = useState<FormData>({});
  const [pendingCA, setPendingCA] = useState<{ type: ComplianceRecordType; record: ComplianceRecord } | null>(null);

  const typeByCode = useMemo(() => Object.fromEntries(types.map((x) => [x.code, x])), [types]);

  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const overlay = !!editing || manage;
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: overlay ? 0 : scrollYRef.current, animated: false }));
  }, [overlay]);

  const load = async () => {
    setLoading(true);
    try {
      const token = getAccessToken()!;
      const [tRes, rRes, dRes, cRes, pRes] = await Promise.all([
        getRecordTypes(token), getComplianceRecords(token), getSchedulesDue(token, todayLocal()),
        getActiveCooling(token), listPlans(token),
      ]);
      setTypes(tRes.record_types);
      setRecords(rRes.records);
      // Show due items for this plan + unscoped schedules (backward compat)
      setDue(dRes.due.filter((d) => d.schedule.plan_id === planId || d.schedule.plan_id === null));
      setCooling(cRes.batches);
      const plan = pRes.plans.find((p) => p.id === planId);
      if (plan) { setPlanName(plan.name); setPlanTier(plan.tier); }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [planId]);
  useEffect(() => {
    if (cooling.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [cooling.length]);

  if (features && !features.compliance) return <Redirect href="/dashboard" />;

  const openForm = (type: ComplianceRecordType, record?: ComplianceRecord, schedule?: ComplianceSchedule, opts?: { required?: boolean }) => {
    setEditing({ type, record, schedule, required: opts?.required });
    setEnteredBy(record?.entered_by ?? userName);
    const base = initData(type.field_schema, record);
    if (schedule?.unit_id && 'unit_id' in base) base['unit_id'] = schedule.unit_id;
    setData(base);
    setMsg(null);
  };
  const openByCode = (code: string) => { const ty = typeByCode[code]; if (ty) openForm(ty); };

  const save = async () => {
    if (!editing) return;
    const { type, record, schedule, required } = editing;
    if (!enteredBy.trim()) { setMsg({ text: 'Your name/initials are required.', tone: 'error' }); return; }
    const missing = type.field_schema.find((f) => f.required && (data[f.key] === '' || data[f.key] === undefined));
    if (missing) { setMsg({ text: `${missing.label} is required.`, tone: 'error' }); return; }
    if (required && !(data.action_taken || data.cause || data.prevention)) {
      setMsg({ text: 'Record what was done about it (action taken) before you can continue.', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken()!;
      const payload = toPayload(type.field_schema, data);
      if (record) {
        await updateComplianceRecord(token, record.id, { entered_by: enteredBy.trim(), data: payload });
        if (type.code === 'corrective_action') setPendingCA(null);
        setMsg({ text: type.code === 'corrective_action' ? 'Corrective action recorded.' : 'Record updated.', tone: 'success' });
        setEditing(null);
        await load();
      } else {
        const res = await createComplianceRecord(token, {
          record_type: type.code, entered_by: enteredBy.trim(), data: payload, schedule_id: schedule?.id ?? null,
        });
        const caType = typeByCode['corrective_action'];
        if (res.record.result === 'fail' && res.corrective_action && caType) {
          const unit = identifyUnit(data, schedule);
          const summary = summarizeFailure(type.field_schema, data);
          const enriched: ComplianceRecord = {
            ...res.corrective_action,
            data: {
              ...res.corrective_action.data,
              what_went_wrong: `${type.label} failed${summary ? ` — ${summary}` : ''}`,
              affected: unit || (res.corrective_action.data?.affected as string) || '',
            },
          };
          setPendingCA({ type: caType, record: enriched });
          await load();
          openForm(caType, enriched, undefined, { required: true });
          setMsg({ text: `${type.label} failed — record the corrective action to continue.`, tone: 'error' });
        } else {
          setMsg({ text: res.record.result === 'pass' ? 'Check passed and logged.' : 'Record logged.', tone: 'success' });
          setEditing(null);
          await load();
        }
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const caById = useMemo(
    () => Object.fromEntries(records.filter((r) => r.record_type === 'corrective_action').map((r) => [r.id, r])),
    [records],
  );
  const linkedCaIds = useMemo(
    () => new Set(records.map((r) => r.corrective_action_id).filter(Boolean) as string[]),
    [records],
  );
  const historyRecords = useMemo(
    () => records.filter((r) => !(r.record_type === 'corrective_action' && linkedCaIds.has(r.id))),
    [records, linkedCaIds],
  );

  const openCorrectiveFor = (check: ComplianceRecord) => {
    const caType = typeByCode['corrective_action'];
    const ca = check.corrective_action_id ? caById[check.corrective_action_id] : undefined;
    if (!caType || !ca) return;
    const checkType = typeByCode[check.record_type];
    const enriched: ComplianceRecord = { ...ca, data: { ...ca.data } };
    if (!enriched.data.affected) enriched.data.affected = identifyUnit(check.data);
    if (!enriched.data.what_went_wrong && checkType) enriched.data.what_went_wrong = `${checkType.label} failed`;
    openForm(caType, enriched, undefined, { required: !caComplete(ca) });
  };

  const openRequiredCA = (ca: ComplianceRecord, affected?: string) => {
    const caType = typeByCode['corrective_action'];
    if (!caType) return;
    const enriched: ComplianceRecord = { ...ca, data: { ...ca.data, affected: (ca.data.affected as string) || affected || '' } };
    setPendingCA({ type: caType, record: enriched });
    openForm(caType, enriched, undefined, { required: true });
  };

  const startCoolingBatch = async () => {
    if (!coolingProduct.trim()) { setMsg({ text: 'What is cooling?', tone: 'error' }); return; }
    setBusy(true);
    try {
      await startCooling(getAccessToken()!, { product: coolingProduct.trim(), started_by: userName || 'Staff' });
      setCoolingProduct(''); setShowCoolingStart(false);
      await load();
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const reachStage = async (batch: CoolingBatch) => {
    const { stage } = coolingStage(batch);
    setBusy(true);
    try {
      const res = await reachCoolingStage(getAccessToken()!, batch.id, stage);
      await load();
      if (stage === 'stage2' && res.corrective_action) {
        openRequiredCA(res.corrective_action, batch.product);
        setMsg({ text: `${batch.product} exceeded the cooling limit — record the corrective action.`, tone: 'error' });
      } else if (stage === 'stage2') {
        setMsg({ text: `${batch.product} cooled within limits.`, tone: 'success' });
      }
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const discardBatch = async (batch: CoolingBatch) => {
    setBusy(true);
    try {
      const res = await discardCooling(getAccessToken()!, batch.id, { entered_by: userName });
      await load();
      openRequiredCA(res.corrective_action, batch.product);
      setMsg({ text: `Cooling problem with ${batch.product} — record the corrective action.`, tone: 'error' });
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const entriesToday = records.filter((r) => isToday(r.datetime)).length;
  const issuesOpen = records.filter((r) => r.result === 'fail' && !caComplete(caById[r.corrective_action_id ?? ''])).length;
  const dueDone = due.filter((d) => d.remaining === 0).length;

  const grouped = useMemo(() => {
    const g: Record<string, ComplianceRecordType[]> = {};
    for (const ty of types) (g[ty.category ?? 'other'] ??= []).push(ty);
    return g;
  }, [types]);

  const renderForm = (ed: NonNullable<Editing>) => {
    const { type, record, schedule, required } = ed;
    const payload = toPayload(type.field_schema, data);
    const verdict = type.critical_limit ? evalLimit(type.critical_limit, payload) : 'na';
    const limitText = describeLimit(type.critical_limit, type.field_schema);
    const schema = type.field_schema;
    return (
      <>
        <View style={s.formHeader}>
          <View style={s.formHeaderMain}>
            <IconChip code={type.code} category={type.category} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{schedule ? schedule.label : `${record ? 'Edit' : 'New'}: ${type.label}`}</Text>
              <Text variant="small" muted>{type.label}</Text>
            </View>
          </View>
          {!required && (
            <Pressable onPress={() => setEditing(null)} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="close" size={22} color={t.color.textMuted} />
            </Pressable>
          )}
        </View>

        {required && <Notice message="This check failed — record the corrective action below to continue." tone="error" />}
        {limitText && <View style={s.limitBox}><Text variant="small" color={soft.passInk}>Critical limit: {limitText}</Text></View>}

        <GroupedCard>
          <EnteredByRow value={enteredBy} onChange={setEnteredBy} last={schema.length === 0} />
          {schema.map((f, i) => {
            const isLast = i === schema.length - 1;
            if (f.key === 'unit_id' && schedule?.unit_id) {
              return (
                <GRow key={f.key} last={isLast}>
                  <Text variant="label" style={{ flex: 1 }}>Unit ID</Text>
                  <Text variant="mono" color={t.color.textMuted}>{schedule.unit_id}</Text>
                </GRow>
              );
            }
            return (
              <InlineField key={f.key} spec={f} value={data[f.key]} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} last={isLast} />
            );
          })}
        </GroupedCard>

        {verdict !== 'na' && (
          <View style={[s.verdict, { backgroundColor: verdict === 'pass' ? soft.passBg : soft.failBg }]}>
            <Ionicons name={verdict === 'pass' ? 'checkmark-circle' : 'alert-circle'} size={20} color={verdict === 'pass' ? soft.passInk : soft.failInk} />
            <Text variant="label" color={verdict === 'pass' ? soft.passInk : soft.failInk} style={s.flex1}>
              {verdict === 'pass' ? 'Within limit' : 'Outside the limit — saving this will raise a corrective action.'}
            </Text>
          </View>
        )}

        <Button label={record ? 'Update record' : 'Save record'} onPress={save} loading={busy} />
      </>
    );
  };

  const renderToday = () => (
    <>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        <View style={s.whereAtRow}>
          <Text style={s.whereAtFraction}>{dueDone}<Text style={s.whereAtOf}>/{due.length}</Text></Text>
          <Text variant="label" style={{ flex: 1 }}>Checks done today</Text>
        </View>
        {issuesOpen > 0 && (
          <Pressable onPress={() => pendingCA && openForm(pendingCA.type, pendingCA.record)}
            accessibilityRole="button" style={[s.whereAtRow, s.whereAtRowBorder]}>
            <Text style={[s.whereAtFraction, { color: t.color.danger }]}>{issuesOpen}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="label">{issuesOpen === 1 ? 'Issue open' : 'Issues open'}</Text>
              <Text variant="small" muted>Corrective action not recorded</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
      </Card>

      {(cooling.length > 0 || showCoolingStart) && (
        <>
          <SectionLabel>Cooling in progress</SectionLabel>
          {showCoolingStart && (
            <Card>
              <View style={s.fieldGroup}>
                <Text variant="label" muted>What's cooling? *</Text>
                <TextInput value={coolingProduct} onChangeText={setCoolingProduct} placeholder="Product name" placeholderTextColor={t.color.textMuted} style={s.input} />
              </View>
              <View style={s.rowWrap}>
                <Button label="Start cooling clock" onPress={startCoolingBatch} loading={busy} style={s.flexGrow1} />
                <Button label="Cancel" variant="ghost" onPress={() => { setShowCoolingStart(false); setCoolingProduct(''); }} style={s.flexGrow1} />
              </View>
            </Card>
          )}
          {cooling.map((b) => {
            const st = coolingStage(b);
            const remaining = st.deadline - now;
            const over = remaining < 0;
            return (
              <Card key={b.id} style={over ? { borderWidth: 1, borderColor: t.color.danger } : undefined}>
                <View style={s.coolingContainer}>
                  <IconChip code="cooling" size={40} />
                  <View style={s.coolingInfo}>
                    <Text variant="label">{b.product}</Text>
                    <Text variant="small" muted>{st.label} · started {new Date(b.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <Text variant="label" color={over ? t.color.danger : t.color.success}>{over ? `Overdue ${humanDur(remaining)}` : `${humanDur(remaining)} left`}</Text>
                </View>
                <View style={s.rowWrap}>
                  <Button label={st.stage === 'stage1' ? 'Reached 21 °C' : 'Reached 5 °C — done'} onPress={() => reachStage(b)} loading={busy} style={s.flexGrow1} />
                  <Button label="Report a problem" variant="danger" onPress={() => discardBatch(b)} loading={busy} style={s.flexGrow1} />
                </View>
              </Card>
            );
          })}
        </>
      )}

      <SectionLabel right={isAdmin ? (
        <Pressable onPress={() => setManage(true)} accessibilityRole="button">
          <Text variant="label" color={t.color.primary}>Manage</Text>
        </Pressable>
      ) : undefined}>Checks due today</SectionLabel>

      {loading ? <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>
        : due.length === 0 ? (
          <View style={{ paddingHorizontal: 4, gap: 8 }}>
            <Text muted>Nothing scheduled for today.</Text>
            {isAdmin && <Button label="Set up scheduled checks" variant="ghost" onPress={() => setManage(true)} />}
          </View>
        ) : (
          <GroupedCard>
            {due.map(({ schedule: sc, done_count, remaining }, i) => {
              const ty = typeByCode[sc.record_type];
              const done = remaining === 0;
              return (
                <GRow key={sc.id} onPress={() => ty && openForm(ty, undefined, sc)} last={i === due.length - 1}>
                  <IconChip code={sc.record_type} category={ty?.category} size={36} />
                  <View style={s.flex1}>
                    <Text variant="label">{sc.label}</Text>
                    <Text variant="small" muted>{ty?.label ?? sc.record_type}{sc.times_per_day > 1 ? ` · ${done_count}/${sc.times_per_day}` : ''}</Text>
                  </View>
                  {done
                    ? <Ionicons name="checkmark-circle" size={20} color={t.color.success} />
                    : <View style={s.dueDot} />}
                </GRow>
              );
            })}
          </GroupedCard>
        )}

      <SectionLabel>Log something else</SectionLabel>
      <GroupedCard>
        {typeByCode['cooking_poultry_mince_liver'] && (
          <Pressable onPress={() => openByCode('cooking_poultry_mince_liver')} accessibilityRole="button" style={s.quickRow}>
            <View style={s.quickIconChip}><Ionicons name="flame-outline" size={18} color={t.color.text} /></View>
            <Text variant="label" style={{ flex: 1 }}>Log a cook</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
        <Pressable onPress={() => setShowCoolingStart(true)} accessibilityRole="button" style={s.quickRow}>
          <View style={s.quickIconChip}><Ionicons name="snow-outline" size={18} color={t.color.text} /></View>
          <Text variant="label" style={{ flex: 1 }}>Start cooling</Text>
          <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
        </Pressable>
        {typeByCode['receiving'] && (
          <Pressable onPress={() => openByCode('receiving')} accessibilityRole="button" style={s.quickRow}>
            <View style={s.quickIconChip}><Ionicons name="cart-outline" size={18} color={t.color.text} /></View>
            <Text variant="label" style={{ flex: 1 }}>Log a delivery</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
        {isAdmin && (
          <Pressable onPress={() => setManage(true)} accessibilityRole="button" style={s.quickRow}>
            <View style={s.quickIconChip}><Ionicons name="calendar-outline" size={18} color={t.color.text} /></View>
            <Text variant="label" style={{ flex: 1 }}>Scheduled checks</Text>
            <Text variant="small" muted>{due.length}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
      </GroupedCard>
    </>
  );

  const renderRecords = () => (
    loading ? <Text muted>Loading…</Text> : (
      <>
        {Object.entries(grouped).map(([cat, list]) => (
          <View key={cat} style={{ gap: 8 }}>
            <SectionLabel right={<Text variant="small" muted>{list.length}</Text>}>{cat}</SectionLabel>
            <GroupedCard>
              {list.map((ty, i) => (
                <GRow key={ty.code} onPress={() => openForm(ty)} last={i === list.length - 1}>
                  <IconChip code={ty.code} category={ty.category} size={36} />
                  <Text variant="label" style={{ flex: 1 }}>{ty.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                </GRow>
              ))}
            </GroupedCard>
          </View>
        ))}
      </>
    )
  );

  const renderHistory = () => {
    const start = rangeStart(historyRange);
    const shown = start ? historyRecords.filter((r) => new Date(r.datetime) >= start) : historyRecords;

    // Group by calendar date
    const byDate: { dateKey: string; label: string; items: typeof shown }[] = [];
    for (const r of shown) {
      const d = new Date(r.datetime);
      const dateKey = d.toDateString();
      const label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const last = byDate[byDate.length - 1];
      if (last?.dateKey === dateKey) last.items.push(r);
      else byDate.push({ dateKey, label, items: [r] });
    }

    const HistoryRecord = ({ r }: { r: (typeof shown)[number] }) => {
      const ty = typeByCode[r.record_type];
      const hasCa = r.result === 'fail' && !!r.corrective_action_id;
      const caDone = caComplete(caById[r.corrective_action_id ?? '']);
      return (
        <View style={s.logItem}>
          <Pressable onPress={() => ty && openForm(ty, r)} accessibilityRole="button" style={s.historyLogRow}>
            <IconChip code={r.record_type} category={ty?.category} size={34} />
            <View style={s.historyLogInfo}>
              <Text variant="label">{ty?.label ?? r.record_type}</Text>
              <Text variant="small" muted>{r.entered_by} · {new Date(r.datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </Pressable>
          <View style={s.historyLogActions}>
            <ResultPill result={r.result} />
            {hasCa && (
              <Pressable
                onPress={() => openCorrectiveFor(r)}
                accessibilityRole="button"
                accessibilityLabel={caDone ? 'View corrective action' : 'Complete corrective action'}
                hitSlop={6}
                style={[s.caBtn, { borderColor: caDone ? t.color.border : t.color.danger }]}
              >
                <Ionicons name={caDone ? 'construct-outline' : 'alert-circle'} size={14} color={caDone ? t.color.textMuted : t.color.danger} />
                <Text variant="small" color={caDone ? t.color.textMuted : t.color.danger}>{caDone ? 'Action' : 'Fix'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      );
    };

    return (
      <>
        <View style={s.seg}>
          {RANGE_OPTS.map(([k, label]) => (
            <Pressable key={k} onPress={() => setHistoryRange(k)} accessibilityRole="button"
              accessibilityState={{ selected: historyRange === k }}
              style={[s.segBtn, historyRange === k && s.segBtnOn]}>
              <Text variant="label" color={historyRange === k ? t.color.primaryText : t.color.textMuted}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {loading ? <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>
          : historyRecords.length === 0 ? <Text muted style={{ paddingHorizontal: 4 }}>No records yet — log a check from Today or Records.</Text>
          : shown.length === 0 ? <Text muted style={{ paddingHorizontal: 4 }}>No records in this range.</Text>
          : byDate.map(({ dateKey, label, items }) => (
            <View key={dateKey} style={{ gap: 8 }}>
              <SectionLabel right={<Text variant="small" muted>{items.length}</Text>}>{label}</SectionLabel>
              <GroupedCard>
                {items.map((r) => <HistoryRecord key={r.id} r={r} />)}
              </GroupedCard>
            </View>
          ))
        }
        {shown.length > 0 && (
          <Button label="Export for verifier (PDF)" variant="ghost" onPress={() => setMsg({ text: 'Verifier PDF export is coming soon.', tone: 'info' })} />
        )}
      </>
    );
  };

  return (
    <Screen scrollRef={scrollRef} onScroll={(e) => { if (!overlay) scrollYRef.current = e.nativeEvent.contentOffset.y; }}>
      {msg && <Notice message={msg.text} tone={msg.tone} />}

      {/* Back to plan picker */}
      {!editing && !manage && (
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={s.back}>
          <Text variant="label" color={t.color.primary}>‹ Control plans</Text>
        </Pressable>
      )}

      {!editing && !manage && !!planName && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="clipboard-outline" size={26} color={t.color.textMuted} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: t.size.xl, fontWeight: '700', letterSpacing: -0.4 }}>{planName}</Text>
            <Text variant="small" muted>
              {planTier ? `${planTier} · ` : ''}{new Date().toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
            </Text>
          </View>
        </View>
      )}

      {pendingCA && !editing && (
        <Card style={s.pendingCAAlert}>
          <View style={s.pendingCAContainer}>
            <Ionicons name="alert-circle" size={22} color={t.color.danger} />
            <Text variant="label" color={t.color.danger} style={s.flex1}>A check failed — a corrective action is waiting.</Text>
          </View>
          <Button label="Complete corrective action →" onPress={() => openForm(pendingCA.type, pendingCA.record)} />
        </Card>
      )}

      {editing ? renderForm(editing)
        : manage ? <SchedulesManager types={types} typeByCode={typeByCode} isAdmin={isAdmin} planId={planId} onBack={() => { setManage(false); void load(); }} />
        : (
          <>
            <View style={s.seg}>
              {(['today', 'records', 'history'] as Tab[]).map((k) => (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="button" accessibilityState={{ selected: tab === k }}
                  style={[s.segBtn, tab === k && s.segBtnOn]}>
                  <Text variant="label" color={tab === k ? t.color.primaryText : t.color.textMuted}>
                    {k === 'today' ? 'Today' : k === 'records' ? 'Records' : 'History'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === 'today' && renderToday()}
            {tab === 'records' && renderRecords()}
            {tab === 'history' && renderHistory()}
          </>
        )}
    </Screen>
  );
}
