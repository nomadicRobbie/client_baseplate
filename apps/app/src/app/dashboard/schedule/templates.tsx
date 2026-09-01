import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ServiceTemplate } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listServiceTemplates, generateServiceInstances } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Badge } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { localDate } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  templateRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: t.space.sm },
  templateBody: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, alignItems: 'center' as const },
  genRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'flex-end' as const },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
});

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'fri', 'Sat'];

const today = localDate;
function inDays(n: number): string { return localDate(new Date(Date.now() + n * 86_400_000)); }

export default function TemplatesScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const router = useRouter();
  const t = useTheme();
  const s = makeStyles(t);

  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [genFrom, setGenFrom] = useState<Record<string, string>>({});
  const [genTo, setGenTo] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listServiceTemplates(getAccessToken()!);
      setTemplates(r.templates);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!isAdmin) return <Redirect href="/dashboard/schedule" />;

  const generate = async (templateId: string) => {
    const from = genFrom[templateId] ?? today();
    const to = genTo[templateId] ?? inDays(14);
    setGenerating(templateId);
    try {
      const r = await generateServiceInstances(getAccessToken()!, templateId, from, to);
      setMsg({ text: `Generated ${r.created} service${r.created !== 1 ? 's' : ''} (${r.skipped} skipped)`, tone: 'success' });
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setGenerating(null);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Schedule</Text>
      </Pressable>

      <View style={s.header}>
        <Text variant="title">Templates</Text>
        <Button label="New template" onPress={() => router.push('/dashboard/schedule/templates/new')} />
      </View>

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : templates.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="copy-outline" size={32} color={t.color.textMuted} />
          <Text muted>No templates yet.</Text>
        </View>
      ) : (
        templates.map(tmpl => {
          const rec = tmpl.recurrence as { days?: number[]; time?: string } | null;
          const dayLabel = rec?.days?.map(d => DAY_LABELS[d]).join(', ') ?? '';
          return (
            <Card key={tmpl.id}>
              <View style={s.templateRow}>
                <Ionicons name="copy-outline" size={18} color={t.color.textMuted} style={{ marginTop: 2 }} />
                <View style={s.templateBody}>
                  <Text variant="label">{tmpl.name}</Text>
                  <Text variant="body" muted>
                    {tmpl.duration_minutes}min · {tmpl.timezone}
                    {rec ? ` · ${dayLabel} ${rec.time}` : ''}
                  </Text>
                  <View style={s.meta}>
                    <Badge label={tmpl.active ? 'Active' : 'Inactive'} tone={tmpl.active ? 'success' : 'neutral'} />
                    {tmpl.location_label ? <Badge label={tmpl.location_label} tone="neutral" /> : null}
                  </View>

                  {/* Generate controls — only for templates with recurrence */}
                  {rec && (
                    <View style={[s.genRow, { marginTop: t.space.sm }]}>
                      <View style={{ flex: 1 }}>
                        <DateField
                          label="From"
                          value={genFrom[tmpl.id] ?? (rec as { startDate?: string }).startDate ?? today()}
                          onChange={v => setGenFrom(prev => ({ ...prev, [tmpl.id]: v }))}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <DateField
                          label="To"
                          value={genTo[tmpl.id] ?? (rec as { endDate?: string | null }).endDate ?? inDays(14)}
                          onChange={v => setGenTo(prev => ({ ...prev, [tmpl.id]: v }))}
                        />
                      </View>
                      <Button
                        label="Generate"
                        onPress={() => generate(tmpl.id)}
                        loading={generating === tmpl.id}
                        disabled={!!generating && generating !== tmpl.id}
                      />
                    </View>
                  )}
                </View>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
