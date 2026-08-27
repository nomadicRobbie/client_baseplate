import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Person, Asset, AssetAssignment, AssetType } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listPeople, createPerson, listAssetAssignments, listAssetTypes, upsertAssetAssignment, deleteAssetAssignment } from '@/lib/api';
import { loadAsset } from '@/lib/asset-sync';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, SectionLabel, Button, TextField } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' | 'info' };
type ThemeT = ReturnType<typeof useTheme>;
const FALLBACK_ROLES = ['Assignee'];
const tok = () => getAccessToken()!;

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  roleRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  assignBtn: { marginTop: t.space.sm },
  rolePill: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  personItem: { paddingVertical: t.space.sm },
  personRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  personInfo: { flex: 1 },
});

export default function AssetCrew() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [role, setRole] = useState('');
  // contractor-specific fields (shown when role is 'Contractor')
  const [contractorName, setContractorName] = useState('');
  const [contractorEmail, setContractorEmail] = useState('');
  const [contractorBusiness, setContractorBusiness] = useState('');

  const load = async () => {
    const [{ asset: a }, { people: ps }, { assignments: as_ }, { asset_types }] = await Promise.all([
      loadAsset(assetId),
      listPeople(tok(), { active: true }),
      listAssetAssignments(tok(), assetId),
      listAssetTypes(tok()),
    ]);
    const type = asset_types.find((t) => t.id === a?.asset_type_id) ?? null;
    setAsset(a); setAssetType(type); setPeople(ps); setAssignments(as_);
    setRole((r) => r || type?.roles[0] || FALLBACK_ROLES[0]);
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.asset) return <Redirect href="/dashboard" />;

  const assignedIds = new Set(assignments.map((a) => a.person_id));
  const unassigned = people.filter((p) => !assignedIds.has(p.id));
  const assignedPeople = assignments.map((a) => ({ assignment: a, person: people.find((p) => p.id === a.person_id) }));

  const isContractor = role.toLowerCase() === 'contractor';

  const addCrew = async () => {
    setBusy(true); setMsg(null);
    try {
      let personId = pickedId;
      if (isContractor) {
        if (!contractorName.trim()) { setMsg({ text: 'Contractor name is required.', tone: 'error' }); setBusy(false); return; }
        // find existing person by email, or create a login-less one
        const email = contractorEmail.trim() || null;
        const existing = email ? people.find((p) => p.email?.toLowerCase() === email.toLowerCase()) : null;
        if (existing) {
          personId = existing.id;
        } else {
          const displayName = contractorBusiness.trim()
            ? `${contractorName.trim()} (${contractorBusiness.trim()})`
            : contractorName.trim();
          const { person } = await createPerson(tok(), { name: displayName, email });
          personId = person.id;
        }
        setContractorName(''); setContractorEmail(''); setContractorBusiness('');
      }
      if (!personId) { setMsg({ text: 'Select a person first.', tone: 'error' }); setBusy(false); return; }
      await upsertAssetAssignment(tok(), { person_id: personId, asset_id: assetId, role });
      setPickedId(null); setMsg({ text: 'Assigned.', tone: 'success' });
      await load();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setMsg(null);
    try { await deleteAssetAssignment(tok(), id); await load(); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Asset'}</Text>
      </Pressable>
      <View style={{ gap: 8 }}>
        <SectionLabel right={assignedPeople.length > 0 ? <Text variant="small" muted>{assignedPeople.length}</Text> : undefined}>Assigned</SectionLabel>
        {assignedPeople.length === 0
          ? <Text muted style={{ paddingHorizontal: 4 }}>No one assigned yet.</Text>
          : (
            <GroupedCard>
              {assignedPeople.map(({ assignment: a, person: p }, i) => (
                <GRow key={a.id} last={i === assignedPeople.length - 1}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="person-outline" size={18} color={t.color.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{p?.name ?? 'Unknown'}</Text>
                    {!!a.role && <Text variant="small" muted>{a.role}</Text>}
                  </View>
                  {isAdmin && (
                    <Pressable onPress={() => remove(a.id)} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8}>
                      <Ionicons name="close-circle-outline" size={20} color={t.color.textMuted} />
                    </Pressable>
                  )}
                </GRow>
              ))}
            </GroupedCard>
          )}
      </View>

      {isAdmin && (
        <View style={{ gap: 8 }}>
          <SectionLabel>Add from roster</SectionLabel>
          <Card>
            <Text variant="label" muted>Role</Text>
            <View style={s.roleRow}>
              {(assetType?.roles.length ? assetType.roles : FALLBACK_ROLES).map((r) => (
                <Pressable key={r} onPress={() => { setRole(r); setPickedId(null); }} accessibilityRole="button" style={s.rolePill(role === r)}>
                  <Text variant="label" color={role === r ? t.color.primaryText : t.color.text}>{r}</Text>
                </Pressable>
              ))}
            </View>

            {isContractor ? (
              <>
                <TextField label="Name" value={contractorName} onChangeText={setContractorName} placeholder="Contact name" autoCapitalize="sentences" />
                <TextField label="Business / company" value={contractorBusiness} onChangeText={setContractorBusiness} placeholder="Optional" autoCapitalize="sentences" />
                <TextField label="Email" value={contractorEmail} onChangeText={setContractorEmail} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
              </>
            ) : (
              unassigned.length === 0
                ? <Text variant="small" muted>Everyone on the roster is already assigned.</Text>
                : unassigned.map((p) => (
                  <GRow key={p.id} onPress={() => setPickedId(pickedId === p.id ? null : p.id)}>
                    <Ionicons
                      name={pickedId === p.id ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={pickedId === p.id ? t.color.primary : t.color.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="label">{p.name}</Text>
                      {!!p.email && <Text variant="small" muted>{p.email}</Text>}
                    </View>
                  </GRow>
                ))
            )}

            <Button label="Assign" onPress={addCrew} loading={busy} style={s.assignBtn} />
          </Card>
        </View>
      )}

    </Screen>
  );
}
