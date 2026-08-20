import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateOrg } from '@/lib/api';
import { Screen, Text, Card, Button, TextField, ColorPicker } from '@/ui/components';

const s = { colorRow: { gap: 4 } };

// Org + brand settings. Admin-only; brand colours apply to everyone.
export default function Settings() {
  const { data, refresh } = useProfile();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';

  const [orgName, setOrgName] = useState(data?.org?.org_name ?? '');
  const [supportEmail, setSupportEmail] = useState(data?.org?.support_email ?? '');
  const [brand, setBrand] = useState<string | null>(data?.org?.brand_color ?? null);
  const [accent, setAccent] = useState<string | null>(data?.org?.accent_color ?? null);
  const [bgColor, setBgColor] = useState<string | null>(data?.org?.custom_colors?.bg ?? null);
  const [surfaceColor, setSurfaceColor] = useState<string | null>(data?.org?.custom_colors?.surface ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const save = async () => {
    if (!orgName.trim()) { setMsg({ text: 'Organisation name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const custom_colors: Record<string, string> = {};
      if (bgColor) custom_colors.bg = bgColor;
      if (surfaceColor) custom_colors.surface = surfaceColor;
      await updateOrg(getAccessToken()!, {
        org_name: orgName.trim(),
        support_email: supportEmail || undefined,
        brand_color: brand ?? undefined,
        accent_color: accent ?? undefined,
        custom_colors,
      });
      await refresh();
      setMsg({ text: 'Saved — colours apply to all users.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Text variant="title">Settings</Text>

      <Card>
        <Text variant="heading">Organisation</Text>
        <TextField label="Organisation name" value={orgName} onChangeText={setOrgName} placeholder="Organisation name" autoCapitalize="sentences" />
        <TextField label="Support email" value={supportEmail} onChangeText={setSupportEmail} placeholder="support@example.com" keyboardType="email-address" autoCapitalize="none" />
      </Card>

      <Card>
        <Text variant="heading">Brand colours</Text>
        <Text variant="small" muted>Colour changes apply to everyone. Pick a swatch or enter a hex code.</Text>

        <View style={s.colorRow}>
          <Text variant="label" muted>Brand (primary)</Text>
          <ColorPicker value={brand} onChange={setBrand} nullable />
        </View>

        <View style={s.colorRow}>
          <Text variant="label" muted>Accent</Text>
          <ColorPicker value={accent} onChange={setAccent} nullable />
        </View>

        <View style={s.colorRow}>
          <Text variant="label" muted>Background</Text>
          <ColorPicker value={bgColor} onChange={setBgColor} nullable />
        </View>

        <View style={s.colorRow}>
          <Text variant="label" muted>Surface (cards)</Text>
          <ColorPicker value={surfaceColor} onChange={setSurfaceColor} nullable />
        </View>

        <Button
          label="Reset to defaults"
          variant="ghost"
          onPress={() => { setBrand(null); setAccent(null); setBgColor(null); setSurfaceColor(null); }}
        />
      </Card>

      <Button label="Save changes" onPress={save} loading={busy} />
    </Screen>
  );
}
