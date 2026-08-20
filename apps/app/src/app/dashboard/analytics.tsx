import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import type { WebTrafficOverview } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { getAnalyticsOverview } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Notice } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;

const makeStyles = (t: ThemeT) => ({
  chartContainer: { gap: t.space.sm },
  chartBarFill: (value: number, max: number) => ({
    width: '100%' as const, maxWidth: 44,
    height: `${Math.max(2, (value / max) * 100)}%` as const,
    backgroundColor: value === 0 ? t.color.border : t.color.primary,
    borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3,
  }),
  rangePill: (sel: boolean) => ({
    paddingVertical: t.space.xs, paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill, borderWidth: 1,
    borderColor: sel ? t.color.primary : t.color.border,
    backgroundColor: sel ? t.color.primary : 'transparent',
  }),
  chartLabels: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  chartBars: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, height: 132 },
  chartBar: { flex: 1, alignItems: 'center' as const, justifyContent: 'flex-end' as const, height: '100%' as const, gap: 3 },
  chartValue: { fontSize: 11 },
  chartDateRow: { flexDirection: 'row' as const },
  chartDateLabel: { flex: 1, fontSize: 10, textAlign: 'center' as const },
  chartDateRange: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  chartDateText: { fontSize: 10 },
  statCard: { flex: 1, minWidth: 140 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  headerButtons: { flexDirection: 'row' as const, gap: t.space.xs },
  statsGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.lg },
  listRow: { flexDirection: 'row' as const, gap: t.space.md, paddingVertical: t.space.xs },
  listRowText: { flex: 1 },
});

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

function fromDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Lightweight bar chart — plain Views, no chart dependency.
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function BarChart({ data }: { data: { date: string; value: number }[] }) {
  const t = useTheme();
  const s = makeStyles(t);
  if (data.length === 0) return <Text muted>No data in this period.</Text>;

  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  // Per-bar value + date labels only read well when the range is short; for
  // longer ranges show a start→end date axis instead of crowding every bar.
  const sparse = data.length <= 14;
  const gap = data.length > 30 ? 1 : data.length > 10 ? 3 : 6;

  return (
    <View style={s.chartContainer}>
      <View style={s.chartLabels}>
        <Text variant="small" muted>peak {max}/day</Text>
        <Text variant="small" muted>{total.toLocaleString()} total</Text>
      </View>

      <View style={[s.chartBars, { gap }]}>
        {data.map((d, i) => (
          <View key={`${d.date}-${i}`} style={s.chartBar}>
            {sparse && <Text variant="small" muted style={s.chartValue}>{d.value}</Text>}
            <View
              accessibilityLabel={`${d.date}: ${d.value}`}
              style={s.chartBarFill(d.value, max)}
            />
          </View>
        ))}
      </View>

      {sparse ? (
        <View style={[s.chartDateRow, { gap }]}>
          {data.map((d, i) => (
            <Text key={`${d.date}-l-${i}`} variant="small" muted numberOfLines={1} style={s.chartDateLabel}>
              {shortDay(d.date)}
            </Text>
          ))}
        </View>
      ) : (
        <View style={s.chartDateRange}>
          <Text variant="small" muted style={s.chartDateText}>{shortDay(data[0].date)}</Text>
          <Text variant="small" muted style={s.chartDateText}>{shortDay(data[data.length - 1].date)}</Text>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <Card style={s.statCard}>
      <Text variant="small" muted>{label}</Text>
      <Text variant="title">{value.toLocaleString()}</Text>
    </Card>
  );
}

export default function Analytics() {
  const t = useTheme();
  const s = makeStyles(t);
  const { data } = useProfile();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';

  const [days, setDays] = useState<number>(30);
  const [overview, setOverview] = useState<WebTrafficOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async (d: number) => {
    setLoading(true); setErr(null);
    try {
      const res = await getAnalyticsOverview(getAccessToken()!, { from: fromDate(d) });
      setOverview(res.overview);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(days); }, [days]);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  return (
    <Screen>
      <View style={s.header}>
        <Text variant="title">Analytics</Text>
        <View style={s.headerButtons}>
          {RANGES.map((r) => {
            const sel = r.days === days;
            return (
              <Pressable
                key={r.label}
                onPress={() => setDays(r.days)}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                style={s.rangePill(sel)}
              >
                <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading && <Text muted>Loading…</Text>}
      {err && <Notice message={err} tone="error" />}

      {overview && !loading && (
        <>
          <View style={s.statsGrid}>
            <Stat label="PAGE VIEWS" value={overview.page_views} />
            <Stat label="UNIQUE VISITORS" value={overview.unique_visitors} />
            <Stat label="SESSIONS" value={overview.sessions} />
          </View>

          <Card>
            <Text variant="heading">Page views / day</Text>
            <BarChart data={overview.timeseries.map((p) => ({ date: p.date, value: p.page_views }))} />
          </Card>

          <Card>
            <Text variant="heading">Top pages</Text>
            {overview.top_pages.length === 0
              ? <Text muted>No page views yet.</Text>
              : overview.top_pages.map((p, i) => (
                <View key={`${p.url}-${i}`} style={s.listRow}>
                  <Text style={s.listRowText} numberOfLines={1}>{p.url}</Text>
                  <Text variant="mono" muted>{p.views}</Text>
                </View>
              ))}
          </Card>

          <Card>
            <Text variant="heading">Top referrers</Text>
            {overview.top_referrers.length === 0
              ? <Text muted>No referrers yet.</Text>
              : overview.top_referrers.map((r, i) => (
                <View key={`${r.referrer}-${i}`} style={s.listRow}>
                  <Text style={s.listRowText} numberOfLines={1}>{r.referrer}</Text>
                  <Text variant="mono" muted>{r.count}</Text>
                </View>
              ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
