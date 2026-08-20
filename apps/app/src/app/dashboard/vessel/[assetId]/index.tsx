import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { VesselAsset, VesselAssetType, VesselFault, VesselUpcomingItem, FoodControlPlan } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselFaults, listVesselAssetTypes, getVesselUpcoming, updateVesselAsset, deleteVesselAsset, uploadVesselAssetImage, listPlans } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncVesselOutbox, loadAsset } from '@/lib/vessel-sync';
import { formatDMY } from '@/lib/format';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Row, TextField } from '@/ui/components';
import { ParticularsForm } from '@/ui/vessel';
import { StatusBadge, OfflineBanner, PendingSyncBanner, type StatusLevel } from '@/ui/status';

type ThemeT = ReturnType<typeof useTheme>;
type AssetTab = 'overview' | 'sections';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
function assetTypeIcon(typeName: string | null | undefined): IoniconName {
  const n = (typeName ?? '').toLowerCase();
  if (n.includes('vessel') || n.includes('boat') || n.includes('ship') || n.includes('marine')) return 'boat-outline';
  if (n.includes('vehicle') || n.includes('car') || n.includes('truck') || n.includes('van')) return 'car-outline';
  if (n.includes('facilit') || n.includes('building') || n.includes('site')) return 'business-outline';
  if (n.includes('hardware') || n.includes('computer') || n.includes('server') || n.includes('network')) return 'desktop-outline';
  return 'cube-outline';
}
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
  dangerCard: { borderWidth: 1, borderColor: t.color.danger, borderRadius: t.radius.md, padding: t.space.md, gap: t.space.md },
  dangerHeading: { color: t.color.danger, fontWeight: '700' as const, fontSize: 16 },
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: 3, marginBottom: t.space.sm },
  segBtn: { flex: 1, paddingVertical: t.space.sm, borderRadius: t.radius.sm, alignItems: 'center' as const },
  segBtnOn: { backgroundColor: t.color.surface },
});

const tok = () => getAccessToken()!;

