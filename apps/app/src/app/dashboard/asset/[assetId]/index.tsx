import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetType, AssetFault, AssetUpcomingItem, FoodControlPlan } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAssetFaults, listAssetTypes, getAssetUpcoming, updateAsset, deleteAsset, uploadAssetImage, listPlans } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncAssetOutbox, loadAsset } from '@/lib/asset-sync';
import { formatDMY } from '@/lib/format';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, SectionLabel, Button, TextField } from '@/ui/components';
import { ParticularsForm, assetTypeIcon } from '@/ui/asset';
import { StatusBadge, OfflineBanner, PendingSyncBanner, type StatusLevel } from '@/ui/status';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  stat: { flex: 1, alignItems: 'center' as const, gap: 2 },
  buttonGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  buttonCell: { flexBasis: '48%' as const, flexGrow: 1 },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 4 },
  editDetailBtn: { marginTop: t.space.sm },
  boldText: { fontWeight: '700' as const },
  statNum: { fontSize: 26, fontWeight: '800' as const },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  statsRow: { flexDirection: 'row' as const },
  upcomingItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, paddingVertical: t.space.sm },
  upcomingInfo: { flex: 1 },
  sectionRow: { flex: 1 },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md },
  headerText: { flex: 1, gap: 2 },
  dangerCard: { borderWidth: 1, borderColor: t.color.danger, borderRadius: t.radius.md, padding: t.space.md, gap: t.space.md },
  dangerHeading: { color: t.color.danger, fontWeight: '700' as const, fontSize: 16 },
});

const tok = () => getAccessToken()!;

