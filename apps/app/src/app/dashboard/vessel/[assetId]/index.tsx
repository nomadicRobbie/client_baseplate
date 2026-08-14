import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselFault, VesselUpcomingItem } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselFaults, getVesselUpcoming } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncVesselOutbox, loadAsset } from '@/lib/vessel-sync';
import { formatDMY } from '@/lib/format';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Row } from '@/ui/components';
import { StatusBadge, OfflineBanner, PendingSyncBanner, type StatusLevel } from '@/ui/status';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  stat: { flex: 1, alignItems: 'center' as const, gap: 2 },
  statNum: { fontSize: 26, fontWeight: '800' as const },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  statsRow: { flexDirection: 'row' as const },
  upcomingItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, paddingVertical: t.space.sm },
  upcomingInfo: { flex: 1 },
  sectionRow: { flex: 1 },
});

const tok = () => getAccessToken()!;

// Vessel home — an at-a-glance dashboard for one boat: status stats, a "Coming up"
// feed of due/overdue services, and section navigation. Mirrors the compliance
// "Today" layout so the two modules feel the same.
export default function VesselHome() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features } = useAuth();

  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [faults, setFaults] = useState<VesselFault[]>([]);
  const [upcoming, setUpcoming] = useState<VesselUpcomingItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(pendingCount());

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset, offline: o1 }, f, u] = await Promise.all([
        loadAsset(assetId),
        readThrough('vessel:faults:' + assetId, () => listVesselFaults(tok(), { asset_id: assetId })),
        readThrough('vessel:upcoming:' + assetId, () => getVesselUpcoming(tok(), assetId)),
      ]);
      setAsset(asset); setFaults(f.value.faults); setUpcoming(u.value.items);
      setOffline(o1 || f.stale || u.stale);
    } finally { setLoading(false); }
  };
  const doSync = async () => { const { remaining } = await syncVesselOutbox(); setPending(remaining); await load(); };
  useEffect(() => { void load(); void doSync(); }, [assetId]);
  useOnReconnect(() => { void doSync(); });

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const openFaults = faults.filter((f) => f.status !== 'closed').length;
  const overdue = upcoming.filter((u) => u.level === 'over').length;
  const dueSoon = upcoming.filter((u) => u.level === 'due').length;
  const coming = upcoming.filter((u) => u.level !== 'ok').slice(0, 8); // attention items on top

  const goFaults = () => router.push({ pathname: '/dashboard/vessel/[assetId]/faults', params: { assetId } });
  const goMaint = () => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId } });

  const Stat = ({ n, label, danger }: { n: number; label: string; danger?: boolean }) => (
    <View style={s.stat}>
      <Text style={[s.statNum, { color: danger && n > 0 ? t.color.danger : t.color.primary }]}>{n}</Text>
      <Text variant="small" muted>{label}</Text>
    </View>
  );

  return (
    <Screen>
      <Pressable onPress={() => router.push('/dashboard/vessel')} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Fleet</Text>
      </Pressable>
      <Text variant="title">{asset?.name ?? 'Vessel'}</Text>
      <Text variant="small" muted>
        {[asset?.mnz_number && `MNZ ${asset.mnz_number}`, asset?.location, asset?.condition].filter(Boolean).join(' · ') || 'No details yet'}
      </Text>

      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => void doSync()} busy={false} />

      {/* Status at a glance */}
      <Card>
        <View style={s.statsRow}>
          <Stat n={openFaults} label="Open faults" danger />
          <Stat n={dueSoon} label="Due soon" />
          <Stat n={overdue} label="Overdue" danger />
        </View>
      </Card>

      {/* Coming up — due / overdue services */}
      <Text variant="heading">Coming up</Text>
      {loading ? <Card><Text muted>Loading…</Text></Card>
        : coming.length === 0 ? (
          <Card>
            <Text muted>Nothing due right now.</Text>
            <Button label="Set up scheduled maintenance" variant="ghost" onPress={goMaint} style={{ marginTop: t.space.sm }} />
          </Card>
        ) : (
          <Card>
            {coming.map((u) => {
              const level: StatusLevel = u.level === 'over' ? 'over' : u.level === 'due' ? 'due' : 'ok';
              return (
                <Pressable key={u.id} onPress={goMaint} accessibilityRole="button"
                  style={s.upcomingItem}>
                  <Ionicons name="construct-outline" size={20} color={t.color.textMuted} />
                  <View style={s.upcomingInfo}>
                    <Text>{u.title}</Text>
                    {!!u.due_date && <Text variant="small" muted>Due {formatDMY(u.due_date)}</Text>}
                  </View>
                  <StatusBadge level={level} label={u.level === 'over' ? 'Overdue' : 'Due soon'} />
                </Pressable>
              );
            })}
          </Card>
        )}

      {/* Sections */}
      <Text variant="heading" style={{ marginTop: t.space.md }}>Sections</Text>
      <Card>
        <Row onPress={goFaults}>
          <Ionicons name="alert-circle-outline" size={22} color={t.color.text} />
          <View style={s.sectionRow}>
            <Text>Faults</Text>
            <Text variant="small" muted>{openFaults ? `${openFaults} open` : 'Log and resolve defects'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
        </Row>
        <Row onPress={goMaint}>
          <Ionicons name="construct-outline" size={22} color={t.color.text} />
          <View style={s.sectionRow}>
            <Text>Maintenance</Text>
            <Text variant="small" muted>{overdue + dueSoon ? `${overdue + dueSoon} due` : 'Scheduled work and history'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
        </Row>
      </Card>

      {/* Quick action */}
      <Button label="Log a fault" onPress={goFaults} />
    </Screen>
  );
}
