import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDMY } from '@/lib/format';
import type { VesselAsset, VesselAssetType, VesselFault, VesselFieldDef, VesselUpcomingItem } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listVesselAssets, listVesselAssetTypes, listVesselFaults, getVesselUpcoming, createVesselAsset, createVesselAssetType, deleteVesselAssetType } from '@/lib/api';
import { readThrough } from '@/lib/mirror';
import { pendingCount } from '@/lib/outbox';
import { syncVesselOutbox } from '@/lib/vessel-sync';
import { useOnReconnect } from '@/lib/use-reconnect';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Row, Button, TextField, Notice } from '@/ui/components';
import { OfflineBanner, PendingSyncBanner } from '@/ui/status';
import { ParticularsForm } from '@/ui/vessel';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type Tab = 'overview' | 'add' | 'schedule';
const tok = () => getAccessToken()!;

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
  assetInfo: { flex: 1 },
  summaryRow: { flexDirection: 'row' as const, gap: t.space.sm },
  summaryCard: { flex: 1, gap: t.space.xs },
  summaryNum: { fontSize: 32, fontWeight: '800' as const, lineHeight: 36 },
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md, padding: 3, marginBottom: t.space.sm },
  segBtn: { flex: 1, paddingVertical: t.space.sm, borderRadius: t.radius.sm, alignItems: 'center' as const },
  segBtnOn: { backgroundColor: t.color.surface },
  cardToggle: { gap: t.space.xs },
  cardToggleHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const },
  chevronTop: { marginTop: 6 },
  expandedContent: { borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: t.space.md, gap: t.space.sm },
  itemLink: { gap: 2 },
  groupHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  scheduleRow: { flexDirection: 'row' as const, gap: t.space.sm, paddingVertical: t.space.xs },
  scheduleInfo: { flex: 1, gap: 2 },
  flex1: { flex: 1 },
  addTypeSection: { gap: t.space.md, borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: t.space.md },
  addFieldSection: { gap: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: t.space.md },
  levelDot: (level: VesselUpcomingItem['level']) => ({
    width: 8, height: 8, borderRadius: 4, marginTop: 5,
    backgroundColor: level === 'over' ? t.color.danger : level === 'due' ? t.color.primary : t.color.border,
  }),
  typeRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  typeChip: (sel: boolean) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: t.space.sm, paddingLeft: t.space.md, paddingRight: t.space.sm, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  typeListRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 6 },
  totalRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: t.space.md, paddingVertical: t.space.sm },
});

