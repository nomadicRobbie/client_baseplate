import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ServiceManifest } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { getServiceManifest, cancelService } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, Button, Badge } from '@/ui/components';

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
});

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', planned: 'Planned', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      await cancelService(getAccessToken()!, manifest.service.id, 'Cancelled via app');
      setManifest(prev => prev ? { ...prev, service: { ...prev.service, status: 'cancelled' } } : prev);
      setMsg({ text: 'Service cancelled', tone: 'success' });
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setCancelling(false);
    }
  };

  const svc = manifest?.service;
  const canCancel = isAdmin && svc && svc.status !== 'cancelled' && svc.status !== 'completed';

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
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
          </View>

          <Card>
            <Text variant="label">When</Text>
            <Text variant="body">{formatDateTime(svc.starts_at)}</Text>
            <Text variant="body" muted>→ {formatDateTime(svc.ends_at)}</Text>
            {svc.notes ? <Text variant="body" muted>{svc.notes}</Text> : null}
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

          {canCancel && (
            <View style={s.actions}>
              <Button label="Cancel service" onPress={handleCancel} loading={cancelling} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
