import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselAssetType } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselAssets, listVesselAssetTypes, createVesselAsset, createVesselAssetType } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncVesselOutbox } from '@/lib/vessel-sync';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice, Row } from '@/ui/components';
import { OfflineBanner, PendingSyncBanner } from '@/ui/status';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
const tok = () => getAccessToken()!;

// Fleet — the vessel module home. Pick a vessel to work inside it (asset-first).
export default function VesselFleet() {
  const t = useTheme();
  const router = useRouter();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [assets, setAssets] = useState<VesselAsset[]>([]);
  const [types, setTypes] = useState<VesselAssetType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(pendingCount());
  const [newVessel, setNewVessel] = useState('');
  const [newTypeId, setNewTypeId] = useState<string | null>(null);
  const [newTypeName, setNewTypeName] = useState('');

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  const loadFleet = async () => {
    setLoading(true);
    try {
      const a = await readThrough('vessel:assets', () => listVesselAssets(tok()));
      const ty = await readThrough('vessel:asset-types', () => listVesselAssetTypes(tok()));
      setAssets(a.value.assets); setTypes(ty.value.asset_types);
      setOffline(a.stale || ty.stale);
      if (!newTypeId && ty.value.asset_types[0]) setNewTypeId(ty.value.asset_types[0].id);
    } catch (e) { err(e); } finally { setLoading(false); }
  };
  const doSync = async (reload = false) => {
    const { remaining } = await syncVesselOutbox();
    setPending(remaining);
    if (reload) await loadFleet();
  };
  useEffect(() => { void loadFleet(); void doSync(); }, []);
  useOnReconnect(() => { void doSync(true); });

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const openAsset = (id: string) => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId: id } });

  const addType = async () => {
    if (!newTypeName.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const { asset_type } = await createVesselAssetType(tok(), { name: newTypeName.trim() });
      setNewTypeName(''); setNewTypeId(asset_type.id); await loadFleet();
      setMsg({ text: `Added asset type "${asset_type.name}".`, tone: 'success' });
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  const addVessel = async () => {
    if (!newVessel.trim()) { setMsg({ text: 'Vessel name is required.', tone: 'error' }); return; }
    if (!newTypeId) { setMsg({ text: 'Add an asset type first.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await createVesselAsset(tok(), { asset_type_id: newTypeId, name: newVessel.trim() });
      setNewVessel(''); await loadFleet();
      setMsg({ text: 'Vessel added.', tone: 'success' });
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Text variant="title">Asset Manager</Text>

      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => doSync(true)} busy={busy} />

      {isAdmin && (
        <Card>
          <Text variant="heading">Add an asset</Text>
          {types.length === 0 ? (
            <>
              <Text variant="small" muted>First add an asset type (e.g. &quot;Vessels&quot;).</Text>
              <TextField label="Asset type" value={newTypeName} onChangeText={setNewTypeName} placeholder="Vessels" autoCapitalize="sentences" />
              <Button label="Add asset type" onPress={addType} loading={busy} />
            </>
          ) : (
            <>
              <TextField label="Asset name" value={newVessel} onChangeText={setNewVessel} placeholder="e.g. Aorere Star" autoCapitalize="sentences" />
              <View style={{ gap: 6 }}>
                <Text variant="label" muted>Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
                  {types.map((ty) => {
                    const sel = newTypeId === ty.id;
                    return (
                      <Pressable key={ty.id} onPress={() => setNewTypeId(ty.id)} accessibilityRole="button"
                        style={{ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                        <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{ty.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Button label="Add asset" onPress={addVessel} loading={busy} />
            </>
          )}
        </Card>
      )}

      <Card>
        <Text variant="heading">Fleet {assets.length ? `(${assets.length})` : ''}</Text>
        {loading ? <Text muted>Loading…</Text> : assets.length === 0 ? <Text muted>No vessels yet.</Text> : assets.map((a) => (
          <Row key={a.id} onPress={() => openAsset(a.id)}>
            <Ionicons name="boat-outline" size={20} color={t.color.text} />
            <View style={{ flex: 1 }}>
              <Text>{a.name}</Text>
              {!!(a.mnz_number || a.location) && <Text variant="small" muted>{[a.mnz_number && `MNZ ${a.mnz_number}`, a.location].filter(Boolean).join(' · ')}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Row>
        ))}
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
