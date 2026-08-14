import { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  ComplianceRecordType, ComplianceRecord, ComplianceFieldSpec, ComplianceSchedule, ScheduleDue, CoolingBatch,
} from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import {
  getRecordTypes, getComplianceRecords, createComplianceRecord, updateComplianceRecord,
  getSchedulesDue, listSchedules, createSchedule, updateSchedule, deleteSchedule, type NewSchedule,
  startCooling, getActiveCooling, reachCoolingStage, discardCooling,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { evalLimit, describeLimit } from '@/lib/compliance';
import { Screen, Text, Card, Button, Notice, Badge } from '@/ui/components';
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
// Start of the current week — Monday, 00:00 local.
function startOfWeekMonday(now = new Date()): Date {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7; // days since Monday (Sun=0 → 6)
  d.setDate(d.getDate() - diff);
  return d;
}
// Lower bound for a history range filter (null = no bound / "all").
function rangeStart(range: HistoryRange): Date | null {
  const now = new Date();
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
  if (range === 'week') return startOfWeekMonday(now);
  if (range === '30d') { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 30); return d; }
  return null;
}
// Device-local calendar date (YYYY-MM-DD) — what "today" means for the user.
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

// The "unit being checked" for a corrective action: the schedule's per-unit name
// if it came from Today, else the first identifying field the user filled in.
const UNIT_KEYS = ['unit_id', 'product', 'food', 'item', 'dish', 'supplier', 'equipment', 'area'];
function identifyUnit(data: Record<string, unknown>, schedule?: ComplianceSchedule): string {
  if (schedule?.label) return schedule.label;
  for (const k of UNIT_KEYS) { const v = data[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
}
// Human summary of what the user entered — seeds the "what went wrong" text.
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
// A corrective action is "resolved" once the operator has recorded any of the
// follow-up fields — until then the failed check counts as an open issue.
function caComplete(ca?: ComplianceRecord): boolean {
  const d = ca?.data ?? {};
  return Boolean(d.action_taken || d.cause || d.prevention);
}

// ── Cooling batch helpers ────────────────────────────────────────────────────
const H2 = 2 * 3_600_000, H4 = 4 * 3_600_000;
// Current stage + deadline for a live cooling batch.
function coolingStage(b: CoolingBatch): { stage: 'stage1' | 'stage2'; label: string; deadline: number } {
  if (!b.reached_21_at) return { stage: 'stage1', label: 'Cool to 21 °C', deadline: Date.parse(b.started_at) + H2 };
  return { stage: 'stage2', label: 'Cool to 5 °C', deadline: Date.parse(b.reached_21_at) + H4 };
}
function humanDur(ms: number): string {
  const abs = Math.abs(ms), h = Math.floor(abs / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ── Styles (single source, theme-driven) ─────────────────────────────────────
function makeStyles(t: ThemeT) {
  const soft = { passBg: '#e6f4e7', passInk: t.color.success, failBg: '#fbe6e6', failInk: t.color.danger, limitBg: '#eef6ef', limitBorder: '#cfe6d1' };
  return { soft, s: StyleSheet.create({
    seg: { flexDirection: 'row', backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: 3, marginVertical: t.space.md },
    segBtn: { flex: 1, paddingVertical: t.space.sm, borderRadius: t.radius.sm, alignItems: 'center' },
    segBtnOn: { backgroundColor: t.color.surface },
    statsRow: { flexDirection: 'row' },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    statNum: { fontSize: t.size.xl, fontWeight: '800', color: t.color.primary },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.space.md },
    tile: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, padding: t.space.md, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, minHeight: 44, backgroundColor: t.color.surface },
    tilePressed: { backgroundColor: t.color.surfaceAlt },
    chip: { alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt },
    dueDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color.accent },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
    quickItem: { flexGrow: 1, flexBasis: '47%' },
    input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, minHeight: 44, fontSize: t.size.md, color: t.color.text },
    limitBox: { backgroundColor: soft.limitBg, borderWidth: 1, borderColor: soft.limitBorder, borderRadius: t.radius.md, padding: t.space.md },
    verdict: { borderRadius: t.radius.md, padding: t.space.md, flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    logItem: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm, borderBottomWidth: 1, borderBottomColor: t.color.border },
    pill: { paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderRadius: t.radius.md, borderWidth: 1, minHeight: 40, justifyContent: 'center' },
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
  }) };
}
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
    <View style={[s.chip, { width: size, height: size }]}>
      <Ionicons name={recordIcon(code, category)} size={Math.round(size * 0.5)} color={t.color.primary} />
    </View>
  );
}
function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  const { s } = useStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={[s.pill, { borderColor: active ? t.color.primary : t.color.border, backgroundColor: active ? t.color.primary : t.color.surface }]}>
      <Text variant="small" color={active ? t.color.primaryText : t.color.text}>{label}</Text>
    </Pressable>
  );
}
function TypeTile({ type, onPress }: { type: ComplianceRecordType; onPress: () => void }) {
  const t = useTheme();
  const { s } = useStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={type.label}
      style={({ pressed }) => [s.tile, pressed && s.tilePressed]}>
      <IconChip code={type.code} category={type.category} size={40} />
      <Text variant="label" style={{ flex: 1 }}>{type.label}</Text>
      <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
    </Pressable>
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
          <Pill label="Yes" active={value === true} onPress={() => onChange(true)} />
          <Pill label="No" active={value === false} onPress={() => onChange(false)} />
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
      ) : (
        <TextInput value={value as string} onChangeText={onChange}
          keyboardType={spec.type === 'number' ? 'numeric' : 'default'}
          placeholder={spec.type === 'date' ? 'YYYY-MM-DD' : ''} placeholderTextColor={t.color.textMuted} style={s.input} />
      )}
    </View>
  );
}