export default function AssetHome() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [assetTab, setAssetTab] = useState<AssetTab>('overview');
  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [faults, setFaults] = useState<VesselFault[]>([]);
  const [upcoming, setUpcoming] = useState<VesselUpcomingItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(pendingCount());
  const [assetType, setAssetType] = useState<VesselAssetType | null>(null);
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
        readThrough('vessel:faults:' + assetId, () => listVesselFaults(tok(), { asset_id: assetId })),
        readThrough('vessel:upcoming:' + assetId, () => getVesselUpcoming(tok(), assetId)),
        readThrough('vessel:asset-types', () => listVesselAssetTypes(tok())),
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
  const doSync = async () => { const { remaining } = await syncVesselOutbox(); setPending(remaining); await load(); };
  useEffect(() => { void load(); void doSync(); }, [assetId]);
  useOnReconnect(() => { void doSync(); });

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

  const openFaults = faults.filter((f) => f.status !== 'closed').length;
  const overdue = upcoming.filter((u) => u.level === 'over').length;
  const dueSoon = upcoming.filter((u) => u.level === 'due').length;
  const coming = upcoming.filter((u) => u.level !== 'ok').slice(0, 8);

  const goFaults = () => router.push({ pathname: '/dashboard/vessel/[assetId]/faults', params: { assetId } });
  const goMaint = () => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId } });
  const goCrew = () => router.push({ pathname: '/dashboard/vessel/[assetId]/crew', params: { assetId } });
  const goComponents = () => router.push({ pathname: '/dashboard/vessel/[assetId]/components', params: { assetId } });

  const saveDetails = async () => {
    if (!asset) return;
    if (!draftName.trim()) return;
    setSavingDetails(true);
    try {
      const patch: Parameters<typeof updateVesselAsset>[2] = { particulars: draftParticulars };
      if (draftName.trim() !== asset.name) patch.name = draftName.trim();
      const { asset: updated } = await updateVesselAsset(tok(), asset.id, patch);
      setAsset(updated);
      setEditingDetails(false);
    } finally { setSavingDetails(false); }
  };

  const assignPlan = async (planId: string | null) => {
    if (!asset) return;
    setSavingPlan(true);
    try {
      const { asset: updated } = await updateVesselAsset(tok(), asset.id, { food_control_plan_id: planId });
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
      const url = await uploadVesselAssetImage(tok(), result.assets[0].uri);
      const { asset: updated } = await updateVesselAsset(tok(), asset.id, { image_url: url });
      setAsset(updated);
    } finally { setUploadingIcon(false); }
  };

  const handleDelete = async () => {
    if (!asset || deleteConfirm !== asset.name) return;
    setDeleting(true);
    try {
      await deleteVesselAsset(tok(), asset.id);
      if (router.canGoBack()) router.back();
      else router.replace('/dashboard/vessel');
    } catch (e) {
      setDeleting(false);
      // surface the error in the confirm field so the zone stays visible
      setDeleteConfirm('');
    }
  };

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
        <Text variant="label" color={t.color.primary}>Assets</Text>
      </Pressable>
      <Pressable onPress={() => void pickIcon()} disabled={!isAdmin || uploadingIcon} accessibilityRole="button" accessibilityLabel="Change vessel icon" style={{ alignSelf: 'flex-start' }}>
        {asset?.image_url
          ? <Image source={{ uri: asset.image_url }} style={{ width: 64, height: 64, borderRadius: 12 }} contentFit="cover" />
          : <View style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={assetTypeIcon(assetType?.name)} size={32} color={t.color.textMuted} />
            </View>
        }
        {isAdmin && (
          <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: t.color.primary, borderRadius: 10, padding: 3 }}>
            <Ionicons name={uploadingIcon ? 'hourglass-outline' : 'camera-outline'} size={12} color={t.color.primaryText} />
          </View>
        )}
      </Pressable>
      <Text variant="title">{asset?.name ?? 'Asset'}</Text>
      <Text variant="small" muted>
        {[asset?.location, asset?.condition].filter(Boolean).join(' · ') || 'No details yet'}
      </Text>

      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => void doSync()} busy={false} />

      <View style={s.seg}>
        <Pressable style={[s.segBtn, assetTab === 'overview' && s.segBtnOn]} onPress={() => setAssetTab('overview')} accessibilityRole="button" accessibilityState={{ selected: assetTab === 'overview' }}>
          <Text variant="label" color={assetTab === 'overview' ? t.color.primary : t.color.textMuted}>Overview</Text>
        </Pressable>
        <Pressable style={[s.segBtn, assetTab === 'sections' && s.segBtnOn]} onPress={() => setAssetTab('sections')} accessibilityRole="button" accessibilityState={{ selected: assetTab === 'sections' }}>
          <Text variant="label" color={assetTab === 'sections' ? t.color.primary : t.color.textMuted}>Sections</Text>
        </Pressable>
      </View>

      {assetTab === 'overview' && (
        <>
          <Card>
            <View style={s.statsRow}>
              <Stat n={openFaults} label="Open faults" danger />
              <Stat n={dueSoon} label="Due soon" />
              <Stat n={overdue} label="Overdue" danger />
            </View>
          </Card>

          <View style={s.buttonGrid}>
            <View style={s.buttonCell}>
              <Button label="Faults" icon="alert-circle-outline" onPress={goFaults} />
            </View>
            <View style={s.buttonCell}>
              <Button label="Maintenance" icon="construct-outline" onPress={goMaint} />
            </View>
            <View style={s.buttonCell}>
              <Button label="Assignees" icon="people-outline" onPress={goCrew} />
            </View>
            <View style={s.buttonCell}>
              <Button label="Components" icon="hardware-chip-outline" onPress={goComponents} />
            </View>
          </View>

          {/* Food Control Plan — only when both vessel and compliance modules are active */}
          {features?.compliance && (
            <>
              <Text variant="heading">Food Control Plan</Text>
              <Card>
                {asset?.food_control_plan_id ? (() => {
                  const plan = plans.find((p) => p.id === asset.food_control_plan_id);
                  return assigningPlan ? null : (
                    <Row onPress={() => router.push('/dashboard/compliance')}>
                      <Ionicons name="clipboard-outline" size={22} color={t.color.text} />
                      <View style={s.sectionRow}>
                        <Text>{plan?.name ?? 'Control plan'}</Text>
                        <Text variant="small" muted>{plan ? `Tier: ${plan.tier}` : 'Loading…'} · Open compliance</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                    </Row>
                  );
                })() : (
                  !assigningPlan && <Text muted>No control plan assigned to this asset.</Text>
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
                  <Button
                    label={asset?.food_control_plan_id ? 'Change plan' : 'Assign a control plan'}
                    variant="ghost"
                    onPress={() => setAssigningPlan(true)}
                    style={{ marginTop: t.space.sm }}
                  />
                )}
              </Card>
            </>
          )}

          <Text variant="heading">Coming up</Text>
          {loading ? <Card><Text muted>Loading…</Text></Card>
            : coming.length === 0 ? (
              <Card><Text muted>Nothing due right now.</Text></Card>
            ) : (
              <Card>
                {coming.map((u) => {
                  const level: StatusLevel = u.level === 'over' ? 'over' : u.level === 'due' ? 'due' : 'ok';
                  return (
                    <Pressable key={u.id} onPress={goMaint} accessibilityRole="button" style={s.upcomingItem}>
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

          {isAdmin && (
            <>
              <Text variant="heading">Details</Text>
              <Card>
                {!editingDetails ? (
                  <>
                    <View style={s.detailRow}>
                      <Text variant="small" muted>Name</Text>
                      <Text variant="small">{asset?.name ?? '—'}</Text>
                    </View>
                    {assetType?.fields.map((f) => {
                      const v = asset?.particulars?.[f.key];
                      const label = f.unit ? `${f.label} (${f.unit})` : f.label;
                      return (
                        <View key={f.key} style={s.detailRow}>
                          <Text variant="small" muted>{label}</Text>
                          <Text variant="small">{v || '—'}</Text>
                        </View>
                      );
                    })}
                    <Button
                      label="Edit"
                      variant="ghost"
                      onPress={() => {
                        setDraftName(asset?.name ?? '');
                        setDraftParticulars({ ...(asset?.particulars as Record<string, string> ?? {}) });
                        setEditingDetails(true);
                      }}
                      style={s.editDetailBtn}
                    />
                  </>
                ) : (
                  <>
                    <TextField label="Name" value={draftName} onChangeText={setDraftName} autoCapitalize="sentences" />
                    {assetType && <ParticularsForm fields={assetType.fields} value={draftParticulars} onChange={setDraftParticulars} />}
                    <Button label="Save" onPress={saveDetails} loading={savingDetails} />
                    <Button label="Cancel" variant="ghost" onPress={() => setEditingDetails(false)} />
                  </>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {assetTab === 'sections' && (
        <>
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
            <Row onPress={goCrew}>
              <Ionicons name="people-outline" size={22} color={t.color.text} />
              <View style={s.sectionRow}>
                <Text>Crew</Text>
                <Text variant="small" muted>Assigned crew and roles</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
            </Row>
            <Row onPress={goComponents}>
              <Ionicons name="hardware-chip-outline" size={22} color={t.color.text} />
              <View style={s.sectionRow}>
                <Text>Components</Text>
                <Text variant="small" muted>Sub-systems and parts</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
            </Row>
          </Card>

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
        </>
      )}
    </Screen>
  );
}
