import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect } from 'expo-router';
import type { WebTrafficOverview } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { getAnalyticsOverview } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel, Notice } from '@/ui/components';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

function fromDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function RangePicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.color.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, overflow: 'hidden' }}>
      {RANGES.map((r, i) => {
        const sel = r.days === days;
        return (
          <Pressable
            key={r.label}
            onPress={() => onChange(r.days)}
            accessibilityRole="button"
            accessibilityState={{ selected: sel }}
            style={{
              flex: 1, paddingVertical: t.space.sm, alignItems: 'center',
              backgroundColor: sel ? t.color.primary : 'transparent',
              borderRightWidth: i < RANGES.length - 1 ? 1 : 0,
              borderColor: t.color.border,
            }}
          >
            <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{r.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BarChart({ data }: { data: { date: string; value: number }[] }) {
  const t = useTheme();
  if (data.length === 0) return (
    <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.md }}>
      <Text muted>No data in this period.</Text>
    </View>
  );

  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = data.length > 30 ? 1 : data.length > 10 ? 3 : 6;

  return (
    <View style={{ gap: t.space.sm, paddingHorizontal: t.space.lg, paddingVertical: t.space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap }}>
        {data.map((d, i) => (
          <View key={`${d.date}-${i}`} style={{ flex: 1, justifyContent: 'flex-end', height: '100%' }}>
            <View
              accessibilityLabel={`${d.date}: ${d.value}`}
              style={{
                width: '100%',
                height: `${Math.max(2, (d.value / max) * 100)}%` as `${number}%`,
                backgroundColor: d.value === 0 ? t.color.border : t.color.primary,
                borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="small" muted>{shortDay(data[0].date)}</Text>
        <Text variant="small" muted>{shortDay(data[data.length - 1].date)}</Text>
      </View>
    </View>
  );
}

export default function Analytics() {
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

  const peak = overview ? Math.max(0, ...overview.timeseries.map(p => p.page_views)) : 0;

  return (
    <Screen>
      <RangePicker days={days} onChange={setDays} />

      {err && <Notice message={err} tone="error" />}
      {loading && <Text muted>Loading…</Text>}

      {overview && !loading && (
        <>
          <SectionLabel>Overview</SectionLabel>
          <GroupedCard>
            <GRow>
              <Text variant="label" style={{ flex: 1 }}>Page views</Text>
              <Text variant="heading">{overview.page_views.toLocaleString()}</Text>
            </GRow>
            <GRow>
              <Text variant="label" style={{ flex: 1 }}>Unique visitors</Text>
              <Text variant="heading">{overview.unique_visitors.toLocaleString()}</Text>
            </GRow>
            <GRow last>
              <Text variant="label" style={{ flex: 1 }}>Sessions</Text>
              <Text variant="heading">{overview.sessions.toLocaleString()}</Text>
            </GRow>
          </GroupedCard>

          <SectionLabel right={<Text variant="small" muted>peak {peak.toLocaleString()}</Text>}>
            Views per day
          </SectionLabel>
          <GroupedCard>
            <BarChart data={overview.timeseries.map((p) => ({ date: p.date, value: p.page_views }))} />
          </GroupedCard>

          {overview.top_pages.length > 0 && (
            <>
              <SectionLabel>Top pages</SectionLabel>
              <GroupedCard>
                {overview.top_pages.map((p, i) => (
                  <GRow key={`${p.url}-${i}`} last={i === overview.top_pages.length - 1}>
                    <Text style={{ flex: 1 }} numberOfLines={1}>{p.url}</Text>
                    <Text variant="mono" muted>{p.views.toLocaleString()}</Text>
                  </GRow>
                ))}
              </GroupedCard>
            </>
          )}

          {overview.top_referrers.length > 0 && (
            <>
              <SectionLabel>Top referrers</SectionLabel>
              <GroupedCard>
                {overview.top_referrers.map((r, i) => (
                  <GRow key={`${r.referrer}-${i}`} last={i === overview.top_referrers.length - 1}>
                    <Text style={{ flex: 1 }} numberOfLines={1}>{r.referrer}</Text>
                    <Text variant="mono" muted>{r.count.toLocaleString()}</Text>
                  </GRow>
                ))}
              </GroupedCard>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
