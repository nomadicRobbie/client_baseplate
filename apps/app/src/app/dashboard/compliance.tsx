import { useEffect, useState } from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import type { FoodControlPlan } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listPlans, createPlan, updatePlan, duplicatePlan, uploadPlanImage } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, SectionLabel, Button, Notice, Badge, Pill } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' | 'info' } | null;
const TIERS = ['FCP', 'NP1', 'NP2', 'NP3'] as const;

const makeStyles = (t: ThemeT) => StyleSheet.create({
  rowWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  input:      { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, minHeight: 44, fontSize: t.size.md, color: t.color.text },
  fieldGroup: { gap: t.space.xs },
  flexGrow1:  { flexGrow: 1 },
  planInfo:   { flex: 1 },
  actions:    { flexDirection: 'row', gap: t.space.sm, alignItems: 'center' },
});


export default function CompliancePlans() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const tok = () => getAccessToken()!;

  const [plans, setPlans] = useState<FoodControlPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<typeof TIERS[number]>('FCP');
  const [busy, setBusy] = useState(false);

  // Duplicate form
  const [dupId, setDupId] = useState<string | null>(null);
  const [dupName, setDupName] = useState('');

  // Image upload
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const pickImage = async (planId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setMsg({ text: 'Photo library access is required.', tone: 'error' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploadingId(planId);
    try {
      await uploadPlanImage(tok(), planId, result.assets[0].uri);
      await load();
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setUploadingId(null); }
  };

  const load = async () => {
    setLoading(true);
    try { setPlans((await listPlans(tok())).plans); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (features && !features.compliance) return <Redirect href="/dashboard" />;

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const { plan } = await createPlan(tok(), { name: newName.trim(), tier: newTier });
      setNewName(''); setCreating(false);
      router.push({ pathname: '/dashboard/compliance/[planId]', params: { planId: plan.id } });
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const deactivate = async (id: string) => {
    try { await updatePlan(tok(), id, { active: false }); await load(); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
  };

  const doDuplicate = async () => {
    if (!dupId || !dupName.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await duplicatePlan(tok(), dupId, dupName.trim());
      setDupId(null); setDupName('');
      await load();
    } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={{ gap: 8 }}>
        <SectionLabel right={plans.length > 0 ? <Text variant="small" muted>{plans.length}</Text> : undefined}>Control plans</SectionLabel>
        {loading ? (
          <Text muted style={{ paddingHorizontal: 4 }}>Loading…</Text>
        ) : plans.length === 0 ? (
          <Text muted style={{ paddingHorizontal: 4 }}>
            {isAdmin ? 'No control plans yet.' : 'No control plans set up yet — ask an admin.'}
          </Text>
        ) : (
          <GroupedCard>
            {plans.map((p, i) => (
              <View key={p.id} style={{ borderBottomWidth: i === plans.length - 1 && dupId !== p.id ? 0 : 1, borderColor: t.color.border }}>
                {/* Split nav + admin actions into siblings — no nested pressables */}
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56 }}>
                  {isAdmin ? (
                    <Pressable onPress={() => void pickImage(p.id)} accessibilityLabel="Change plan image"
                      style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                        {p.asset_image_url ?? p.image_url
                          ? <Image source={{ uri: (p.asset_image_url ?? p.image_url)! }} style={{ width: 36, height: 36 }} contentFit="cover" />
                          : <Ionicons name={uploadingId === p.id ? 'hourglass-outline' : 'clipboard-outline'} size={18} color={t.color.textMuted} />}
                      </View>
                    </Pressable>
                  ) : (
                    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden', backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                        {p.asset_image_url ?? p.image_url
                          ? <Image source={{ uri: (p.asset_image_url ?? p.image_url)! }} style={{ width: 36, height: 36 }} contentFit="cover" />
                          : <Ionicons name="clipboard-outline" size={18} color={t.color.textMuted} />}
                      </View>
                    </View>
                  )}
                  <Pressable
                    onPress={() => router.push({ pathname: '/dashboard/compliance/[planId]', params: { planId: p.id } })}
                    accessibilityRole="button"
                    style={(state) => {
                      const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                      return { flex: 1, paddingVertical: 10, paddingRight: 8, backgroundColor: pressed || hovered ? t.color.surfaceAlt : 'transparent' };
                    }}
                  >
                    <Text variant="label">{p.name}</Text>
                    <Text variant="small" muted>Tier: {p.tier}</Text>
                  </Pressable>
                  {isAdmin && (
                    <>
                      <Pressable onPress={() => { setDupId(p.id); setDupName(`${p.name} (copy)`); }} accessibilityLabel="Duplicate plan" hitSlop={8} style={{ padding: 12 }}>
                        <Ionicons name="copy-outline" size={18} color={t.color.textMuted} />
                      </Pressable>
                      <Pressable onPress={() => deactivate(p.id)} accessibilityLabel="Deactivate plan" hitSlop={8} style={{ padding: 12 }}>
                        <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                      </Pressable>
                    </>
                  )}
                  <View style={{ paddingRight: 16 }}>
                    <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
                  </View>
                </View>
                {dupId === p.id && (
                  <View style={{ gap: t.space.sm, padding: 16, paddingTop: 0 }}>
                    <TextInput value={dupName} onChangeText={setDupName} placeholder="Name for the copy" style={s.input} placeholderTextColor={t.color.textMuted} />
                    <View style={s.rowWrap}>
                      <Button label="Duplicate" onPress={doDuplicate} loading={busy} style={s.flexGrow1} />
                      <Button label="Cancel" variant="ghost" onPress={() => { setDupId(null); setDupName(''); }} style={s.flexGrow1} />
                    </View>
                  </View>
                )}
              </View>
            ))}
          </GroupedCard>
        )}
      </View>

      {isAdmin && (creating ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>New control plan</SectionLabel>
          <Card>
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Name *</Text>
            <TextInput value={newName} onChangeText={setNewName} placeholder="Plan name" style={s.input} placeholderTextColor={t.color.textMuted} />
          </View>
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Tier</Text>
            <View style={s.rowWrap}>
              {TIERS.map((tier) => (
                <Pill key={tier} label={tier} active={newTier === tier} onPress={() => setNewTier(tier)} />
              ))}
            </View>
          </View>
          <View style={s.rowWrap}>
            <Button label="Create plan" onPress={create} loading={busy} style={s.flexGrow1} />
            <Button label="Cancel" variant="ghost" onPress={() => { setCreating(false); setNewName(''); }} style={s.flexGrow1} />
          </View>
          </Card>
        </View>
      ) : (
        <Button label="+ New control plan" onPress={() => setCreating(true)} />
      ))}
    </Screen>
  );
}
