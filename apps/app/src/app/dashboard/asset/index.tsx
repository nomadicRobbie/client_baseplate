import React, { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDMY } from '@/lib/format';
import type { Asset, AssetType, AssetFault, AssetFieldDef, AssetUpcomingItem } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAssets, listAssetTypes, listAssetFaults, getAssetUpcoming, createAsset, createAssetType, deleteAssetType } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncAssetOutbox } from '@/lib/asset-sync';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, SectionLabel, Button, TextField, Notice } from '@/ui/components';
import { OfflineBanner, PendingSyncBanner } from '@/ui/status';
import { ParticularsForm, assetTypeIcon } from '@/ui/asset';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type Tab = 'overview' | 'add' | 'schedule';
const tok = () => getAccessToken()!;


const makeStyles = (t: ThemeT) => ({
  assetInfo: { flex: 1 },
  summaryRow: { flexDirection: 'row' as const, gap: t.space.sm },
  summaryCard: { flex: 1, gap: t.space.xs },
  summaryNum: { fontSize: 32, fontWeight: '800' as const, lineHeight: 36 },
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill, padding: 4, marginBottom: t.space.sm },
  segBtn: { flex: 1, minHeight: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.pill },
  segBtnOn: { backgroundColor: t.color.primary },
  cardToggle: { gap: t.space.xs },
  cardToggleHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const },
  chevronTop: { marginTop: 6 },
  expandedContent: { paddingTop: t.space.md, gap: t.space.sm },
  itemLink: { gap: 2 },
  groupHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  scheduleRow: { flexDirection: 'row' as const, gap: t.space.sm, paddingVertical: t.space.xs },
  scheduleInfo: { flex: 1, gap: 2 },
  flex1: { flex: 1 },
  addTypeSection: { gap: t.space.md, paddingTop: t.space.md },
  addFieldSection: { gap: t.space.sm, paddingTop: t.space.md },
  levelDot: (level: AssetUpcomingItem['level']) => ({
    width: 8, height: 8, borderRadius: 4, marginTop: 5,
    backgroundColor: level === 'over' ? t.color.danger : level === 'due' ? t.color.primary : t.color.border,
  }),
  typeRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  typeChip: (sel: boolean) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: t.space.sm, paddingLeft: t.space.md, paddingRight: t.space.sm, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  typeListRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 6 },
  typePickerList: { borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.lg, overflow: 'hidden' as const, backgroundColor: t.color.surface },
  typePickerSearch: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, minHeight: 48, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderBottomWidth: 1, borderBottomColor: t.color.border },
  typePickerItem: (sel: boolean) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, minHeight: 56, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderBottomWidth: 1, borderBottomColor: t.color.border, backgroundColor: sel ? t.color.primary + '18' : 'transparent' }),
  typePickerItemLast: { borderBottomWidth: 0 },
  typePickerIcon: (sel: boolean) => ({ width: 36, height: 36, borderRadius: 10, backgroundColor: sel ? t.color.primary : t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const }),
  typePickerSectionHeader: { flexDirection: 'row' as const, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, paddingHorizontal: t.space.xs },
  totalRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: t.space.md, paddingVertical: t.space.sm },
});

function NameRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.sm, borderBottomWidth: open ? 1 : 0, borderBottomColor: t.color.border }}>
        <Text variant="label" style={{ flex: 1 }}>Name</Text>
        <Text variant="small" muted numberOfLines={1}>{value || 'Required'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md }}>
          <TextInput value={value} onChangeText={onChange} autoFocus autoCapitalize="sentences"
            placeholder="Asset name" placeholderTextColor={t.color.textMuted}
            style={{ borderBottomWidth: 2, borderBottomColor: t.color.primary, paddingVertical: t.space.sm, fontSize: t.size.md, color: t.color.text }} />
        </View>
      )}
    </>
  );
}

