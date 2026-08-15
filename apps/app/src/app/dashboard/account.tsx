import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PreferredContact } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { visibleNav } from '@/lib/nav';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Row, Button, TextField, Notice } from '@/ui/components';
import { passkeyRegisterBegin, passkeyRegisterComplete, updateMyProfile } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { doRegister, passkeySupported } from '@/lib/passkey';

type Msg = { text: string; tone: 'success' | 'error' };
type ThemeT = ReturnType<typeof useTheme>;
const CONTACT_OPTS: { key: PreferredContact; label: string }[] = [
  { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'sms', label: 'SMS' }, { key: 'in_app', label: 'In-app' },
];

const makeStyles = (t: ThemeT) => ({
  contactGroup: { gap: 6 },
  contactRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  contactBtn: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  manageLabel: { flex: 1 },
});

export default function Account() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { signOut, features, user } = useAuth();
  const { data, refresh } = useProfile();
  const me = data?.me;

  // Billing + admin screens live under Account on mobile (they're off the bar).
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const manageLinks = visibleNav(isAdmin, features)
    .filter((i) => i.href !== '/dashboard/account' && (i.group === 'account' || i.group === 'admin'));

  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(me?.profile?.phone ?? '');
  const [contactEmail, setContactEmail] = useState(me?.profile?.contact_email ?? me?.email ?? '');
  const [preferred, setPreferred] = useState<string | null>(me?.profile?.preferred_contact ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const saveProfile = async () => {
    if (!name.trim()) { setMsg({ text: 'Name is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await updateMyProfile(getAccessToken()!, {
        name: name.trim(), phone: phone || undefined,
        contact_email: contactEmail || undefined, preferred_contact: preferred ?? undefined,
      });
      await refresh();
      setMsg({ text: 'Profile saved.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

  const enrolPasskey = async () => {
    setBusy(true); setMsg(null);
    try {
      const options = await passkeyRegisterBegin(getAccessToken()!);
      const attestation = await doRegister(options);
      await passkeyRegisterComplete(getAccessToken()!, attestation);
      setMsg({ text: 'Passkey enrolled on this device.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Text variant="title">Account</Text>

      <Card>
        <Text variant="heading">Your details</Text>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="sentences" />
        <TextField label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
        <View style={s.contactGroup}>
          <Text variant="label" muted>Best way to reach you</Text>
          <View style={s.contactRow}>
            {CONTACT_OPTS.map((o) => {
              const sel = preferred === o.key;
              return (
                <Pressable key={o.key} onPress={() => setPreferred(o.key)} accessibilityRole="button"
                  style={s.contactBtn(sel)}>
                  <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Button label="Save profile" onPress={saveProfile} loading={busy} />
      </Card>

      <Card>
        <Text variant="heading">Security</Text>
        <Text muted>
          {passkeySupported
            ? 'Add a passkey for faster, phishing-resistant sign-in on this device.'
            : 'Passkeys are available on the web app today; native support is coming.'}
        </Text>
        {passkeySupported && <Button label="Enrol a passkey" variant="secondary" onPress={enrolPasskey} loading={busy} />}
      </Card>

      {manageLinks.length > 0 && (
        <Card>
          <Text variant="heading">Manage</Text>
          {manageLinks.map((l) => (
            <Row key={l.href} onPress={() => router.push(l.href)}>
              <Ionicons name={l.icon} size={20} color={t.color.text} />
              <Text variant="label" style={s.manageLabel}>{l.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
            </Row>
          ))}
        </Card>
      )}

      <Button label="Log out" variant="ghost" onPress={signOut} />
      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
