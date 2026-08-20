import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselComponent } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselComponents, createVesselComponent } from '@/lib/api';
import { loadAsset } from '@/lib/vessel-sync';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type ThemeT = ReturnType<typeof useTheme>;
const tok = () => getAccessToken()!;

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  item: { paddingVertical: t.space.sm, gap: 2 },
  sectionHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  itemRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  itemInfo: { flex: 1 },
  critRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  critPill: (on: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: on ? t.color.danger : t.color.border, backgroundColor: on ? t.color.danger + '22' : 'transparent' }),
});

export default function VesselComponents() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [components, setComponents] = useState<VesselComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  // add form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [critical, setCritical] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset }, { components: cs }] = await Promise.all([
        loadAsset(assetId),
        listVesselComponents(tok(), assetId),
      ]);
      setAsset(asset); setComponents(cs);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const add = async () => {
    if (!name.trim()) { setMsg({ text: 'Component name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createVesselComponent(tok(), {
        asset_id: assetId, name: name.trim(),
        category: category.trim() || undefined,
        critical_component: critical,
      });
      setName(''); setCategory(''); setCritical(false);
      setMsg({ text: 'Component added.', tone: 'success' });
      await load();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Vessel'}</Text>
      </Pressable>
      <Text variant="title">Components</Text>

      {/* Add form — admins only */}
      {isAdmin && (
        <Card>
          <Text variant="heading">Add a component</Text>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Component name" autoCapitalize="sentences" />
          <TextField label="Category" value={category} onChangeText={setCategory} placeholder="Category" autoCapitalize="sentences" />
          <View style={s.critRow}>
            <Text variant="label" muted>Critical component</Text>
            <Pressable onPress={() => setCritical(!critical)} accessibilityRole="checkbox" accessibilityState={{ checked: critical }} style={s.critPill(critical)}>
              <Text variant="small" color={critical ? t.color.danger : t.color.textMuted}>{critical ? 'Yes' : 'No'}</Text>
            </Pressable>
          </View>
          <Button label="Add component" onPress={add} loading={busy} />
        </Card>
      )}

      {/* Components list */}
      <Card>
        <View style={s.sectionHeader}>
          <Text variant="heading">Components</Text>
          {components.length > 0 && <Text variant="small" muted>{components.length}</Text>}
        </View>
        {loading
          ? <Text muted>Loading…</Text>
          : components.length === 0
            ? <Text muted>No components recorded yet.</Text>
            : components.filter((c) => c.status !== 'deleted').map((c) => (
              <View key={c.id} style={s.item}>
                <View style={s.itemRow}>
                  <Ionicons name="hardware-chip-outline" size={18} color={t.color.textMuted} />
                  <View style={s.itemInfo}>
                    <Text>{c.name}</Text>
                    {!!c.category && <Text variant="small" muted>{c.category}</Text>}
                  </View>
                  {c.critical_component && (
                    <View style={s.critPill(true)}>
                      <Text variant="small" color={t.color.danger}>Critical</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
      </Card>

    </Screen>
  );
}