export default function AssetManager() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [tab, setTab] = useState<Tab>('overview');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [types, setTypes] = useState<AssetType[]>([]);
  const [faults, setFaults] = useState<AssetFault[]>([]);
  const [upcoming, setUpcoming] = useState<AssetUpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(pendingCount());
  const [expandedCard, setExpandedCard] = useState<'faults' | 'maintenance' | null>(null);

  // Add tab sub-view
  const [addView, setAddView] = useState<'asset' | 'types'>('asset');
  // Add-asset form
  const [typeSearch, setTypeSearch] = useState('');
  const [addMsg, setAddMsg] = useState<Msg | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [particulars, setParticulars] = useState<Record<string, string>>({});
  // Add-type form
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [draftFields, setDraftFields] = useState<AssetFieldDef[]>([]);
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<AssetFieldDef['type']>('text');
  const [fieldUnit, setFieldUnit] = useState('');
  const [fieldOptions, setFieldOptions] = useState('');

  const slugify = (str: string) => str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const selectedType = types.find((ty) => ty.id === typeId) ?? null;
  const selectType = (id: string) => { setTypeId(id); setParticulars({}); };

  const load = async () => {
    setLoading(true);
    try {
      const [a, f, u, ty] = await Promise.all([
        readThrough('asset:assets', () => listAssets(tok())),
        readThrough('asset:faults:all', () => listAssetFaults(tok())),
        readThrough('asset:upcoming:all', () => getAssetUpcoming(tok())),
        readThrough('asset:asset-types', () => listAssetTypes(tok())),
      ]);
      setAssets(a.value.assets);
      setFaults(f.value.faults.filter((x) => x.status !== 'closed'));
      setUpcoming(u.value.items);
      setTypes(ty.value.asset_types);
      setOffline(a.stale || f.stale || u.stale || ty.stale);
      if (!typeId && ty.value.asset_types[0]) selectType(ty.value.asset_types[0].id);
    } catch { /* mirror serves stale on error */ } finally { setLoading(false); }
  };
  const doSync = async (reload = false) => {
    const { remaining } = await syncAssetOutbox();
    setPending(remaining);
    if (reload) void load();
  };
  useEffect(() => { void load(); void doSync(); }, []);
  useOnReconnect(() => { void doSync(true); });

  if (features && !features.asset) return <Redirect href="/dashboard" />;

  // ── Derived ──────────────────────────────────────────────────────────────────
  const faultAssets = new Set(faults.map((f) => f.asset_id)).size;
  const overdue = upcoming.filter((u) => u.level === 'over').length;
  const dueSoon = upcoming.filter((u) => u.level === 'due').length;
  const maintenanceTotal = overdue + dueSoon;

  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedFaults = [...faults].sort((a, b) => (urgencyOrder[a.urgency ?? ''] ?? 4) - (urgencyOrder[b.urgency ?? ''] ?? 4));
  const faultPreview = sortedFaults.slice(0, 4);
  const moreFaults = faults.length - faultPreview.length;

  const actionableUpcoming = upcoming.filter((u) => u.level !== 'ok').sort((a, b) => (a.level === 'over' ? 0 : 1) - (b.level === 'over' ? 0 : 1));
  const maintPreview = actionableUpcoming.slice(0, 4);
  const moreMaint = actionableUpcoming.length - maintPreview.length;

  const toggle = (card: 'faults' | 'maintenance') => setExpandedCard((c) => (c === card ? null : card));
  const openAsset = (id: string) => router.push({ pathname: '/dashboard/asset/[assetId]', params: { assetId: id } });

  // ── Add-asset actions ─────────────────────────────────────────────────────────
  const addAsset = async () => {
    if (!assetName.trim()) { setAddMsg({ text: 'Asset name is required.', tone: 'error' }); return; }
    if (!typeId) { setAddMsg({ text: 'Select an asset type.', tone: 'error' }); return; }
    setAddBusy(true); setAddMsg(null);
    try {
      await createAsset(tok(), { asset_type_id: typeId, name: assetName.trim(), particulars });
      setAssetName(''); setParticulars({}); setTab('overview'); void load();
    } catch (e) { setAddMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); setAddBusy(false); }
  };

  const addField = () => {
    if (!fieldLabel.trim()) return;
    const key = slugify(fieldLabel.trim()) || `field_${draftFields.length + 1}`;
    const field: AssetFieldDef = {
      key, label: fieldLabel.trim(), type: fieldType,
      ...(fieldUnit.trim() ? { unit: fieldUnit.trim() } : {}),
      ...(fieldType === 'select' && fieldOptions.trim() ? { options: fieldOptions.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    };
    setDraftFields([...draftFields, field]);
    setFieldLabel(''); setFieldUnit(''); setFieldOptions('');
  };

  const resetAddType = () => {
    setShowAddType(false); setNewTypeName(''); setDraftFields([]);
    setFieldLabel(''); setFieldUnit(''); setFieldOptions(''); setFieldType('text');
  };

  const addType = async () => {
    if (!newTypeName.trim()) return;
    setAddBusy(true); setAddMsg(null);
    try {
      const { asset_type } = await createAssetType(tok(), { name: newTypeName.trim(), fields: draftFields });
      resetAddType(); selectType(asset_type.id); void load();
      setAddMsg({ text: `Type "${asset_type.name}" added.`, tone: 'success' });
    } catch (e) { setAddMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setAddBusy(false); }
  };

  const deleteType = async (ty: AssetType) => {
    setAddBusy(true); setAddMsg(null);
    try {
      await deleteAssetType(tok(), ty.id);
      if (typeId === ty.id) setTypeId(null);
      void load();
      setAddMsg({ text: `"${ty.name}" deleted.`, tone: 'success' });
    } catch (e) { setAddMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setAddBusy(false); }
  };

  // ── Tab content ──────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <>
      {!loading && (faults.length > 0 || upcoming.length > 0) && (
        <View style={s.summaryRow}>
          {faults.length > 0 && (
            <Card style={s.summaryCard}>
              <Pressable onPress={() => toggle('faults')} accessibilityRole="button" style={s.cardToggle}>
                <View style={s.cardToggleHeader}>
                  <Text style={[s.summaryNum, { color: t.color.danger }]}>{faults.length}</Text>
                  <Ionicons name={expandedCard === 'faults' ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} style={s.chevronTop} />
                </View>
                <Text variant="label">Open {faults.length === 1 ? 'fault' : 'faults'}</Text>
                <Text variant="small" muted>across {faultAssets} {faultAssets === 1 ? 'asset' : 'assets'}</Text>
              </Pressable>
              {expandedCard === 'faults' && (
                <View style={s.expandedContent}>
                  {faultPreview.map((f) => {
                    const assetName = assets.find((a) => a.id === f.asset_id)?.name;
                    return (
                      <Pressable key={f.id} onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/faults', params: { assetId: f.asset_id } })} accessibilityRole="button" style={s.itemLink}>
                        <Text variant="small" numberOfLines={1}>{f.name}</Text>
                        <Text variant="small" muted numberOfLines={1}>{[assetName, f.urgency].filter(Boolean).join(' · ')}</Text>
                      </Pressable>
                    );
                  })}
                  {moreFaults > 0 && <Text variant="small" color={t.color.primary}>+{moreFaults} more</Text>}
                </View>
              )}
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card style={s.summaryCard}>
              {maintenanceTotal > 0 ? (
                <Pressable onPress={() => toggle('maintenance')} accessibilityRole="button" style={s.cardToggle}>
                  <View style={s.cardToggleHeader}>
                    <Text style={[s.summaryNum, { color: overdue > 0 ? t.color.danger : t.color.primary }]}>{maintenanceTotal}</Text>
                    <Ionicons name={expandedCard === 'maintenance' ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} style={s.chevronTop} />
                  </View>
                  <Text variant="label">{overdue > 0 ? 'Services due' : 'Due soon'}</Text>
                  <Text variant="small" muted>
                    {overdue > 0 && dueSoon > 0 ? `${overdue} overdue · ${dueSoon} soon` : overdue > 0 ? `${overdue} overdue` : `${dueSoon} upcoming`}
                  </Text>
                </Pressable>
              ) : (
                <View style={s.cardToggle}>
                  <Text style={[s.summaryNum, { color: t.color.success }]}>✓</Text>
                  <Text variant="label">Maintenance</Text>
                  <Text variant="small" muted>All up to date</Text>
                </View>
              )}
              {expandedCard === 'maintenance' && maintenanceTotal > 0 && (
                <View style={s.expandedContent}>
                  {maintPreview.map((u) => {
                    const assetName = assets.find((a) => a.id === u.asset_id)?.name;
                    return (
                      <Pressable key={u.id} onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/maintenance', params: { assetId: u.asset_id } })} accessibilityRole="button" style={s.itemLink}>
                        <Text variant="small" numberOfLines={1}>{u.title}</Text>
                        <Text variant="small" muted numberOfLines={1}>
                          {[assetName, u.level === 'over' ? 'Overdue' : 'Due soon', u.due_date ? formatDMY(u.due_date) : null].filter(Boolean).join(' · ')}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {moreMaint > 0 && <Text variant="small" color={t.color.primary}>+{moreMaint} more</Text>}
                </View>
              )}
            </Card>
          )}
        </View>
      )}

      {loading
        ? <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>
        : assets.length === 0
          ? <Text muted style={{ paddingHorizontal: 4 }}>No assets yet.</Text>
          : (() => {
            const byType = types.map((ty) => ({ ty, items: assets.filter((a) => a.asset_type_id === ty.id) })).filter((g) => g.items.length > 0);
            const untyped = assets.filter((a) => !a.asset_type_id);
            const groups = [...byType, ...(untyped.length > 0 ? [{ ty: null, items: untyped }] : [])];
            return (
              <React.Fragment key="asset-list">
                {groups.map(({ ty, items }) => (
                  <View key={ty?.id ?? '__untyped__'} style={{ gap: 8 }}>
                    <SectionLabel right={<Text variant="small" muted>{items.length}</Text>}>
                      {ty?.name ?? 'Uncategorised'}
                    </SectionLabel>
                    <GroupedCard>
                      {items.map((a, i) => (
                        <GRow key={a.id} onPress={() => openAsset(a.id)} last={i === items.length - 1}>
                          {a.image_url
                            ? <Image source={{ uri: a.image_url }} style={{ width: 36, height: 36, borderRadius: 8 }} contentFit="cover" />
                            : <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name={assetTypeIcon(ty?.name)} size={18} color={t.color.text} />
                              </View>
                          }
                          <View style={{ flex: 1 }}>
                            <Text variant="label">{a.name}</Text>
                            {!!a.location && <Text variant="small" muted>{a.location}</Text>}
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                        </GRow>
                      ))}
                    </GroupedCard>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                  <Text variant="small" muted>Total</Text>
                  <Text variant="small" muted>{assets.length}</Text>
                </View>
              </React.Fragment>
            );
          })()
      }
    </>
  );

  const faultDotColor = (urgency: string | null) =>
    urgency === 'Critical' || urgency === 'High' ? t.color.danger
    : urgency === 'Medium' ? t.color.warning
    : t.color.textMuted;

  const renderSchedule = () => {
    const actionable = upcoming.filter((u) => u.level !== 'ok');
    const scheduled = upcoming.filter((u) => u.level === 'ok');
    if (loading) return <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>;
    if (!upcoming.length && !faults.length) return <Text muted style={{ paddingHorizontal: 4 }}>No maintenance schedules or open faults.</Text>;
    return (
      <>
        {actionable.length > 0 && (
          <View style={{ gap: 8 }}>
            <SectionLabel>Action needed</SectionLabel>
            <GroupedCard>
              {actionable.map((u, i) => {
                const assetName = assets.find((a) => a.id === u.asset_id)?.name;
                return (
                  <GRow key={u.id} onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/maintenance', params: { assetId: u.asset_id } })} last={i === actionable.length - 1}>
                    <View style={[s.levelDot(u.level), { marginTop: 0 }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="label" numberOfLines={1}>{u.title}</Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {[assetName, u.due_date ? formatDMY(u.due_date) : 'No date'].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text variant="small" color={u.level === 'over' ? t.color.danger : t.color.primary}>
                      {u.level === 'over' ? 'Overdue' : 'Due soon'}
                    </Text>
                  </GRow>
                );
              })}
            </GroupedCard>
          </View>
        )}

        {sortedFaults.length > 0 && (
          <View style={{ gap: 8 }}>
            <SectionLabel>Open faults</SectionLabel>
            <GroupedCard>
              {sortedFaults.map((f, i) => {
                const assetName = assets.find((a) => a.id === f.asset_id)?.name;
                const dotColor = faultDotColor(f.urgency);
                return (
                  <GRow key={f.id} onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/faults', params: { assetId: f.asset_id } })} last={i === sortedFaults.length - 1}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                    <View style={{ flex: 1 }}>
                      <Text variant="label" numberOfLines={1}>{f.name}</Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {[assetName, f.urgency].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text variant="small" color={dotColor}>{f.urgency ?? 'Fault'}</Text>
                  </GRow>
                );
              })}
            </GroupedCard>
          </View>
        )}

        {scheduled.length > 0 && (
          <View style={{ gap: 8 }}>
            <SectionLabel>Scheduled</SectionLabel>
            <GroupedCard>
              {scheduled.map((u, i) => {
                const assetName = assets.find((a) => a.id === u.asset_id)?.name;
                return (
                  <GRow key={u.id} onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/maintenance', params: { assetId: u.asset_id } })} last={i === scheduled.length - 1}>
                    <View style={[s.levelDot(u.level), { marginTop: 0 }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="label" numberOfLines={1}>{u.title}</Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {[assetName, u.due_date ? formatDMY(u.due_date) : 'No date set'].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </GRow>
                );
              })}
            </GroupedCard>
          </View>
        )}
      </>
    );
  };

  const renderAdd = () => (
    <>
      <View style={s.seg}>
        <Pressable style={[s.segBtn, addView === 'asset' && s.segBtnOn]} onPress={() => { setAddView('asset'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: addView === 'asset' }}>
          <Text variant="label" color={addView === 'asset' ? t.color.primaryText : t.color.textMuted}>Asset</Text>
        </Pressable>
        <Pressable style={[s.segBtn, addView === 'types' && s.segBtnOn]} onPress={() => { setAddView('types'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: addView === 'types' }}>
          <Text variant="label" color={addView === 'types' ? t.color.primaryText : t.color.textMuted}>Types</Text>
        </Pressable>
      </View>

      {addView === 'asset' && (
        <>
          {addMsg && <Notice message={addMsg.text} tone={addMsg.tone} />}

          <View style={{ gap: 8 }}>
            <View style={s.typePickerSectionHeader}>
              <SectionLabel>Type</SectionLabel>
              <Text variant="mono" muted style={{ fontSize: t.size.xs }}>{types.length}</Text>
            </View>
            <View style={s.typePickerList}>
              <View style={s.typePickerSearch}>
                <Ionicons name="search-outline" size={18} color={t.color.textMuted} />
                <TextInput
                  value={typeSearch}
                  onChangeText={setTypeSearch}
                  placeholder="Search types"
                  placeholderTextColor={t.color.textMuted}
                  style={{ flex: 1, fontSize: t.size.md, color: t.color.text }}
                />
              </View>
              {types
                .filter((ty) => ty.name.toLowerCase().includes(typeSearch.toLowerCase()))
                .map((ty) => {
                  const sel = typeId === ty.id;
                  return (
                    <Pressable key={ty.id} onPress={() => selectType(ty.id)} accessibilityRole="button"
                      style={s.typePickerItem(sel)}>
                      <View style={s.typePickerIcon(sel)}>
                        <Ionicons name={assetTypeIcon(ty.name)} size={18} color={sel ? t.color.primaryText : t.color.text} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="label">{ty.name}</Text>
                        {ty.fields.length > 0 && <Text variant="small" muted>{ty.fields.length} {ty.fields.length === 1 ? 'particular' : 'particulars'}</Text>}
                      </View>
                      {sel && <Ionicons name="checkmark" size={22} color={t.color.primary} />}
                    </Pressable>
                  );
                })}
              <Pressable onPress={() => { setAddView('types'); setAddMsg(null); }} accessibilityRole="button"
                style={[s.typePickerItem(false), s.typePickerItemLast]}>
                <View style={s.typePickerIcon(false)}>
                  <Ionicons name="add" size={20} color={t.color.text} />
                </View>
                <Text variant="label" style={{ flex: 1 }}>New type</Text>
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <SectionLabel>Details</SectionLabel>
            <GroupedCard>
              <NameRow value={assetName} onChange={setAssetName} />
            </GroupedCard>
          </View>

          {selectedType && selectedType.fields.length > 0 && (
            <View style={{ gap: 8 }}>
              <SectionLabel>{selectedType.name} particulars</SectionLabel>
              <ParticularsForm fields={selectedType.fields} value={particulars} onChange={setParticulars} />
            </View>
          )}

          <Button label="Add asset" onPress={addAsset} loading={addBusy} />
        </>
      )}

      {addView === 'types' && (
      <Card>
        {addMsg && <Notice message={addMsg.text} tone={addMsg.tone} />}
        {types.map((ty) => (
          <View key={ty.id} style={s.typeListRow}>
            <Text style={s.flex1}>{ty.name}</Text>
            <Button label="Delete" icon="trash-outline" variant="warning" onPress={() => deleteType(ty)} loading={addBusy} />
          </View>
        ))}
        {showAddType ? (
          <View style={s.addTypeSection}>
            <TextField label="Type name" value={newTypeName} onChangeText={setNewTypeName} placeholder="Type name" autoCapitalize="sentences" />
            {draftFields.map((f, i) => (
              <View key={f.key} style={s.typeListRow}>
                <View style={s.flex1}>
                  <Text>{f.label}</Text>
                  <Text variant="small" muted>{f.type}{f.unit ? ` · ${f.unit}` : ''}{f.options ? ` · ${f.options.join(', ')}` : ''}</Text>
                </View>
                <Button label="Remove" variant="ghost" onPress={() => setDraftFields(draftFields.filter((_, j) => j !== i))} />
              </View>
            ))}
            <View style={s.addFieldSection}>
              <Text variant="label" muted>Add a field</Text>
              <TextField label="Label" value={fieldLabel} onChangeText={setFieldLabel} placeholder="Field label" autoCapitalize="sentences" />
              <View style={s.typeRow}>
                {(['text', 'number', 'date', 'select'] as const).map((ft) => (
                  <Pressable key={ft} onPress={() => setFieldType(ft)} accessibilityRole="button" style={s.typeChip(fieldType === ft)}>
                    <Text variant="label" color={fieldType === ft ? t.color.primaryText : t.color.text}>{ft}</Text>
                  </Pressable>
                ))}
              </View>
              {fieldType === 'number' && (
                <TextField label="Unit (optional)" value={fieldUnit} onChangeText={setFieldUnit} placeholder="Unit" autoCapitalize="none" />
              )}
              {fieldType === 'select' && (
                <TextField label="Options (comma-separated)" value={fieldOptions} onChangeText={setFieldOptions} placeholder="Option 1, Option 2" autoCapitalize="sentences" />
              )}
              <Button label="Add field" variant="secondary" onPress={addField} />
            </View>
            <Button label="Save type" onPress={addType} loading={addBusy} />
            <Button label="Cancel" variant="ghost" onPress={resetAddType} />
          </View>
        ) : (
          <Button label="Add type" variant="ghost" icon="add-outline" onPress={() => setShowAddType(true)} />
        )}
      </Card>
      )}
    </>
  );

  return (
    <Screen>
      <OfflineBanner offline={offline} />
      <PendingSyncBanner count={pending} onSync={() => doSync(true)} busy={false} />

      <View style={s.seg}>
        <Pressable style={[s.segBtn, tab === 'overview' && s.segBtnOn]} onPress={() => setTab('overview')} accessibilityRole="button" accessibilityState={{ selected: tab === 'overview' }}>
          <Text variant="label" color={tab === 'overview' ? t.color.primaryText : t.color.textMuted}>Overview</Text>
        </Pressable>
        {isAdmin && (
          <Pressable style={[s.segBtn, tab === 'add' && s.segBtnOn]} onPress={() => { setTab('add'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: tab === 'add' }}>
            <Text variant="label" color={tab === 'add' ? t.color.primaryText : t.color.textMuted}>+ Add</Text>
          </Pressable>
        )}
        <Pressable style={[s.segBtn, tab === 'schedule' && s.segBtnOn]} onPress={() => setTab('schedule')} accessibilityRole="button" accessibilityState={{ selected: tab === 'schedule' }}>
          <Text variant="label" color={tab === 'schedule' ? t.color.primaryText : t.color.textMuted}>Schedule</Text>
        </Pressable>
      </View>

      {tab === 'overview' && renderOverview()}
      {tab === 'add' && renderAdd()}
      {tab === 'schedule' && renderSchedule()}
    </Screen>
  );
}
