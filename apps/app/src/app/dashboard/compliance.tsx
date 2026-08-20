import { useEffect, useState } from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FoodControlPlan } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listPlans, createPlan, updatePlan, duplicatePlan } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Row, Notice, Badge } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' | 'info' } | null;
const TIERS = ['FCP', 'NP1', 'NP2', 'NP3'] as const;

const makeStyles = (t: ThemeT) => StyleSheet.create({
  rowWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  input:      { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, minHeight: 44, fontSize: t.size.md, color: t.color.text },
  fieldGroup: { gap: t.space.xs },
  flexGrow1:  { flexGrow: 1 },
  pill:       { paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderRadius: t.radius.md, borderWidth: 1, minHeight: 40, justifyContent: 'center' as const },
  planInfo:   { flex: 1 },
  actions:    { flexDirection: 'row', gap: t.space.sm, alignItems: 'center' },
});

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={[s.pill, { borderColor: active ? t.color.primary : t.color.border, backgroundColor: active ? t.color.primary : t.color.surface }]}>
      <Text variant="small" color={active ? t.color.primaryText : t.color.text}>{label}</Text>
    </Pressable>
  );
}

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
      <Text variant="title">Food Compliance</Text>
      <Text muted>Select a control plan to begin recording checks.</Text>

      {loading ? (
        <Card><Text muted>Loading…</Text></Card>
      ) : plans.length === 0 ? (
        <Card>
          <Text muted>
            {isAdmin ? 'No control plans yet. Create one below.' : 'No control plans set up yet — ask an admin.'}
          </Text>
        </Card>
      ) : (
        <Card>
          {plans.map((p) => (
            <View key={p.id}>
              <Row onPress={() => router.push({ pathname: '/dashboard/compliance/[planId]', params: { planId: p.id } })}>
                <Ionicons name="clipboard-outline" size={22} color={t.color.text} />
                <View style={s.planInfo}>
                  <Text>{p.name}</Text>
                  <Text variant="small" muted>Tier: {p.tier}</Text>
                </View>
                {isAdmin && (
                  <View style={s.actions}>
                    <Pressable onPress={() => { setDupId(p.id); setDupName(`${p.name} (copy)`); }} accessibilityLabel="Duplicate plan" hitSlop={8}>
                      <Ionicons name="copy-outline" size={18} color={t.color.textMuted} />
                    </Pressable>
                    <Pressable onPress={() => deactivate(p.id)} accessibilityLabel="Deactivate plan" hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                    </Pressable>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </Row>

              {/* Inline duplicate form — only shown for this card */}
              {dupId === p.id && (
                <View style={{ gap: t.space.sm, paddingTop: t.space.sm }}>
                  <TextInput value={dupName} onChangeText={setDupName} placeholder="Name for the copy" style={s.input} placeholderTextColor={t.color.textMuted} />
                  <View style={s.rowWrap}>
                    <Button label="Duplicate" onPress={doDuplicate} loading={busy} style={s.flexGrow1} />
                    <Button label="Cancel" variant="ghost" onPress={() => { setDupId(null); setDupName(''); }} style={s.flexGrow1} />
                  </View>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {isAdmin && (creating ? (
        <Card>
          <Text variant="heading">New control plan</Text>
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Name *</Text>
            <TextInput value={newName} onChangeText={setNewName} placeholder="e.g. Main kitchen FCP" style={s.input} placeholderTextColor={t.color.textMuted} />
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
      ) : (
        <Button label="+ New control plan" onPress={() => setCreating(true)} />
      ))}
    </Screen>
  );
}
