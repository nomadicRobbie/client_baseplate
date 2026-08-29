import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import type { ServiceManifest, Person, Asset } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { getServiceManifest, addServiceAssignment, removeServiceAssignment, listPeople, listAssets } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };
type SubjectTab = 'crew' | 'assets';

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  seg: { flexDirection: 'row' as const, backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.pill, padding: 4 },
  segBtn: { flex: 1, minHeight: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.pill },
  segBtnOn: { backgroundColor: t.color.primary },
  search: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: t.space.sm },
  rowLeft: { flex: 1, gap: 2 },
});

export default function AssignScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [tab, setTab] = useState<SubjectTab>('crew');
  const [manifest, setManifest] = useState<ServiceManifest | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const tok = getAccessToken()!;
      const [mf, pp, aa] = await Promise.all([
        getServiceManifest(tok, serviceId),
        listPeople(tok, { active: true }),
        listAssets(tok),
      ]);
      setManifest(mf.manifest);
      setPeople(pp.people);
      setAssets(aa.assets);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => { void load(); }, [load]);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const assignedPersonIds = new Set(manifest?.crew.map(c => c.person_id) ?? []);
  const assignedAssetIds = new Set(manifest?.assets.map(a => a.asset_id) ?? []);

  const filteredPeople = people.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );
  const filteredAssets = assets.filter(a =>
    a.name.toLowerCase().includes(query.toLowerCase())
  );

  const assign = async (subjectType: 'person' | 'asset', subjectId: string) => {
    setBusy(subjectId);
    try {
      const tok = getAccessToken()!;
      await addServiceAssignment(tok, serviceId!, { subject_type: subjectType, subject_id: subjectId });
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const unassign = async (assignmentId: string) => {
    setBusy(assignmentId);
    try {
      const tok = getAccessToken()!;
      await removeServiceAssignment(tok, serviceId!, assignmentId);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Service</Text>
      </Pressable>

      <Text variant="title">Assign crew & assets</Text>

      <View style={s.seg}>
        {(['crew', 'assets'] as SubjectTab[]).map(tb => (
          <Pressable key={tb} onPress={() => { setTab(tb); setQuery(''); }} style={[s.segBtn, tab === tb && s.segBtnOn]} accessibilityRole="button">
            <Text variant="small" color={tab === tb ? t.color.bg : t.color.text}>
              {tb === 'crew' ? 'Crew' : 'Assets'}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={tab === 'crew' ? 'Search crew…' : 'Search assets…'}
        placeholderTextColor={t.color.textMuted}
        style={s.search}
      />

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : tab === 'crew' ? (
        filteredPeople.map(p => {
          const assigned = assignedPersonIds.has(p.id);
          const assignmentId = manifest?.crew.find(c => c.person_id === p.id)?.assignment_id;
          return (
            <Card key={p.id}>
              <View style={s.row}>
                <View style={s.rowLeft}>
                  <Text variant="label">{p.name}</Text>
                  {p.email && <Text variant="small" muted>{p.email}</Text>}
                </View>
                {assigned ? (
                  <Button
                    label="Remove"
                    onPress={() => unassign(assignmentId!)}
                    loading={busy === assignmentId}
                  />
                ) : (
                  <Button
                    label="Assign"
                    onPress={() => assign('person', p.id)}
                    loading={busy === p.id}
                  />
                )}
              </View>
            </Card>
          );
        })
      ) : (
        filteredAssets.map(a => {
          const assigned = assignedAssetIds.has(a.id);
          const assignmentId = manifest?.assets.find(x => x.asset_id === a.id)?.assignment_id;
          return (
            <Card key={a.id}>
              <View style={s.row}>
                <View style={s.rowLeft}>
                  <Text variant="label">{a.name}</Text>
                  {a.status && <Text variant="small" muted>{a.status}</Text>}
                </View>
                {assigned ? (
                  <Button
                    label="Remove"
                    onPress={() => unassign(assignmentId!)}
                    loading={busy === assignmentId}
                  />
                ) : (
                  <Button
                    label="Assign"
                    onPress={() => assign('asset', a.id)}
                    loading={busy === a.id}
                  />
                )}
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
