import { useEffect, useState } from 'react';
import { View, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, AssetType, RequiredRole } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { getServiceManifest, updateService, updateServiceTemplate, generateServiceInstances, listAssets, listAssetTypes, addServiceAssignment, removeServiceAssignment } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Button, Toggle } from '@/ui/components';
import { DateTimeField } from '@/ui/datetime-field';
import { SelectField } from '@/ui/select-field';
import { localDate } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

function toLocalISO(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addDays(date: string, n: number): string {
  return localDate(new Date(new Date(date).getTime() + n * 86_400_000));
}

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  field: { gap: t.space.xs },
  input: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  inputError: { borderColor: t.color.danger },
  roleChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.xs,
    backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill,
    paddingHorizontal: t.space.md, paddingVertical: t.space.xs,
  },
  roleInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  roleCountInput: { width: 48, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.sm, color: t.color.text, fontSize: 14, textAlign: 'center' as const },
  flex1: { flex: 1 },
});

export default function EditServiceScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState('');
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [origAssetId, setOrigAssetId] = useState<string | null>(null);
  const [origAssetAssignmentId, setOrigAssetAssignmentId] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [roles, setRoles] = useState<RequiredRole[]>([]);
  const [newRole, setNewRole] = useState<string | null>(null);
  const [newRoleCount, setNewRoleCount] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applyToAll, setApplyToAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    if (!serviceId) return;
    void (async () => {
      try {
        const tok = getAccessToken()!;
        const [r, assetRes, atRes] = await Promise.all([
          getServiceManifest(tok, serviceId),
          listAssets(tok),
          listAssetTypes(tok),
        ]);
        const svc = r.manifest.service;
        const durationMin = Math.round((new Date(svc.ends_at).getTime() - new Date(svc.starts_at).getTime()) / 60_000);
        setName(svc.name);
        setStartsAt(toLocalISO(svc.starts_at));
        setDuration(String(durationMin));
        setFacilityId(svc.facility_id ?? null);
        setNotes(svc.notes ?? '');
        setTemplateId(svc.template_id);
        setVersion(svc.version);
        setRoles((svc.required_roles as RequiredRole[]) ?? []);
        setAssets(assetRes.assets);
        setAssetTypes(atRes.asset_types);
        const currentAsset = r.manifest.assets[0];
        if (currentAsset) {
          setAssetId(currentAsset.asset_id);
          setOrigAssetId(currentAsset.asset_id);
          setOrigAssetAssignmentId(currentAsset.assignment_id);
        }
      } catch (e) {
        setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
      } finally {
        setLoading(false);
      }
    })();
  }, [serviceId]);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const clearErr = (...keys: string[]) =>
    setErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))));

  const facilitiesTypeId = assetTypes.find(at => at.name === 'Facilities')?.id;
  const facilities = assets.filter(a => a.asset_type_id === facilitiesTypeId);
  const selectedAsset = assets.find(a => a.id === assetId);
  const selectedType = assetTypes.find(at => at.id === selectedAsset?.asset_type_id);
  const availableRoles = selectedType?.roles ?? [];

  const addRole = () => {
    if (!newRole) return;
    const c = Math.max(1, parseInt(newRoleCount, 10) || 1);
    const existing = roles.find(x => x.role === newRole);
    if (existing) {
      setRoles(roles.map(x => x === existing ? { ...x, count: x.count + c } : x));
    } else {
      setRoles([...roles, { role: newRole, count: c }]);
    }
    setNewRole(null);
    setNewRoleCount('1');
    clearErr('roles');
  };

  const removeRole = (idx: number) => setRoles(roles.filter((_, i) => i !== idx));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!startsAt) e.startsAt = 'Start time is required';
    if (!duration || isNaN(Number(duration)) || Number(duration) < 1) e.duration = 'Must be a positive number';
    if (roles.length === 0) e.roles = 'Add at least one required role';
    return e;
  };

  const applyToSeries = async (tok: string) => {
    if (!templateId) return;
    const today = localDate();
    await updateServiceTemplate(tok, templateId, {
      name: name.trim(),
      duration_minutes: Number(duration),
      facility_id: facilityId,
      required_roles: roles,
      default_asset_id: assetId,
    });
    await generateServiceInstances(tok, templateId, today, addDays(today, 365));
  };

  const doUpdate = async (tok: string, v: number) => {
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + Number(duration) * 60_000);
    return updateService(tok, serviceId!, {
      name: name.trim(),
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      facility_id: facilityId,
      notes: notes.trim(),
      required_roles: roles,
      version: v,
    });
  };

  const syncAsset = async (tok: string) => {
    if (assetId === origAssetId) return;
    if (origAssetAssignmentId) {
      await removeServiceAssignment(tok, serviceId!, origAssetAssignmentId);
    }
    if (assetId) {
      await addServiceAssignment(tok, serviceId!, { subject_type: 'asset', subject_id: assetId });
    }
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true); setMsg(null);
    const detail = { pathname: '/dashboard/schedule/[serviceId]' as const, params: { serviceId: serviceId! } };
    try {
      const tok = getAccessToken()!;
      let currentVersion = version;

      try {
        await doUpdate(tok, currentVersion);
      } catch (err) {
        // Version conflict: a previous save went through but navigation failed.
        // Re-fetch the fresh version and retry once automatically.
        if (err instanceof Error && err.message.toLowerCase().includes('version')) {
          const fresh = await getServiceManifest(tok, serviceId!);
          currentVersion = fresh.manifest.service.version;
          setVersion(currentVersion);
          await doUpdate(tok, currentVersion);
        } else {
          throw err;
        }
      }

      await syncAsset(tok);
      if (templateId && applyToAll) {
        try { await applyToSeries(tok); } catch { /* best-effort */ }
      }
      router.replace(detail);
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), tone: 'error' });
      setSaving(false);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Event</Text>
      </Pressable>

      <Text variant="title">Edit event</Text>

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : (
        <>
          {templateId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
              <Ionicons name="repeat" size={14} color={t.color.textMuted} />
              <Text variant="small" muted>Part of a recurring series</Text>
            </View>
          ) : null}
          <View style={s.field}>
            <Text variant="label">Name</Text>
            <TextInput
              value={name}
              onChangeText={v => { setName(v); clearErr('name'); }}
              placeholderTextColor={t.color.textMuted}
              style={[s.input, errors.name ? s.inputError : undefined]}
            />
            {errors.name ? <Text variant="small" color={t.color.danger}>{errors.name}</Text> : null}
          </View>

          <DateTimeField
            label="Starts"
            value={startsAt}
            onChange={v => { setStartsAt(v); clearErr('startsAt'); }}
            error={errors.startsAt}
          />

          <View style={s.field}>
            <Text variant="label">Duration (minutes)</Text>
            <TextInput
              value={duration}
              onChangeText={v => { setDuration(v); clearErr('duration'); }}
              keyboardType="numeric"
              placeholderTextColor={t.color.textMuted}
              style={[s.input, errors.duration ? s.inputError : undefined]}
            />
            {errors.duration ? <Text variant="small" color={t.color.danger}>{errors.duration}</Text> : null}
          </View>

          {facilities.length > 0 && (
            <SelectField
              label="Facility"
              value={facilityId}
              onChange={setFacilityId}
              placeholder="None"
              options={facilities.map(f => ({ label: f.name, value: f.id }))}
            />
          )}

          <View style={s.field}>
            <Text variant="label">Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholderTextColor={t.color.textMuted}
              style={[s.input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </View>

          {assets.length > 0 && (
            <SelectField
              label="Asset"
              value={assetId}
              onChange={v => { setAssetId(v); setRoles([]); setNewRole(null); }}
              placeholder="None"
              options={assets.map(a => ({ label: a.name, value: a.id }))}
            />
          )}

          <View style={s.field}>
            <Text variant="label">Required crew</Text>
            {roles.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs }}>
                {roles.map((r, i) => (
                  <Pressable key={i} onPress={() => removeRole(i)} style={s.roleChip} accessibilityRole="button">
                    <Text variant="small">{r.count}x {r.role}</Text>
                    <Ionicons name="close" size={14} color={t.color.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}
            {availableRoles.length > 0 ? (
              <View style={s.roleInputRow}>
                <View style={s.flex1}>
                  <SelectField
                    label=""
                    value={newRole}
                    onChange={setNewRole}
                    placeholder="Select role"
                    options={availableRoles.map(r => ({ label: r, value: r }))}
                  />
                </View>
                <TextInput
                  value={newRoleCount}
                  onChangeText={setNewRoleCount}
                  keyboardType="numeric"
                  placeholderTextColor={t.color.textMuted}
                  style={s.roleCountInput}
                />
                <Pressable onPress={addRole} accessibilityRole="button" accessibilityLabel="Add role">
                  <Ionicons name="add-circle-outline" size={24} color={t.color.primary} />
                </Pressable>
              </View>
            ) : (
              <Text variant="small" muted>Select an asset to see available roles</Text>
            )}
            {errors.roles ? <Text variant="small" color={t.color.danger}>{errors.roles}</Text> : null}
          </View>

          {templateId && (
            <Toggle
              value={applyToAll}
              onChange={setApplyToAll}
              label="Update all future events in this series"
            />
          )}

          <Button label="Save changes" onPress={save} loading={saving} />
        </>
      )}
    </Screen>
  );
}
