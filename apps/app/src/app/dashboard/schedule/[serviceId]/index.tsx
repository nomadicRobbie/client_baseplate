import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ServiceManifest } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { getServiceManifest, cancelService, listServices, updateService } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, Button, Badge, Toggle, Notice } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  header: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const },
  metaRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  personRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  assetRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  actions: { flexDirection: 'row' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
  tlRow: { gap: 6, marginTop: t.space.xs },
  tlTrack: { flexDirection: 'row' as const, height: 12, borderRadius: 6, overflow: 'hidden' as const, backgroundColor: t.color.surfaceAlt },
  tlSegment: { backgroundColor: t.color.primary },
  tlLabels: { flexDirection: 'row' as const },
  tlLabelInner: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
});

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', planned: 'Planned', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
};

// ── Timeline helpers ────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateLabel = (d: Date) => d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
const midnight = (d: Date) => { const m = new Date(d); m.setHours(0, 0, 0, 0); return m; };

type Segment = { date: string; startFrac: number; endFrac: number; startLabel: string | null; endLabel: string | null; nowFrac: number | null };

function buildSegments(starts: Date, ends: Date): Segment[] {
  const now = Date.now();
  const segments: Segment[] = [];
  const dayStart = midnight(starts);
  const dayEnd = midnight(ends);
  const totalDays = Math.round((dayEnd.getTime() - dayStart.getTime()) / DAY_MS);

  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(dayStart.getTime() + i * DAY_MS);
    const dMs = d.getTime();
    const segStart = Math.max(starts.getTime(), dMs);
    const segEnd = Math.min(ends.getTime(), dMs + DAY_MS);
    if (segStart >= segEnd) continue;

    const sf = (segStart - dMs) / DAY_MS;
    const ef = (segEnd - dMs) / DAY_MS;
    const nf = now >= dMs && now <= dMs + DAY_MS ? (now - dMs) / DAY_MS : null;

    segments.push({
      date: dateLabel(d),
      startFrac: sf,
      endFrac: ef,
      startLabel: sf < 0.01 ? null : fmt(segStart),
      endLabel: ef > 0.99 ? null : fmt(segEnd),
      nowFrac: nf,
    });
  }
  return segments;
}