export default function AssetManager() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [tab, setTab] = useState<Tab>('overview');
  const [assets, setAssets] = useState<VesselAsset[]>([]);
  const [types, setTypes] = useState<VesselAssetType[]>([]);
  const [faults, setFaults] = useState<VesselFault[]>([]);
  const [upcoming, setUpcoming] = useState<VesselUpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(pendingCount());
  const [expandedCard, setExpandedCard] = useState<'faults' | 'maintenance' | null>(null);

  // Add tab sub-view
  const [addView, setAddView] = useState<'asset' | 'types'>('asset');
  // Add-asset form
  const [addMsg, setAddMsg] = useState<Msg | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [particulars, setParticulars] = useState<Record<string, string>>({});
  // Add-type form
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [draftFields, setDraftFields] = useState<VesselFieldDef[]>([]);
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<VesselFieldDef['type']>('text');
  const [fieldUnit, setFieldUnit] = useState('');
  const [fieldOptions, setFieldOptions] = useState('');

  const slugify = (str: string) => str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const selectedType = types.find((ty) => ty.id === typeId) ?? null;
  const selectType = (id: string) => { setTypeId(id); setParticulars({}); };

  const load = async () => {
    setLoading(true);
    try {
      const [a, f, u, ty] = await Promise.all([
        readThrough('vessel:assets', () => listVesselAssets(tok())),
        readThrough('vessel:faults:all', () => listVesselFaults(tok())),
        readThrough('vessel:upcoming:all', () => getVesselUpcoming(tok())),
        readThrough('vessel:asset-types', () => listVesselAssetTypes(tok())),
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
    const { remaining } = await syncVesselOutbox();
    setPending(remaining);
    if (reload) void load();
  };
  useEffect(() => { void load(); void doSync(); }, []);
  useOnReconnect(() => { void doSync(true); });

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

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
  const openAsset = (id: string) => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId: id } });

  // ── Add-asset actions ─────────────────────────────────────────────────────────
  const addAsset = async () => {
    if (!assetName.trim()) { setAddMsg({ text: 'Asset name is required.', tone: 'error' }); return; }
    if (!typeId) { setAddMsg({ text: 'Select an asset type.', tone: 'error' }); return; }
    setAddBusy(true); setAddMsg(null);
    try {
      await createVesselAsset(tok(), { asset_type_id: typeId, name: assetName.trim(), particulars });
      setAssetName(''); setParticulars({}); setTab('overview'); void load();
    } catch (e) { setAddMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); setAddBusy(false); }
  };

  const addField = () => {
    if (!fieldLabel.trim()) return;
    const key = slugify(fieldLabel.trim()) || `field_${draftFields.length + 1}`;
    const field: VesselFieldDef = {
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
      const { asset_type } = await createVesselAssetType(tok(), { name: newTypeName.trim(), fields: draftFields });
      resetAddType(); selectType(asset_type.id); void load();
      setAddMsg({ text: `Type "${asset_type.name}" added.`, tone: 'success' });
    } catch (e) { setAddMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setAddBusy(false); }
  };

  const deleteType = async (ty: VesselAssetType) => {
    setAddBusy(true); setAddMsg(null);
    try {
      await deleteVesselAssetType(tok(), ty.id);
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
                      <Pressable key={f.id} onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/faults', params: { assetId: f.asset_id } })} accessibilityRole="button" style={s.itemLink}>
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
                      <Pressable key={u.id} onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId: u.asset_id } })} accessibilityRole="button" style={s.itemLink}>
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
        ? <Card><Text muted>Loading…</Text></Card>
        : assets.length === 0
          ? <Card><Text muted>No assets yet.</Text></Card>
          : (() => {
            const byType = types.map((ty) => ({ ty, items: assets.filter((a) => a.asset_type_id === ty.id) })).filter((g) => g.items.length > 0);
            const untyped = assets.filter((a) => !a.asset_type_id);
            const groups = [...byType, ...(untyped.length > 0 ? [{ ty: null, items: untyped }] : [])];
            return (
              <React.Fragment key="asset-list">
                {groups.map(({ ty, items }) => (
                  <Card key={ty?.id ?? '__untyped__'}>
                    <View style={s.groupHeader}>
                      <Text variant="heading">{ty?.name ?? 'Uncategorised'}</Text>
                      <Text variant="small" muted>{items.length}</Text>
                    </View>
                    {items.map((a) => (
                      <Row key={a.id} onPress={() => openAsset(a.id)}>
                        <Ionicons name={assetTypeIcon(ty?.name)} size={20} color={t.color.text} />
                        <View style={s.assetInfo}>
                          <Text>{a.name}</Text>
                          {!!a.location && <Text variant="small" muted>{a.location}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                      </Row>
                    ))}
                  </Card>
                ))}
                <View style={s.totalRow}>
                  <Text variant="label" muted>Total</Text>
                  <Text variant="label">{assets.length}</Text>
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
    if (loading) return <Card><Text muted>Loading…</Text></Card>;
    if (!upcoming.length && !faults.length) return <Card><Text muted>No maintenance schedules or open faults.</Text></Card>;
    return (
      <>
        {actionable.length > 0 && (
          <Card>
            {actionable.map((u) => {
              const assetName = assets.find((a) => a.id === u.asset_id)?.name;
              return (
                <Pressable key={u.id} onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId: u.asset_id } })} accessibilityRole="button"
                  style={s.scheduleRow}>
                  <View style={s.levelDot(u.level)} />
                  <View style={s.scheduleInfo}>
                    <Text numberOfLines={1}>{u.title}</Text>
                    <Text variant="small" muted numberOfLines={1}>
                      {[assetName, u.due_date ? formatDMY(u.due_date) : 'No date'].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text variant="small" color={u.level === 'over' ? t.color.danger : t.color.primary}>
                    {u.level === 'over' ? 'Overdue' : 'Due soon'}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        )}

        {sortedFaults.length > 0 && (
          <>
            <Text variant="heading">Open faults</Text>
            <Card>
              {sortedFaults.map((f) => {
                const assetName = assets.find((a) => a.id === f.asset_id)?.name;
                const dotColor = faultDotColor(f.urgency);
                return (
                  <Pressable key={f.id} onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/faults', params: { assetId: f.asset_id } })} accessibilityRole="button"
                    style={s.scheduleRow}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: dotColor }} />
                    <View style={s.scheduleInfo}>
                      <Text numberOfLines={1}>{f.name}</Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {[assetName, f.urgency].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text variant="small" color={dotColor}>{f.urgency ?? 'Fault'}</Text>
                  </Pressable>
                );
              })}
            </Card>
          </>
        )}

        {scheduled.length > 0 && (
          <>
            <Text variant="heading">Scheduled</Text>
            <Card>
              {scheduled.map((u) => {
                const assetName = assets.find((a) => a.id === u.asset_id)?.name;
                return (
                  <Pressable key={u.id} onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]/maintenance', params: { assetId: u.asset_id } })} accessibilityRole="button"
                    style={s.scheduleRow}>
                    <View style={s.levelDot(u.level)} />
                    <View style={s.scheduleInfo}>
                      <Text numberOfLines={1}>{u.title}</Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {[assetName, u.due_date ? formatDMY(u.due_date) : 'No date set'].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          </>
        )}
      </>
    );
  };

  const renderAdd = () => (
    <>
      <View style={s.seg}>
        <Pressable style={[s.segBtn, addView === 'asset' && s.segBtnOn]} onPress={() => { setAddView('asset'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: addView === 'asset' }}>
          <Text variant="label" color={addView === 'asset' ? t.color.primary : t.color.textMuted}>Asset</Text>
        </Pressable>
        <Pressable style={[s.segBtn, addView === 'types' && s.segBtnOn]} onPress={() => { setAddView('types'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: addView === 'types' }}>
          <Text variant="label" color={addView === 'types' ? t.color.primary : t.color.textMuted}>Types</Text>
        </Pressable>
      </View>

      {addView === 'asset' && (
        <Card>
          {addMsg && <Notice message={addMsg.text} tone={addMsg.tone} />}
          <TextField label="Name" value={assetName} onChangeText={setAssetName} placeholder="e.g. Yard Truck 1" autoCapitalize="sentences" />
          <Text variant="label" muted>Type</Text>
          {types.length === 0
            ? <Text variant="small" muted>Add a type in the Types tab first.</Text>
            : (
              <View style={s.typeRow}>
                {types.map((ty) => {
                  const sel = typeId === ty.id;
                  return (
                    <Pressable key={ty.id} onPress={() => selectType(ty.id)} accessibilityRole="button" style={s.typeChip(sel)}>
                      <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{ty.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )
          }
          {selectedType && selectedType.fields.length > 0 && (
            <ParticularsForm fields={selectedType.fields} value={particulars} onChange={setParticulars} />
          )}
          <Button label="Save asset" onPress={addAsset} loading={addBusy} />
        </Card>
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
            <TextField label="Type name" value={newTypeName} onChangeText={setNewTypeName} placeholder="e.g. Watercraft, Tools" autoCapitalize="sentences" />
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
              <TextField label="Label" value={fieldLabel} onChangeText={setFieldLabel} placeholder="e.g. Registration plate" autoCapitalize="sentences" />
              <View style={s.typeRow}>
                {(['text', 'number', 'date', 'select'] as const).map((ft) => (
                  <Pressable key={ft} onPress={() => setFieldType(ft)} accessibilityRole="button" style={s.typeChip(fieldType === ft)}>
                    <Text variant="label" color={fieldType === ft ? t.color.primaryText : t.color.text}>{ft}</Text>
                  </Pressable>
                ))}
              </View>
              {fieldType === 'number' && (
                <TextField label="Unit (optional)" value={fieldUnit} onChangeText={setFieldUnit} placeholder="e.g. km, hrs, litres" autoCapitalize="none" />
              )}
              {fieldType === 'select' && (
                <TextField label="Options (comma-separated)" value={fieldOptions} onChangeText={setFieldOptions} placeholder="e.g. Petrol, Diesel, Electric" autoCapitalize="sentences" />
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
          <Text variant="label" color={tab === 'overview' ? t.color.primary : t.color.textMuted}>Overview</Text>
        </Pressable>
        {isAdmin && (
          <Pressable style={[s.segBtn, tab === 'add' && s.segBtnOn]} onPress={() => { setTab('add'); setAddMsg(null); }} accessibilityRole="button" accessibilityState={{ selected: tab === 'add' }}>
            <Text variant="label" color={tab === 'add' ? t.color.primary : t.color.textMuted}>+ Add</Text>
          </Pressable>
        )}
        <Pressable style={[s.segBtn, tab === 'schedule' && s.segBtnOn]} onPress={() => setTab('schedule')} accessibilityRole="button" accessibilityState={{ selected: tab === 'schedule' }}>
          <Text variant="label" color={tab === 'schedule' ? t.color.primary : t.color.textMuted}>Schedule</Text>
        </Pressable>
      </View>

      {tab === 'overview' && renderOverview()}
      {tab === 'add' && renderAdd()}
      {tab === 'schedule' && renderSchedule()}
    </Screen>
  );
}
