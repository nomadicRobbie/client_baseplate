import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import type { ScheduledService } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listServices } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Badge } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };
type Tab = 'upcoming' | 'today';

const STATUS_COLOR: Record<string, string> = {
  draft: 'neutral', planned: 'neutral', confirmed: 'success', completed: 'neutral', cancelled: 'neutral',
};

const makeStyles = (t: ThemeT) => ({
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill, padding: 4, marginBottom: t.space.sm },
  segBtn: { flex: 1, minHeight: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.pill },
  segBtnOn: { backgroundColor: t.color.primary },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  serviceRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: t.space.sm },
  serviceBody: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, alignItems: 'center' as const },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
  calendarWrap: { borderRadius: t.radius.md, overflow: 'hidden' as const, marginBottom: t.space.sm },
  dayLabel: { marginTop: t.space.md, marginBottom: t.space.xs },
});

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoWindow(tab: Tab): { from: string; to: string } {
  const today = todayStr();
  if (tab === 'today') {
    return { from: `${today}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` };
  }
  // upcoming: today through next 60 days
  const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: `${today}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
}

function ServiceCard({ svc, router, s, t }: { svc: ScheduledService; router: ReturnType<typeof useRouter>; s: ReturnType<typeof makeStyles>; t: ThemeT }) {
  return (
    <Card key={svc.id}>
      <Pressable
        onPress={() => router.push({ pathname: '/dashboard/schedule/[serviceId]', params: { serviceId: svc.id } })}
        accessibilityRole="button"
      >
        <View style={s.serviceRow}>
          <Ionicons name="calendar-outline" size={18} color={t.color.primary} style={{ marginTop: 2 }} />
          <View style={s.serviceBody}>
            <Text variant="label">{svc.name}</Text>
            <Text variant="body">
              {formatTime(svc.starts_at)}
              {svc.location_label ? ` · ${svc.location_label}` : ''}
            </Text>
            <View style={s.meta}>
              <Badge label={svc.status} tone={STATUS_COLOR[svc.status] as never ?? 'neutral'} />
              {svc.capacity > 0 && (
                <Text variant="small" muted>{svc.capacity} cap</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward-outline" size={16} color={t.color.textMuted} />
        </View>
      </Pressable>
    </Card>
  );
}

export default function ScheduleScreen() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [tab, setTab] = useState<Tab>('today');
  const [services, setServices] = useState<ScheduledService[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const tok = getAccessToken()!;
      const { from, to } = isoWindow(tab);
      const r = await listServices(tok, from, to);
      setServices(r.services.filter(s => s.status !== 'cancelled'));
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  // Reset selected date when switching to upcoming
  useEffect(() => {
    if (tab === 'upcoming') setSelectedDate(todayStr());
  }, [tab]);

  const markedDates = useMemo(() => {
    const marks: Record<string, { dots: Array<{ color: string }>; selected?: boolean; selectedColor?: string }> = {};
    services.forEach(svc => {
      const d = svc.starts_at.slice(0, 10);
      if (!marks[d]) marks[d] = { dots: [] };
      if (!marks[d].dots.some(dot => dot.color === t.color.primary)) {
        marks[d].dots.push({ color: t.color.primary });
      }
    });
    marks[selectedDate] = {
      ...(marks[selectedDate] ?? { dots: [] }),
      selected: true,
      selectedColor: t.color.primary,
    };
    return marks;
  }, [services, selectedDate, t.color.primary]);

  const selectedDayServices = useMemo(
    () => services.filter(svc => svc.starts_at.slice(0, 10) === selectedDate),
    [services, selectedDate],
  );

  const calTheme = {
    backgroundColor: t.color.surface,
    calendarBackground: t.color.surface,
    textSectionTitleColor: t.color.textMuted,
    selectedDayBackgroundColor: t.color.primary,
    selectedDayTextColor: t.color.primaryText,
    todayTextColor: t.color.primary,
    dayTextColor: t.color.text,
    textDisabledColor: t.color.textMuted,
    dotColor: t.color.primary,
    selectedDotColor: t.color.primaryText,
    arrowColor: t.color.primary,
    monthTextColor: t.color.text,
    indicatorColor: t.color.primary,
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.header}>
        <Text variant="title">Schedule</Text>
        {isAdmin && (
          <Button label="Add" onPress={() => router.push('/dashboard/schedule/add')} />
        )}
      </View>

      <View style={s.seg}>
        {(['today', 'upcoming'] as Tab[]).map(tb => (
          <Pressable
            key={tb}
            onPress={() => setTab(tb)}
            style={[s.segBtn, tab === tb && s.segBtnOn]}
            accessibilityRole="button"
          >
            <Text variant="small" color={tab === tb ? t.color.bg : t.color.text}>
              {tb === 'today' ? 'Today' : 'Upcoming'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : tab === 'today' ? (
        services.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={32} color={t.color.textMuted} />
            <Text muted>Nothing scheduled today.</Text>
          </View>
        ) : (
          services.map(svc => <ServiceCard key={svc.id} svc={svc} router={router} s={s} t={t} />)
        )
      ) : (
        // Upcoming: calendar + day list
        <>
          <View style={s.calendarWrap}>
            <Calendar
              markingType="multi-dot"
              markedDates={markedDates}
              onDayPress={day => setSelectedDate(day.dateString)}
              theme={calTheme}
            />
          </View>

          <Text variant="label" style={s.dayLabel}>
            {formatDateLabel(`${selectedDate}T00:00:00.000Z`)}
          </Text>

          {selectedDayServices.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="calendar-outline" size={32} color={t.color.textMuted} />
              <Text muted>No services this day.</Text>
            </View>
          ) : (
            selectedDayServices.map(svc => <ServiceCard key={svc.id} svc={svc} router={router} s={s} t={t} />)
          )}
        </>
      )}
    </Screen>
  );
}