export default function AssetHome() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<Asset | null>(null);
  const [faults, setFaults] = useState<AssetFault[]>([]);
  const [upcoming, setUpcoming] = useState<AssetUpcomingItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(pendingCount());
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftParticulars, setDraftParticulars] = useState<Record<string, string>>({});
  const [savingDetails, setSavingDetails] = useState(false);
  const [plans, setPlans] = useState<FoodControlPlan[]>([]);
  const [assigningPlan, setAssigningPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ asset, offline: o1 }, f, u, types] = await Promise.all([
        loadAsset(assetId),
        readThrough('asset:faults:' + assetId, () => listAssetFaults(tok(), { asset_id: assetId })),
        readThrough('asset:upcoming:' + assetId, () => getAssetUpcoming(tok(), assetId)),
        readThrough('asset:asset-types', () => listAssetTypes(tok())),
      ]);
      setAsset(asset); setFaults(f.value.faults); setUpcoming(u.value.items);
      setOffline(o1 || f.stale || u.stale);
      const matched = asset ? types.value.asset_types.find((ty) => ty.id === asset.asset_type_id) ?? null : null;
      setAssetType(matched);
      if (features?.compliance) {
        try { setPlans((await listPlans(tok())).plans); } catch { /* non-fatal */ }
      }
    } finally { setLoading(false); }
  };
  const doSync = async () => { const { remaining } = await syncAssetOutbox(); setPending(remaining); await load(); };
  useEffect(() => { void load(); void doSync(); }, [assetId]);
  useOnReconnect(() => { void doSync(); });

  if (features && !features.asset) return <Redirect href="/dashboard" />;

  const openFaults = faults.filter((f) => f.status !== 'closed').length;
  const overdue = upcoming.filter((u) => u.level === 'over').length;
  const dueSoon = upcoming.filter((u) => u.level === 'due').length;
  const coming = upcoming.filter((u) => u.level !== 'ok').slice(0, 8);

  const goFaults = () => router.push({ pathname: '/dashboard/asset/[assetId]/faults', params: { assetId } });
  const goMaint = () => router.push({ pathname: '/dashboard/asset/[assetId]/maintenance', params: { assetId } });
  const goCrew = () => router.push({ pathname: '/dashboard/asset/[assetId]/crew', params: { assetId } });
  const goComponents = () => router.push({ pathname: '/dashboard/asset/[assetId]/components', params: { assetId } });

  const saveDetails = async () => {
    if (!asset) return;
    if (!draftName.trim()) return;
    setSavingDetails(true);
    try {
      const patch: Parameters<typeof updateAsset>[2] = { particulars: draftParticulars };
      if (draftName.trim() !== asset.name) patch.name = draftName.trim();
      const { asset: updated } = await updateAsset(tok(), asset.id, patch);
      setAsset(updated);
      setEditingDetails(false);
    } finally { setSavingDetails(false); }
  };

  const assignPlan = async (planId: string | null) => {
    if (!asset) return;
    setSavingPlan(true);
    try {
      const { asset: updated } = await updateAsset(tok(), asset.id, { food_control_plan_id: planId });
      setAsset(updated);
      setAssigningPlan(false);
    } finally { setSavingPlan(false); }
  };

  const pickIcon = async () => {
    if (!asset || !isAdmin) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploadingIcon(true);
    try {
      const url = await uploadAssetImage(tok(), result.assets[0].uri);
      const { asset: updated } = await updateAsset(tok(), asset.id, { image_url: url });
      setAsset(updated);
    } finally { setUploadingIcon(false); }
  };

  const handleDelete = async () => {
    if (!asset || deleteConfirm !== asset.name) return;
    setDeleting(true);
    try {
      await deleteAsset(tok(), asset.id);
      if (router.canGoBack()) router.back();
      else router.replace('/dashboard/asset');
    } catch (e) {
      setDeleting(false);
      // surface the error in the confirm field so the zone stays visible
      setDeleteConfirm('');
    }
  };

  return (
    <Screen>
      <Pressable onPress={() => router.push('/dashboard/asset')} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Assets</Text>
      </Pressable>

      <View style={s.headerRow}>
        <Pressable onPress={() => void pickIcon()} disabled={!isAdmin || uploadingIcon} accessibilityRole="button" accessibilityLabel="Change asset icon">
          {asset?.image_url
            ? <Image source={{ uri: asset.image_url }} style={{ width: 56, height: 56, borderRadius: 12 }} contentFit="cover" />
            : <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={assetTypeIcon(assetType?.name)} size={28} color={t.color.textMuted} />
              </View>
          }
          {isAdmin && (
            <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: t.color.primary, borderRadius: 10, padding: 3 }}>
              <Ionicons name={uploadingIcon ? 'hourglass-outline' : 'camera-outline'} size={12} color={t.color.primaryText} />
            </View>
          )}
        </Pressable>
        <View style={s.headerText}>
          <Text variant="title">{asset?.name ?? 'Asset'}</Text>
          <Text variant="small" muted>
            {[asset?.location, asset?.condition].filter(Boolean).join(' · ') || 'No details yet'}
          </Text>
        </View>
      </View>

      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => void doSync()} busy={false} />

      <View style={{ gap: 8 }}>
        <SectionLabel>Actions</SectionLabel>
        <GroupedCard>
          <GRow onPress={goFaults}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: openFaults > 0 ? t.color.dangerMuted : t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="alert-circle-outline" size={18} color={openFaults > 0 ? t.color.danger : t.color.text} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>Faults</Text>
            {openFaults > 0 && <Text variant="label" color={t.color.danger}>{openFaults}</Text>}
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </GRow>
          <GRow onPress={goMaint}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: overdue > 0 ? t.color.dangerMuted : t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="construct-outline" size={18} color={overdue > 0 ? t.color.danger : t.color.text} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>Maintenance</Text>
            {(overdue > 0 || dueSoon > 0) && (
              <Text variant="label" color={overdue > 0 ? t.color.danger : t.color.primary}>{overdue > 0 ? `${overdue} overdue` : `${dueSoon} due`}</Text>
            )}
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </GRow>
          <GRow onPress={goCrew}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="people-outline" size={18} color={t.color.text} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>Assignees</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </GRow>
          <GRow onPress={goComponents} last>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="hardware-chip-outline" size={18} color={t.color.text} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>Components</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </GRow>
        </GroupedCard>
      </View>

      {!loading && coming.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel>Coming up</SectionLabel>
          <GroupedCard>
            {coming.map((u, i) => {
              const level: StatusLevel = u.level === 'over' ? 'over' : u.level === 'due' ? 'due' : 'ok';
              return (
                <GRow key={u.id} onPress={goMaint} last={i === coming.length - 1}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="construct-outline" size={18} color={t.color.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{u.title}</Text>
                    {!!u.due_date && <Text variant="small" muted>Due {formatDMY(u.due_date)}</Text>}
                  </View>
                  <StatusBadge level={level} label={u.level === 'over' ? 'Overdue' : 'Due soon'} />
                </GRow>
              );
            })}
          </GroupedCard>
        </View>
      )}

      {isAdmin && (
        <View style={{ gap: 8 }}>
          <SectionLabel right={
            !editingDetails
              ? <Pressable onPress={() => { setDraftName(asset?.name ?? ''); setDraftParticulars({ ...(asset?.particulars as Record<string, string> ?? {}) }); setEditingDetails(true); }} accessibilityRole="button">
                  <Text variant="small" color={t.color.primary}>Edit</Text>
                </Pressable>
              : undefined
          }>Details</SectionLabel>
          {!editingDetails ? (
            <GroupedCard>
              <GRow>
                <Text variant="label" style={{ flex: 1 }}>Name</Text>
                <Text variant="body" muted numberOfLines={1}>{asset?.name ?? '—'}</Text>
              </GRow>
              {assetType?.fields.map((f, i) => {
                const v = asset?.particulars?.[f.key];
                const label = f.unit ? `${f.label} (${f.unit})` : f.label;
                return (
                  <GRow key={f.key} last={i === (assetType.fields.length - 1)}>
                    <Text variant="label" style={{ flex: 1 }}>{label}</Text>
                    <Text variant="body" muted numberOfLines={1}>{v || '—'}</Text>
                  </GRow>
                );
              })}
              {(!assetType?.fields.length) && <GRow last><Text variant="label" style={{ flex: 1 }}>Name</Text><Text variant="body" muted>{asset?.name ?? '—'}</Text></GRow>}
            </GroupedCard>
          ) : (
            <Card>
              <TextField label="Name" value={draftName} onChangeText={setDraftName} autoCapitalize="sentences" />
              {assetType && <ParticularsForm fields={assetType.fields} value={draftParticulars} onChange={setDraftParticulars} />}
              <Button label="Save" onPress={saveDetails} loading={savingDetails} />
              <Button label="Cancel" variant="ghost" onPress={() => setEditingDetails(false)} />
            </Card>
          )}
        </View>
      )}

      {features?.compliance && (
        <View style={{ gap: 8 }}>
          <SectionLabel>Food Control Plan</SectionLabel>
          <GroupedCard>
            {asset?.food_control_plan_id ? (() => {
              const plan = plans.find((p) => p.id === asset.food_control_plan_id);
              return assigningPlan ? null : (
                <GRow onPress={() => router.push('/dashboard/compliance')} last={!isAdmin}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="clipboard-outline" size={18} color={t.color.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{plan?.name ?? 'Control plan'}</Text>
                    <Text variant="small" muted>{plan ? `Tier: ${plan.tier}` : 'Loading…'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                </GRow>
              );
            })() : (
              !assigningPlan && <GRow last={!isAdmin}><Text variant="body" muted>No control plan assigned.</Text></GRow>
            )}

            {assigningPlan ? (
              <>
                <Text variant="label" muted>Select a plan</Text>
                {plans.length === 0
                  ? <Text variant="small" muted>No plans yet — create one in Food Compliance.</Text>
                  : plans.map((p) => (
                    <Pressable key={p.id} onPress={() => void assignPlan(p.id)} disabled={savingPlan}
                      style={{ paddingVertical: t.space.sm, flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
                      <Ionicons name={asset?.food_control_plan_id === p.id ? 'radio-button-on' : 'radio-button-off'} size={20} color={t.color.primary} />
                      <View>
                        <Text>{p.name}</Text>
                        <Text variant="small" muted>Tier: {p.tier}</Text>
                      </View>
                    </Pressable>
                  ))
                }
                {asset?.food_control_plan_id && (
                  <Button label="Unassign plan" variant="ghost" onPress={() => void assignPlan(null)} loading={savingPlan} />
                )}
                <Button label="Cancel" variant="ghost" onPress={() => setAssigningPlan(false)} />
              </>
            ) : isAdmin && (
              <GRow onPress={() => setAssigningPlan(true)} last>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="add" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={{ flex: 1 }}>{asset?.food_control_plan_id ? 'Change plan' : 'Assign a control plan'}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </GRow>
            )}
          </GroupedCard>
        </View>
      )}

      {isAdmin && (
        <View style={s.dangerCard}>
          <Text style={s.dangerHeading}>Danger zone</Text>
          {!showDelete ? (
            <Button label="Delete this asset" variant="danger" onPress={() => setShowDelete(true)} />
          ) : (
            <>
              <Text variant="small" muted>
                This is permanent and cannot be undone. All associated faults, maintenance records, and schedules will be archived with it.
              </Text>
              <Text variant="small" muted>
                Type <Text variant="small" style={s.boldText}>{asset?.name ?? '…'}</Text> to confirm.
              </Text>
              <TextField
                label="Confirm asset name"
                value={deleteConfirm}
                onChangeText={setDeleteConfirm}
                placeholder={asset?.name ?? ''}
                autoCapitalize="none"
              />
              <Button
                label={deleting ? 'Deleting…' : 'Confirm delete'}
                variant="danger"
                onPress={handleDelete}
                loading={deleting}
                disabled={deleteConfirm !== asset?.name}
              />
              <Button label="Cancel" variant="ghost" onPress={() => { setShowDelete(false); setDeleteConfirm(''); }} />
            </>
          )}
        </View>
      )}
    </Screen>
  );
}
