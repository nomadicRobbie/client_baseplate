import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateOrg } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
const SWATCHES = ['#2a7f62', '#e8613a', '#1d4ed8', '#7c3aed', '#db2777', '#0e0e0e'];

const makeStyles = (t: ThemeT) => ({
  swatchRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.md, marginTop: t.space.xs },
  swatch: (selected: boolean) => ({ width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: 'transparent', borderWidth: 3, borderColor: selected ? t.color.ink : 'transparent' }),
});

// Org + brand settings. Admin-only; brand colour applies to everyone.
export default function Settings() {
  const t = useTheme();
  const s = makeStyles(t);
  const { data, refresh } = useProfile();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';

  const [orgName, setOrgName] = useState(data?.org?.org_name ?? '');
  const [supportEmail, setSupportEmail] = useState(data?.org?.support_email ?? '');
  const [brand, setBrand] = useState<string | null>(data?.org?.brand_color ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const save = async () => {
    if (!orgName.trim()) { setMsg({ text: 'Organisation name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await updateOrg(getAccessToken()!, {
        org_name: orgName.trim(),
        support_email: supportEmail || undefined,
        brand_color: brand ?? undefined,
      });
      await refresh();
      setMsg({ text: 'Saved — brand applies to everyone.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Text variant="title">Settings</Text>

      <Card>
        <Text variant="heading">Organisation</Text>
        <TextField label="Organisation name" value={orgName} onChangeText={setOrgName} placeholder="Organisation name" autoCapitalize="sentences" />
        <TextField label="Support email" value={supportEmail} onChangeText={setSupportEmail} placeholder="support@example.com" keyboardType="email-address" autoCapitalize="none" />
      </Card>

      <Card>
        <Text variant="heading">Brand</Text>
        <Text variant="small" muted>Sets the app's accent colour for all users.</Text>
        <View style={s.swatchRow}>
          {SWATCHES.map((c) => (
            <Pressable key={c} onPress={() => setBrand(c)} accessibilityRole="button" accessibilityLabel={`Brand colour ${c}`}
              style={[s.swatch(brand === c), { backgroundColor: c }]} />
          ))}
        </View>
        {!!brand && <Button label="Clear brand colour" variant="ghost" onPress={() => setBrand(null)} />}
      </Card>

      <Button label="Save changes" onPress={save} loading={busy} />
      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