function ServiceTimeline({ starts_at, ends_at, t, s }: { starts_at: string; ends_at: string; t: ThemeT; s: ReturnType<typeof makeStyles> }) {
  const segments = buildSegments(new Date(starts_at), new Date(ends_at));

  return (
    <View style={{ gap: t.space.sm }}>
      {segments.map((seg, i) => {
        const midFlex = seg.endFrac - seg.startFrac;
        const hasNow = seg.nowFrac !== null && seg.nowFrac >= seg.startFrac && seg.nowFrac <= seg.endFrac;
        // now position within the segment (0–1)
        const nowInSeg = hasNow ? (seg.nowFrac! - seg.startFrac) / midFlex : null;

        return (
          <View key={i} style={s.tlRow}>
            <Text variant="small" muted>{seg.date}</Text>

            {/* Track */}
            <View style={s.tlTrack}>
              {seg.startFrac > 0 && <View style={{ flex: seg.startFrac }} />}
              <View style={[s.tlSegment, { flex: midFlex }]}>
                {/* "Now" tick inside segment */}
                {nowInSeg !== null && (
                  <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${nowInSeg * 100}%` as unknown as number, width: 2, backgroundColor: 'rgba(255,255,255,0.7)' }} />
                )}
              </View>
              {seg.endFrac < 1 && <View style={{ flex: 1 - seg.endFrac }} />}
            </View>

            {/* Edge labels: always 00:00 … 24:00 */}
            <View style={[s.tlLabels, { justifyContent: 'space-between' }]}>
              <Text variant="small" muted>00:00</Text>
              <Text variant="small" muted>24:00</Text>
            </View>

            {/* Segment time labels pinned to segment boundaries */}
            {(seg.startLabel || seg.endLabel) && (
              <View style={s.tlLabels}>
                {seg.startFrac > 0 && <View style={{ flex: seg.startFrac }} />}
                <View style={[s.tlLabelInner, { flex: midFlex }]}>
                  {seg.startLabel && <Text variant="small" color={t.color.primary}>{seg.startLabel}</Text>}
                  {seg.endLabel && <Text variant="small" color={t.color.primary}>{seg.endLabel}</Text>}
                </View>
                {seg.endFrac < 1 && <View style={{ flex: 1 - seg.endFrac }} />}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function ServiceDetailScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [manifest, setManifest] = useState<ServiceManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSeries, setCancelSeries] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const tok = getAccessToken()!;
      const r = await getServiceManifest(tok, serviceId);
      setManifest(r.manifest);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => { void load(); }, [load]);

  const handleCancel = async () => {
    if (!manifest) return;
    setCancelling(true);
    try {
      const tok = getAccessToken()!;
      await cancelService(tok, manifest.service.id, 'Cancelled via app');

      if (cancelSeries && manifest.service.template_id) {
        const today = new Date().toISOString().slice(0, 10);
        const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
        const { services } = await listServices(tok, `${today}T00:00:00.000Z`, `${farFuture}T23:59:59.999Z`, { template_id: manifest.service.template_id });
        await Promise.allSettled(
          services
            .filter(s => s.id !== manifest.service.id && s.status !== 'cancelled' && s.status !== 'completed')
            .map(s => cancelService(tok, s.id, 'Cancelled via app — series cancelled')),
        );
      }

      router.replace('/dashboard/schedule');
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
      setCancelling(false);
    }
  };

  const handleConfirm = async () => {
    if (!manifest) return;
    setConfirming(true);
    try {
      const updated = await updateService(getAccessToken()!, manifest.service.id, {
        status: 'confirmed',
        version: manifest.service.version,
      });
      setManifest(prev => prev ? { ...prev, service: updated.service } : prev);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setConfirming(false);
    }
  };

  const svc = manifest?.service;
  const canCancel = isAdmin && svc && svc.status !== 'cancelled' && svc.status !== 'completed';
  const canConfirm = isAdmin && svc?.status === 'planned';
  // The asset is what gates confirmation, not the crew. Crew is worked out from
  // whoever is assigned to the asset, so without one there is nothing to work
  // from — and an empty crew list is a consequence of that, not a separate task.
  const hasAsset = (manifest?.assets.length ?? 0) > 0;

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.replace('/dashboard/schedule')} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Schedule</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : !svc ? (
        <Text muted>Service not found.</Text>
      ) : (
        <>
          <View style={s.header}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="title">{svc.name}</Text>
              <View style={s.metaRow}>
                <Badge label={STATUS_LABEL[svc.status] ?? svc.status} tone={svc.status === 'confirmed' ? 'success' : 'neutral'} />
                {svc.location_label && <Badge label={svc.location_label} tone="neutral" />}
              </View>
            </View>
            {isAdmin && svc.status !== 'cancelled' && svc.status !== 'completed' && (
              <Pressable
                onPress={() => router.push({ pathname: '/dashboard/schedule/[serviceId]/edit', params: { serviceId: svc.id } })}
                accessibilityRole="button"
                accessibilityLabel="Edit event"
                style={{ padding: 4 }}
              >
                <Ionicons name="create-outline" size={22} color={t.color.primary} />
              </Pressable>
            )}
          </View>

          <Card>
            <Text variant="label">When</Text>
            <ServiceTimeline starts_at={svc.starts_at} ends_at={svc.ends_at} t={t} s={s} />
            {svc.notes ? <Text variant="body" muted style={{ marginTop: t.space.xs }}>{svc.notes}</Text> : null}
          </Card>

          {/* Crew */}
          <GroupedCard>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="label">Crew</Text>
              {isAdmin && svc.status !== 'cancelled' && svc.status !== 'completed' && (
                <Pressable
                  onPress={() => router.push({ pathname: '/dashboard/schedule/[serviceId]/assign', params: { serviceId: svc.id } })}
                  accessibilityRole="button"
                >
                  <Ionicons name="person-add-outline" size={18} color={t.color.primary} />
                </Pressable>
              )}
            </View>
            {manifest!.crew.length === 0 ? (
              <GRow last><Text variant="body" muted>No crew assigned</Text></GRow>
            ) : (
              manifest!.crew.map((c, i) => (
                <GRow key={c.assignment_id} last={i === manifest!.crew.length - 1}>
                  <Text variant="body" style={{ flex: 1 }}>{c.name}</Text>
                  <Text variant="small" muted>{c.role ?? '—'}</Text>
                </GRow>
              ))
            )}
          </GroupedCard>

          {/* Assets */}
          {(manifest!.assets.length > 0 || isAdmin) && (
            <GroupedCard>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                <Text variant="label">Assets</Text>
              </View>
              {manifest!.assets.length === 0 ? (
                <GRow last><Text variant="body" muted>No assets assigned</Text></GRow>
              ) : (
                manifest!.assets.map((a, i) => (
                  <GRow key={a.assignment_id} last={i === manifest!.assets.length - 1}>
                    <Text variant="body" style={{ flex: 1 }}>{a.name}</Text>
                    <Text variant="small" muted>{a.role ?? '—'}</Text>
                  </GRow>
                ))
              )}
            </GroupedCard>
          )}

          {isAdmin && svc.status !== 'cancelled' && svc.status !== 'completed' && (
            <View style={{ gap: t.space.sm }}>
              {canConfirm && (
                hasAsset
                  ? <Button label="Confirm service" onPress={handleConfirm} loading={confirming} />
                  : (
                    <>
                      <Notice tone="info" message="This service needs an asset before it can be confirmed. Crew are worked out from whoever is assigned to it." />
                      <Button
                        variant="ghost"
                        label="Assign an asset"
                        onPress={() => router.push({ pathname: '/dashboard/schedule/[serviceId]/assign', params: { serviceId: svc.id } })}
                      />
                    </>
                  )
              )}
              {canCancel && (
                <>
                  {svc.template_id && (
                    <Toggle
                      value={cancelSeries}
                      onChange={setCancelSeries}
                      label="Cancel all future events in this series"
                    />
                  )}
                  <Button variant="ghost" label={cancelSeries ? 'Cancel series' : 'Cancel service'} onPress={handleCancel} loading={cancelling} />
                </>
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
