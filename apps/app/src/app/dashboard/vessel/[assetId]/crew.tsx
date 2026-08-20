import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Person, VesselAsset, VesselAssetAssignment, VesselAssetType } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listPeople, createPerson, listVesselAssignments, listVesselAssetTypes, upsertVesselAssignment, deleteVesselAssignment } from '@/lib/api';
import { loadAsset } from '@/lib/vessel-sync';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Row, TextField } from '@/ui/components';

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

export default function VesselCrew() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [asset, setAsset] = useState<VesselAsset | null>(null);
  const [assetType, setAssetType] = useState<VesselAssetType | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<VesselAssetAssignment[]>([]);
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
      listVesselAssignments(tok(), assetId),
      listVesselAssetTypes(tok()),
    ]);
    const type = asset_types.find((t) => t.id === a?.asset_type_id) ?? null;
    setAsset(a); setAssetType(type); setPeople(ps); setAssignments(as_);
    setRole((r) => r || type?.roles[0] || FALLBACK_ROLES[0]);
  };
  useEffect(() => { void load(); }, [assetId]);

  if (features && !features.vessel) return <Redirect href="/dashboard" />;

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
      await upsertVesselAssignment(tok(), { person_id: personId, asset_id: assetId, role });
      setPickedId(null); setMsg({ text: 'Assigned.', tone: 'success' });
      await load();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setMsg(null);
    try { await deleteVesselAssignment(tok(), id); await load(); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.push({ pathname: '/dashboard/vessel/[assetId]', params: { assetId } })} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>{asset?.name ?? 'Vessel'}</Text>
      </Pressable>
      <Text variant="title">Assigned people</Text>

      <Card>
        <Text variant="heading">Currently assigned</Text>
        {assignedPeople.length === 0
          ? <Text muted>No one assigned yet.</Text>
          : assignedPeople.map(({ assignment: a, person: p }) => (
            <View key={a.id} style={s.personItem}>
              <View style={s.personRow}>
                <Ionicons name="person-outline" size={18} color={t.color.textMuted} />
                <View style={s.personInfo}>
                  <Text>{p?.name ?? 'Unknown'}</Text>
                  {!!a.role && <Text variant="small" muted>{a.role}</Text>}
                </View>
                {isAdmin && (
                  <Pressable onPress={() => remove(a.id)} accessibilityRole="button" accessibilityLabel="Remove">
                    <Ionicons name="close-circle-outline" size={20} color={t.color.textMuted} />
                  </Pressable>
                )}
              </View>
            </View>
          ))}
      </Card>

      {/* Add from roster — admins only */}
      {isAdmin && (
        <Card>
          <Text variant="heading">Add from roster</Text>
          <>
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
                  <Row key={p.id} onPress={() => setPickedId(pickedId === p.id ? null : p.id)}>
                    <Ionicons
                      name={pickedId === p.id ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={pickedId === p.id ? t.color.primary : t.color.textMuted}
                    />
                    <View style={s.personInfo}>
                      <Text>{p.name}</Text>
                      {!!p.email && <Text variant="small" muted>{p.email}</Text>}
                    </View>
                  </Row>
                ))
            )}

            <Button label="Assign" onPress={addCrew} loading={busy} style={s.assignBtn} />
          </>
        </Card>
      )}

    </Screen>
  );
}
