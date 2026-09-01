import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Roster, RosterRules } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listRosters, generateRoster, getRosterRules, updateRosterRules } from '@/lib/api';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, Button, Badge, Notice } from '@/ui/components';
import { DateField } from '@/ui/date-field';

// Roster index. Admins see every week and generate new ones; crew reach their own
// shifts through the week they belong to. Nothing here is live until published —
// generating and editing a draft touches no service the rest of the app reads.

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  rowBody: { flex: 1, gap: 3 },
  rowMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
  form: { gap: t.space.md },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
  link: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  rulesRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  rulesInput: { width: 56, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.sm, color: t.color.text, fontSize: 14, textAlign: 'center' as const },
});

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  // getDay: 0=Sun. Shift back to Monday, treating Sunday as the end of its week.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return mondayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

// "Week of 2 Mar" reads better in a list than a raw date range.
function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function RosterScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [rosters, setRosters] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);

  const [generating, setGenerating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [week, setWeek] = useState(nextMonday());
  const [rules, setRules] = useState<RosterRules | null>(null);
  const [editRest, setEditRest] = useState('');
  const [editDays, setEditDays] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const tok = getAccessToken()!;
      const [r, rulesRes] = await Promise.all([
        listRosters(tok),
        getRosterRules(tok),
      ]);
      setRosters(r.rosters);
      setRules(rulesRes.rules);
      setEditRest(String(rulesRes.rules.min_rest_hours));
      setEditDays(String(rulesRes.rules.max_consecutive_days));
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await generateRoster(getAccessToken()!, week);
      setPicking(false);
      router.push({ pathname: '/dashboard/roster/[rosterId]', params: { rosterId: r.roster.id } });
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const saveRules = async () => {
    const rest = parseInt(editRest, 10);
    const days = parseInt(editDays, 10);
    if (isNaN(rest) || rest < 0 || rest > 48) { setMsg({ text: 'Rest hours must be 0–48', tone: 'error' }); return; }
    if (isNaN(days) || days < 1 || days > 14) { setMsg({ text: 'Max days must be 1–14', tone: 'error' }); return; }
    setSavingRules(true);
    try {
      const r = await updateRosterRules(getAccessToken()!, { min_rest_hours: rest, max_consecutive_days: days });
      setRules(r.rules);
      setMsg({ text: 'Rules updated.', tone: 'success' });
      setShowRules(false);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setSavingRules(false);
    }
  };

  const rulesChanged = rules && (editRest !== String(rules.min_rest_hours) || editDays !== String(rules.max_consecutive_days));

  const daysOffLink = (
    <Card>
      <Pressable
        onPress={() => router.push('/dashboard/roster/unavailability')}
        accessibilityRole="button"
        style={s.link}
      >
        <Ionicons name="today-outline" size={18} color={t.color.primary} />
        <View style={s.rowBody}>
          <Text variant="label">Days off</Text>
          <Text variant="small" muted>Tell the roster when you can&apos;t work</Text>
        </View>
        <Ionicons name="chevron-forward-outline" size={16} color={t.color.textMuted} />
      </Pressable>
    </Card>
  );

  // Crew don't generate rosters — they reach their shifts from the week list an
  // admin published, so this screen is just their way in.
  if (!isAdmin) {
    return (
      <Screen toast={msg} onDismissToast={() => setMsg(null)}>
        <Text variant="title">Roster</Text>
        {daysOffLink}
        <Notice
          tone="info"
          message="Your shifts appear here once an admin publishes the roster for that week."
        />
      </Screen>
    );
  }

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.header}>
        <Text variant="title">Roster</Text>
        {!picking && <Button label="Generate week" onPress={() => setPicking(true)} />}
      </View>

      {daysOffLink}

      {rules && (
        <Card>
          <Pressable
            onPress={() => setShowRules(v => !v)}
            accessibilityRole="button"
            style={s.link}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={t.color.primary} />
            <View style={s.rowBody}>
              <Text variant="label">Roster rules</Text>
              <Text variant="small" muted>
                Min {rules.min_rest_hours}h rest · Max {rules.max_consecutive_days} days in 7
              </Text>
            </View>
            <Ionicons name={showRules ? 'chevron-up-outline' : 'chevron-down-outline'} size={16} color={t.color.textMuted} />
          </Pressable>

          {showRules && (
            <View style={{ gap: t.space.md, paddingTop: t.space.md }}>
              <View style={s.rulesRow}>
                <Text variant="body">Min rest between shifts</Text>
                <TextInput
                  value={editRest}
                  onChangeText={setEditRest}
                  keyboardType="numeric"
                  style={s.rulesInput}
                />
                <Text variant="small" muted>hours</Text>
              </View>
              <View style={s.rulesRow}>
                <Text variant="body">Max days in a 7-day window</Text>
                <TextInput
                  value={editDays}
                  onChangeText={setEditDays}
                  keyboardType="numeric"
                  style={s.rulesInput}
                />
                <Text variant="small" muted>days</Text>
              </View>
              {rulesChanged && (
                <Button label="Save rules" onPress={saveRules} loading={savingRules} />
              )}
              <Text variant="small" muted>
                These rules determine who can be rostered. Admins can still override
                rules for individual shifts when needed — overrides are flagged on the roster.
              </Text>
            </View>
          )}
        </Card>
      )}

      {picking && (
        <Card>
          <View style={s.form}>
            <Text variant="label">Generate a roster</Text>
            <Text variant="small" muted>
              Crew are worked out from whoever is assigned to each service&apos;s asset, skipping
              anyone who&apos;s off or already booked. Nothing goes live until you publish it.
            </Text>
            <DateField label="Any day in the week" value={week} onChange={v => setWeek(mondayOf(v))} />
            <Text variant="small" muted>Week of {weekLabel(week)}</Text>
            <Button label="Generate" onPress={generate} loading={generating} />
            <Button variant="ghost" label="Cancel" onPress={() => setPicking(false)} />
          </View>
        </Card>
      )}

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : rosters.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="people-circle-outline" size={32} color={t.color.textMuted} />
          <Text muted>No rosters yet.</Text>
        </View>
      ) : (
        <GroupedCard>
          {rosters.map((r, i) => (
            <GRow key={r.id} last={i === rosters.length - 1}>
              <Pressable
                onPress={() => router.push({ pathname: '/dashboard/roster/[rosterId]', params: { rosterId: r.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Roster for week of ${formatDMY(r.week_start)}`}
                style={s.link}
              >
                <View style={s.rowBody}>
                  <Text variant="label">{weekLabel(r.week_start)}</Text>
                  <View style={s.rowMeta}>
                    <Badge
                      label={r.status === 'published' ? 'Published' : 'Draft'}
                      tone={r.status === 'published' ? 'success' : 'neutral'}
                    />
                  </View>
                </View>
                <Ionicons name="chevron-forward-outline" size={16} color={t.color.textMuted} />
              </Pressable>
            </GRow>
          ))}
        </GroupedCard>
      )}
    </Screen>
  );
}
