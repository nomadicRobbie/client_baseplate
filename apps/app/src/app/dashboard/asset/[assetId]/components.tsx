import { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetComponent } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAssetComponents, createAssetComponent } from '@/lib/api';
import { loadAsset } from '@/lib/asset-sync';
import { useTheme } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel, Button, FieldRow } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type ThemeT = ReturnType<typeof useTheme>;
const tok = () => getAccessToken()!;
const makeStyles = (t: ThemeT) => ({
  input: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 8 },
  emptyHint: { paddingHorizontal: 4 },
  flex1: { flex: 1 },
  itemInfo: { flex: 1 },
  componentIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  critPill: (on: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: on ? t.color.danger : t.color.border, backgroundColor: on ? t.color.danger + '22' : 'transparent' }),
});

export default function AssetComponents() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<Asset | null>(null);
  const [components, setComponents] = useState<AssetComponent[]>([]);
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
        listAssetComponents(tok(), assetId),
      ]);
      setAsset(asset); setComponents(cs);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.asset) return <Redirect href="/dashboard" />;

  const add = async () => {
    if (!name.trim()) { setMsg({ text: 'Component name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createAssetComponent(tok(), {
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
      <Pressable onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Asset'}</Text>
      </Pressable>
      {isAdmin && (
        <View style={s.section}>
          <SectionLabel>Add a component</SectionLabel>
          <GroupedCard>
            <FieldRow label="Name" displayValue={name}>
              <TextInput value={name} onChangeText={setName} placeholder="Component name"
                autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
            </FieldRow>
            <FieldRow label="Category" displayValue={category}>
              <TextInput value={category} onChangeText={setCategory} placeholder="Category"
                autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
            </FieldRow>
            <GRow last>
              <Text variant="label" style={s.flex1}>Critical component</Text>
              <Pressable onPress={() => setCritical(!critical)} accessibilityRole="checkbox" accessibilityState={{ checked: critical }} style={s.critPill(critical)}>
                <Text variant="small" color={critical ? t.color.danger : t.color.textMuted}>{critical ? 'Yes' : 'No'}</Text>
              </Pressable>
            </GRow>
          </GroupedCard>
          <Button label="Add component" onPress={add} loading={busy} />
        </View>
      )}

      {(() => {
        const visible = components.filter((c) => c.status !== 'deleted');
        return (
          <View style={s.section}>
            <SectionLabel right={visible.length > 0 ? <Text variant="small" muted>{visible.length}</Text> : undefined}>Components</SectionLabel>
            {loading
              ? <Text muted style={s.emptyHint}>Loading…</Text>
              : visible.length === 0
                ? <Text muted style={s.emptyHint}>No components recorded yet.</Text>
                : (
                  <GroupedCard>
                    {visible.map((c, i) => (
                      <GRow key={c.id} last={i === visible.length - 1}>
                        <View style={s.componentIcon}>
                          <Ionicons name="hardware-chip-outline" size={18} color={t.color.textMuted} />
                        </View>
                        <View style={s.itemInfo}>
                          <Text>{c.name}</Text>
                          {!!c.category && <Text variant="small" muted>{c.category}</Text>}
                        </View>
                        {c.critical_component && (
                          <View style={s.critPill(true)}>
                            <Text variant="small" color={t.color.danger}>Critical</Text>
                          </View>
                        )}
                      </GRow>
                    ))}
                  </GroupedCard>
                )}
          </View>
        );
      })()}

    </Screen>
  );
}
