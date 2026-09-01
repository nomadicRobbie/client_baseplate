import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PersonUnavailability, UnavailabilityKind } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listUnavailability, addUnavailability, removeUnavailability, getMyPerson } from '@/lib/api';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, Button, Badge, TextField } from '@/ui/components';
import { DateField } from '@/ui/date-field';

// Crew declare the days they cannot work. No row means available — asking
// everyone to confirm positive availability every week is far more work for the
// same answer. Phase 2 reads these when generating the weekly roster.

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };
type Scope = 'mine' | 'team';

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill, padding: 4 },
  segBtn: { flex: 1, minHeight: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.pill },
  segBtnOn: { backgroundColor: t.color.primary },
  form: { gap: t.space.md },
  kindRow: { flexDirection: 'row' as const, gap: t.space.sm },
  kindBtn: (on: boolean) => ({
    flex: 1, minHeight: 44, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: t.space.xs,
    borderRadius: t.radius.md, borderWidth: 1,
    borderColor: on ? t.color.primary : t.color.border,
    backgroundColor: on ? t.color.primary : 'transparent',
  }),
  rowBody: { flex: 1, gap: 2 },
  rowMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
  addWrap: { gap: t.space.md },
});

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Days off are only interesting from today forward — past ones are history the
// roster has already accounted for.
const WINDOW_DAYS = 180;

export default function UnavailabilityScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [scope, setScope] = useState<Scope>('mine');
  const [rows, setRows] = useState<PersonUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);

  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [kind, setKind] = useState<UnavailabilityKind>('planned');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const from = todayStr();
  const to = useMemo(() => addDays(from, WINDOW_DAYS), [from]);

  // Admins see everyone by default, so "Mine" needs their own person id to filter
  // by. Members are scoped server-side and never need it.
  const [myPersonId, setMyPersonId] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const { person } = await getMyPerson(getAccessToken()!);
        setMyPersonId(person?.id ?? null);
      } catch { /* an admin with no person row just gets the team view */ }
    })();
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const personId = isAdmin && scope === 'mine' ? myPersonId ?? undefined : undefined;
      const r = await listUnavailability(getAccessToken()!, from, to, personId);
      setRows(r.unavailability);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [from, to, isAdmin, scope, myPersonId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!date) { setMsg({ text: 'Pick a date first.', tone: 'error' }); return; }
    setSaving(true);
    try {
      await addUnavailability(getAccessToken()!, { date, kind, reason: reason.trim() || null });
      setAdding(false);
      setReason('');
      setKind('planned');
      setDate(todayStr());
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await removeUnavailability(getAccessToken()!, id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  // The server has already scoped the rows — members to themselves, admins to
  // whichever person_id the load asked for.
  const visible = rows;

  // An admin with no person row of their own has nothing to show under "Mine".
  const showScope = isAdmin && myPersonId !== null;

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.replace('/dashboard/roster')} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Roster</Text>
      </Pressable>

      <View style={s.header}>
        <Text variant="title">Days off</Text>
        {!adding && <Button label="Add day off" onPress={() => setAdding(true)} />}
      </View>

      <Text variant="body" muted>
        Add the days you can&apos;t work. Anything not listed counts as available.
      </Text>

      {adding && (
        <Card>
          <View style={s.form}>
            <Text variant="label">New day off</Text>

            <DateField label="Date" value={date} onChange={setDate} />

            <View style={{ gap: t.space.xs }}>
              <Text variant="label" muted>Type</Text>
              <View style={s.kindRow}>
                {([
                  { k: 'planned' as const, label: 'Planned leave', icon: 'calendar-outline' as const },
                  { k: 'sick' as const, label: 'Sick', icon: 'medkit-outline' as const },
                ]).map(o => (
                  <Pressable
                    key={o.k}
                    onPress={() => setKind(o.k)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kind === o.k }}
                    style={s.kindBtn(kind === o.k)}
                  >
                    <Ionicons name={o.icon} size={16} color={kind === o.k ? t.color.bg : t.color.textMuted} />
                    <Text variant="small" color={kind === o.k ? t.color.bg : t.color.text}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <TextField
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="Only if it helps whoever covers"
            />

            <Button label="Save" onPress={save} loading={saving} />
            <Button variant="ghost" label="Cancel" onPress={() => { setAdding(false); setReason(''); }} />
          </View>
        </Card>
      )}

      {showScope && (
        <View style={s.seg}>
          {(['mine', 'team'] as Scope[]).map(sc => (
            <Pressable
              key={sc}
              onPress={() => setScope(sc)}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === sc }}
              style={[s.segBtn, scope === sc && s.segBtnOn]}
            >
              <Text variant="small" color={scope === sc ? t.color.bg : t.color.text}>
                {sc === 'mine' ? 'Mine' : 'Team'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : visible.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="today-outline" size={32} color={t.color.textMuted} />
          <Text muted>
            {showScope && scope === 'team' ? 'Nobody has logged a day off.' : 'No days off logged.'}
          </Text>
        </View>
      ) : (
        <GroupedCard>
          {visible.map((r, i) => (
            <GRow key={r.id} last={i === visible.length - 1}>
              <View style={s.rowBody}>
                <Text variant="label">{formatDMY(r.date)}</Text>
                <View style={s.rowMeta}>
                  {isAdmin && scope === 'team' ? <Text variant="small" muted>{r.person_name}</Text> : null}
                  <Badge label={r.kind === 'sick' ? 'Sick' : 'Planned'} tone={r.kind === 'sick' ? 'accent' : 'neutral'} />
                </View>
                {r.reason ? <Text variant="small" muted>{r.reason}</Text> : null}
              </View>
              <Pressable
                onPress={() => remove(r.id)}
                disabled={busyId === r.id}
                accessibilityRole="button"
                accessibilityLabel={`Remove day off on ${formatDMY(r.date)}`}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={22}
                  color={busyId === r.id ? t.color.textMuted : t.color.danger}
                />
              </Pressable>
            </GRow>
          ))}
        </GroupedCard>
      )}
    </Screen>
  );
}
