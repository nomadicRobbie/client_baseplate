import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect } from 'expo-router';
import type { WebTrafficOverview } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { getAnalyticsOverview } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Notice } from '@/ui/components';

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
  if (data.length === 0) return <Text muted>No data in this period.</Text>;

  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  // Per-bar value + date labels only read well when the range is short; for
  // longer ranges show a start→end date axis instead of crowding every bar.
  const sparse = data.length <= 14;
  const gap = data.length > 30 ? 1 : data.length > 10 ? 3 : 6;

  return (
    <View style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="small" muted>peak {max}/day</Text>
        <Text variant="small" muted>{total.toLocaleString()} total</Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap, height: 132 }}>
        {data.map((d, i) => (
          <View key={`${d.date}-${i}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 3 }}>
            {sparse && <Text variant="small" muted style={{ fontSize: 11 }}>{d.value}</Text>}
            <View
              accessibilityLabel={`${d.date}: ${d.value}`}
              style={{
                width: '100%', maxWidth: 44,
                height: `${Math.max(2, (d.value / max) * 100)}%`,
                backgroundColor: d.value === 0 ? t.color.border : t.color.primary,
                borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3,
              }}
            />
          </View>
        ))}
      </View>

      {sparse ? (
        <View style={{ flexDirection: 'row', gap }}>
          {data.map((d, i) => (
            <Text key={`${d.date}-l-${i}`} variant="small" muted numberOfLines={1} style={{ flex: 1, fontSize: 10, textAlign: 'center' }}>
              {shortDay(d.date)}
            </Text>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" muted style={{ fontSize: 10 }}>{shortDay(data[0].date)}</Text>
          <Text variant="small" muted style={{ fontSize: 10 }}>{shortDay(data[data.length - 1].date)}</Text>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <Text variant="small" muted>{label}</Text>
      <Text variant="title">{value.toLocaleString()}</Text>
    </Card>
  );
}

export default function Analytics() {
  const t = useTheme();
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: t.space.sm }}>
        <Text variant="title">Analytics</Text>
        <View style={{ flexDirection: 'row', gap: t.space.xs }}>
          {RANGES.map((r) => {
            const sel = r.days === days;
            return (
              <Pressable
                key={r.label}
                onPress={() => setDays(r.days)}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                style={{
                  paddingVertical: t.space.xs, paddingHorizontal: t.space.md,
                  borderRadius: t.radius.pill, borderWidth: 1,
                  borderColor: sel ? t.color.primary : t.color.border,
                  backgroundColor: sel ? t.color.primary : 'transparent',
                }}
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.lg }}>
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
                <View key={`${p.url}-${i}`} style={{ flexDirection: 'row', gap: t.space.md, paddingVertical: t.space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.color.border }}>
                  <Text style={{ flex: 1 }} numberOfLines={1}>{p.url}</Text>
                  <Text variant="mono" muted>{p.views}</Text>
                </View>
              ))}
          </Card>

          <Card>
            <Text variant="heading">Top referrers</Text>
            {overview.top_referrers.length === 0
              ? <Text muted>No referrers yet.</Text>
              : overview.top_referrers.map((r, i) => (
                <View key={`${r.referrer}-${i}`} style={{ flexDirection: 'row', gap: t.space.md, paddingVertical: t.space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.color.border }}>
                  <Text style={{ flex: 1 }} numberOfLines={1}>{r.referrer}</Text>
                  <Text variant="mono" muted>{r.count}</Text>
                </View>
              ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