// ── Schedule editor (add / edit one recurring check) ─────────────────────────
function ScheduleEditor({ types, edit, onSaved, onCancel }: {
  types: ComplianceRecordType[]; edit: ComplianceSchedule | null; onSaved: () => void; onCancel: () => void;
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
    };
    try {
      const token = getAccessToken()!;
      if (edit) await updateSchedule(token, edit.id, body); else await createSchedule(token, body);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Card>
      <Text variant="heading">{edit ? 'Edit' : 'New'} scheduled check</Text>
      {err ? <Notice message={err} tone="error" /> : null}

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Check type *</Text>
        <View style={s.rowWrap}>
          {types.map((ty) => <Pill key={ty.code} label={ty.label} active={recordType === ty.code} onPress={() => setRecordType(ty.code)} />)}
        </View>
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>Name it (so staff know which one) *</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="e.g. Main chiller, Prep station" style={s.input} />
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
        <Button label={edit ? 'Save changes' : 'Add schedule'} onPress={save} loading={busy} style={{ flexGrow: 1 }} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flexGrow: 1 }} />
      </View>
    </Card>
  );
}

// ── Schedules manager ────────────────────────────────────────────────────────
function SchedulesManager({ types, typeByCode, isAdmin, onBack }: {
  types: ComplianceRecordType[]; typeByCode: Record<string, ComplianceRecordType>; isAdmin: boolean; onBack: () => void;
}) {
  const t = useTheme();
  const { s } = useStyles();
  const [schedules, setSchedules] = useState<ComplianceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState<{ edit: ComplianceSchedule | null } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setSchedules((await listSchedules(getAccessToken()!)).schedules); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    try { await deleteSchedule(getAccessToken()!, id); await load(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
  };

  return (
    <>
      <Pressable onPress={onBack} accessibilityRole="button" style={s.back}>
        <Text variant="label" color={t.color.primary}>‹ Back to Today</Text>
      </Pressable>
      <Text variant="title">Scheduled checks</Text>
      <Text muted>Recurring checks that appear on Today when they’re due.</Text>
      {msg && <Notice message={msg.text} tone={msg.tone} />}

      {loading ? <Text muted>Loading…</Text> : (
        <Card>
          {schedules.length === 0 ? <Text muted>No schedules yet. Add one below.</Text> : schedules.map((sc) => (
            <View key={sc.id} style={s.logItem}>
              <IconChip code={sc.record_type} category={typeByCode[sc.record_type]?.category} size={34} />
              <View style={s.scheduleItemMeta}>
                <Text variant="label">{sc.label}</Text>
                <Text variant="small" muted>{typeByCode[sc.record_type]?.label ?? sc.record_type} · {cadenceText(sc)}</Text>
              </View>
              {isAdmin && (
                <View style={s.scheduleItemActions}>
                  <Pressable onPress={() => setForm({ edit: sc })} accessibilityLabel="Edit"><Ionicons name="pencil" size={18} color={t.color.textMuted} /></Pressable>
                  <Pressable onPress={() => remove(sc.id)} accessibilityLabel="Delete"><Ionicons name="trash-outline" size={18} color={t.color.danger} /></Pressable>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {isAdmin && (form ? (
        <ScheduleEditor types={types} edit={form.edit} onSaved={() => { setForm(null); void load(); }} onCancel={() => setForm(null)} />
      ) : (
        <Button label="+ Add scheduled check" onPress={() => setForm({ edit: null })} />
      ))}
    </>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function Compliance() {
  const t = useTheme();
  const { s, soft } = useStyles();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  // The person logging a check is whoever is signed in on this device.
  const userName = profile?.me?.name ?? '';

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
  const [now, setNow] = useState(() => Date.now()); // ticks so cooling timers stay live

  const [editing, setEditing] = useState<Editing>(null);
  const [enteredBy, setEnteredBy] = useState('');
  const [data, setData] = useState<FormData>({});
  // A failed check leaves this set until its corrective action is completed.
  const [pendingCA, setPendingCA] = useState<{ type: ComplianceRecordType; record: ComplianceRecord } | null>(null);

  const typeByCode = useMemo(() => Object.fromEntries(types.map((x) => [x.code, x])), [types]);

  // Preserve the list's scroll position across opening/closing a form or the
  // schedules manager: remember it while browsing, jump to top on open, restore on close.
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
      const [tRes, rRes, dRes, cRes] = await Promise.all([
        getRecordTypes(token), getComplianceRecords(token), getSchedulesDue(token, todayLocal()), getActiveCooling(token),
      ]);
      setTypes(tRes.record_types);
      setRecords(rRes.records);
      setDue(dRes.due);
      setCooling(cRes.batches);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  // Keep cooling countdowns live while there are active batches.
  useEffect(() => {
    if (cooling.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [cooling.length]);

  const openForm = (type: ComplianceRecordType, record?: ComplianceRecord, schedule?: ComplianceSchedule, opts?: { required?: boolean }) => {
    setEditing({ type, record, schedule, required: opts?.required });
    setEnteredBy(record?.entered_by ?? userName);
    setData(initData(type.field_schema, record));
    setMsg(null);
  };
  const openByCode = (code: string) => { const ty = typeByCode[code]; if (ty) openForm(ty); };

  const save = async () => {
    if (!editing) return;
    const { type, record, schedule, required } = editing;
    if (!enteredBy.trim()) { setMsg({ text: 'Your name/initials are required.', tone: 'error' }); return; }
    const missing = type.field_schema.find((f) => f.required && (data[f.key] === '' || data[f.key] === undefined));
    if (missing) { setMsg({ text: `${missing.label} is required.`, tone: 'error' }); return; }
    // A blocking corrective action isn't done until the operator records what they did.
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
        // Completing the corrective action clears the block + outstanding banner.
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
          // Failed check → open its corrective action IMMEDIATELY, pre-filled with
          // the unit + what was entered, and don't let the user leave until it's done.
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
          openForm(caType, enriched, undefined, { required: true }); // opens the CA; no cancel
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

  // Corrective actions are reached THROUGH their check, not shown as their own
  // history rows. Index them by id and hide the ones a check links to.
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

  // Open the corrective action linked to a failed check (pre-filled from it).
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

  // Open a corrective action for mandatory completion (used by cooling fail/discard).
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
  // Open issues = failed checks whose corrective action isn't resolved yet.
  const issuesOpen = records.filter((r) => r.result === 'fail' && !caComplete(caById[r.corrective_action_id ?? ''])).length;
  const dueDone = due.filter((d) => d.remaining === 0).length;

  const grouped = useMemo(() => {
    const g: Record<string, ComplianceRecordType[]> = {};
    for (const ty of types) (g[ty.category ?? 'other'] ??= []).push(ty);
    return g;
  }, [types]);

  // ── Form ───────────────────────────────────────────────────────────────────
  const renderForm = (ed: NonNullable<Editing>) => {
    const { type, record, schedule, required } = ed;
    const payload = toPayload(type.field_schema, data);
    const verdict = type.critical_limit ? evalLimit(type.critical_limit, payload) : 'na';
    const limitText = describeLimit(type.critical_limit, type.field_schema);
    return (
      <Card>
        <View style={s.formHeader}>
          <View style={s.formHeaderMain}>
            <IconChip code={type.code} category={type.category} size={36} />
            <Text variant="heading" style={{ flex: 1 }}>
              {record ? 'Edit' : 'New'}: {type.label}{schedule ? ` — ${schedule.label}` : ''}
            </Text>
          </View>
          {/* No escape from a required corrective action — it must be recorded. */}
          {!required && <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />}
        </View>

        {required && (
          <View style={s.limitBox}>
            <Text variant="small" color={soft.failInk}>This check failed — record the corrective action below to continue.</Text>
          </View>
        )}

        {limitText && (
          <View style={s.limitBox}><Text variant="small" color={soft.passInk}>Critical limit: {limitText}</Text></View>
        )}

        <View style={s.fieldGroup}>
          <Text variant="label" muted>Name *</Text>
          <TextInput value={enteredBy} onChangeText={setEnteredBy} placeholder="Who did this check?" placeholderTextColor={t.color.textMuted} style={s.input} />
        </View>

        {type.field_schema.map((f) => (
          <Field key={f.key} spec={f} value={data[f.key]} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} />
        ))}

        {verdict !== 'na' && (
          <View style={[s.verdict, { backgroundColor: verdict === 'pass' ? soft.passBg : soft.failBg }]}>
            <Ionicons name={verdict === 'pass' ? 'checkmark-circle' : 'alert-circle'} size={20} color={verdict === 'pass' ? soft.passInk : soft.failInk} />
            <Text variant="label" color={verdict === 'pass' ? soft.passInk : soft.failInk} style={{ flex: 1 }}>
              {verdict === 'pass' ? 'Within limit' : 'Outside the limit — saving this will raise a corrective action.'}
            </Text>
          </View>
        )}

        <Button label={record ? 'Update record' : 'Save record'} onPress={save} loading={busy} />
      </Card>
    );
  };

  // ── Today ────────────────────────────────────────────────────────────────
  const renderToday = () => (
    <>
      <Card>
        <View style={s.statsRow}>
          <View style={s.stat}><Text style={s.statNum}>{dueDone}/{due.length}</Text><Text variant="small" muted>Checks done</Text></View>
          <View style={s.stat}><Text style={s.statNum}>{entriesToday}</Text><Text variant="small" muted>Today</Text></View>
          <View style={s.stat}><Text style={[s.statNum, { color: issuesOpen ? t.color.danger : t.color.success }]}>{issuesOpen}</Text><Text variant="small" muted>Issues open</Text></View>
        </View>
      </Card>

      {(cooling.length > 0 || showCoolingStart) && (
        <>
          <Text variant="heading" style={{ marginTop: t.space.md }}>Cooling in progress</Text>
          {showCoolingStart && (
            <Card>
              <View style={s.fieldGroup}>
                <Text variant="label" muted>What’s cooling? *</Text>
                <TextInput value={coolingProduct} onChangeText={setCoolingProduct} placeholder="e.g. Beef curry" placeholderTextColor={t.color.textMuted} style={s.input} />
              </View>
              <View style={s.rowWrap}>
                <Button label="Start cooling clock" onPress={startCoolingBatch} loading={busy} style={{ flexGrow: 1 }} />
                <Button label="Cancel" variant="ghost" onPress={() => { setShowCoolingStart(false); setCoolingProduct(''); }} style={{ flexGrow: 1 }} />
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
                  <Button label={st.stage === 'stage1' ? 'Reached 21 °C' : 'Reached 5 °C — done'} onPress={() => reachStage(b)} loading={busy} style={{ flexGrow: 1 }} />
                  <Button label="Report a problem" variant="danger" onPress={() => discardBatch(b)} loading={busy} style={{ flexGrow: 1 }} />
                </View>
              </Card>
            );
          })}
        </>
      )}

      <View style={s.sectionRow}>
        <Text variant="heading">Checks due today</Text>
        {isAdmin && (
          <Pressable onPress={() => setManage(true)} accessibilityRole="button">
            <Text variant="label" color={t.color.primary}>Manage</Text>
          </Pressable>
        )}
      </View>

      {loading ? <Text muted>Loading…</Text>
        : due.length === 0 ? (
          <Card>
            <Text muted>Nothing scheduled for today.</Text>
            {isAdmin && <Button label="Set up scheduled checks" variant="ghost" onPress={() => setManage(true)} style={{ marginTop: t.space.sm }} />}
          </Card>
        ) : due.map(({ schedule: sc, done_count, remaining }) => {
          const ty = typeByCode[sc.record_type];
          const done = remaining === 0;
          return (
            <Pressable key={sc.id} onPress={() => ty && openForm(ty, undefined, sc)} accessibilityRole="button"
              style={({ pressed }) => [s.tile, pressed && s.tilePressed]}>
              <IconChip code={sc.record_type} category={ty?.category} size={40} />
              <View style={{ flex: 1 }}>
                <Text variant="label">{sc.label}</Text>
                <Text variant="small" muted>{ty?.label ?? sc.record_type}{sc.times_per_day > 1 ? ` · ${done_count}/${sc.times_per_day}` : ''}</Text>
              </View>
              {done ? <Text variant="small" color={t.color.success}>✓ Done</Text> : <View style={s.dueDot} />}
            </Pressable>
          );
        })}

      <Text variant="heading" style={{ marginTop: t.space.md }}>Quick add</Text>
      <View style={s.quickGrid}>
        {typeByCode['cooking_poultry_mince_liver'] && <View style={s.quickItem}><Button label="Log a cook" onPress={() => openByCode('cooking_poultry_mince_liver')} /></View>}
        <View style={s.quickItem}><Button label="Start cooling" onPress={() => setShowCoolingStart(true)} /></View>
        {typeByCode['receiving'] && <View style={s.quickItem}><Button label="Log a delivery" onPress={() => openByCode('receiving')} /></View>}
        {typeByCode['corrective_action'] && <View style={s.quickItem}><Button label="Log an issue" onPress={() => openByCode('corrective_action')} /></View>}
        <View style={s.quickItem}><Button label="All records" variant="ghost" onPress={() => setTab('records')} /></View>
      </View>
    </>
  );

  const renderRecords = () => (
    loading ? <Text muted>Loading…</Text> : (
      <>
        {Object.entries(grouped).map(([cat, list]) => (
          <View key={cat} style={s.categoryGroup}>
            <Text variant="small" muted style={s.categoryLabel}>{cat}</Text>
            {list.map((ty) => <TypeTile key={ty.code} type={ty} onPress={() => openForm(ty)} />)}
          </View>
        ))}
      </>
    )
  );

  const renderHistory = () => {
    const start = rangeStart(historyRange);
    const shown = start ? historyRecords.filter((r) => new Date(r.datetime) >= start) : historyRecords;
    return (
      <>
        <View style={s.rowWrap}>
          {RANGE_OPTS.map(([k, label]) => (
            <Pill key={k} label={label} active={historyRange === k} onPress={() => setHistoryRange(k)} />
          ))}
        </View>
        {loading ? <Text muted>Loading…</Text>
          : historyRecords.length === 0 ? <Card><Text muted>No records yet — log a check from Today or Records.</Text></Card>
          : shown.length === 0 ? <Card><Text muted>No records in this range.</Text></Card>
          : (
        <>
          <Card>
            {shown.map((r) => {
              const ty = typeByCode[r.record_type];
              const hasCa = r.result === 'fail' && !!r.corrective_action_id;
              const caDone = caComplete(caById[r.corrective_action_id ?? '']);
              return (
                // Row is a View, not a Pressable — the check-tap and the corrective
                // action button are SIBLING pressables (nested <button> is invalid on web).
                <View key={r.id} style={s.logItem}>
                  <Pressable onPress={() => ty && openForm(ty, r)} accessibilityRole="button"
                    style={s.historyLogRow}>
                    <IconChip code={r.record_type} category={ty?.category} size={34} />
                    <View style={s.historyLogInfo}>
                      <Text variant="label">{ty?.label ?? r.record_type}</Text>
                      <Text variant="small" muted>{r.entered_by} · {formatDate(r.datetime)}</Text>
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
            })}
          </Card>
          <Button label="Export for verifier (PDF)" variant="ghost" onPress={() => setMsg({ text: 'Verifier PDF export is coming soon.', tone: 'info' })} />
        </>
          )}
      </>
    );
  };

  return (
    <Screen scrollRef={scrollRef} onScroll={(e) => { if (!overlay) scrollYRef.current = e.nativeEvent.contentOffset.y; }}>
      {msg && <Notice message={msg.text} tone={msg.tone} />}

      {pendingCA && !editing && (
        <Card style={s.pendingCAAlert}>
          <View style={s.pendingCAContainer}>
            <Ionicons name="alert-circle" size={22} color={t.color.danger} />
            <Text variant="label" color={t.color.danger} style={{ flex: 1 }}>A check failed — a corrective action is waiting.</Text>
          </View>
          <Button label="Complete corrective action →" onPress={() => openForm(pendingCA.type, pendingCA.record)} />
        </Card>
      )}

      {editing ? renderForm(editing)
        : manage ? <SchedulesManager types={types} typeByCode={typeByCode} isAdmin={isAdmin} onBack={() => { setManage(false); void load(); }} />
        : (
          <>
            <View style={s.seg}>
              {(['today', 'records', 'history'] as Tab[]).map((k) => (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="button" accessibilityState={{ selected: tab === k }}
                  style={[s.segBtn, tab === k && s.segBtnOn]}>
                  <Text variant="label" color={tab === k ? t.color.primary : t.color.textMuted}>
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
