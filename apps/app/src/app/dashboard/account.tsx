import { useState, useRef } from 'react';
import {
  View, Pressable, Image, useWindowDimensions, Platform,
  TextInput, LayoutAnimation, UIManager,
} from 'react-native';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { PreferredContact } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { visibleNav } from '@/lib/nav';
import { useTheme, useColorSchemePref, type SchemePref } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel } from '@/ui/components';
import { passkeyRegisterBegin, passkeyRegisterComplete, updateMyProfile, uploadUserAvatar, updateOrg } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { doRegister, passkeySupported } from '@/lib/passkey';

type Msg = { text: string; tone: 'success' | 'error' };


const CONTACT_OPTS: { key: PreferredContact; label: string }[] = [
  { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'sms', label: 'SMS' }, { key: 'in_app', label: 'In-app' },
];
const SCHEME_OPTS: { key: SchemePref; label: string }[] = [
  { key: 'light', label: 'Light' }, { key: 'os', label: 'System' }, { key: 'dark', label: 'Dark' },
];
// Tap to expand — LayoutAnimation drives the height natively, no JS-on-scroll-frame loop.
function ExpandableRow({ label, value, onChange, onSave, placeholder, last }: {
  label: string; value: string; onChange: (v: string) => void;
  onSave: () => void; placeholder?: string; last?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !open;
    setOpen(next);
    if (next) setTimeout(() => inputRef.current?.focus(), 320);
  };

  const save = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(false);
    onSave();
  };

  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderColor: t.color.border }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.sm }}>
        <Text variant="label" style={{ flex: 1 }}>{label}</Text>
        <Text variant="body" muted numberOfLines={1} style={{ maxWidth: 200, color: value ? t.color.textMuted : t.color.primary }}>{value || 'Add'}</Text>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space.lg, paddingBottom: t.space.md, gap: t.space.sm }}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={t.color.textMuted}
            style={{ flex: 1, fontSize: t.size.md, color: t.color.text, borderBottomWidth: 1, borderBottomColor: t.color.primary, paddingBottom: t.space.xs }}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Pressable onPress={save} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save">
            <Ionicons name="checkmark" size={22} color={t.color.textMuted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function Account() {
  const t = useTheme();
  const { pref, setPref } = useColorSchemePref();
  const router = useRouter();
  const { signOut, features, user } = useAuth();
  const { data, refresh } = useProfile();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const me = data?.me;

  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const manageLinks = visibleNav(isAdmin, features)
    .filter((i) => i.href !== '/dashboard/account' && (wide ? i.group === 'admin' : i.group === 'account' || i.group === 'admin'));

  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(me?.profile?.phone ?? '');
  const [contactEmail, setContactEmail] = useState(me?.profile?.contact_email ?? me?.email ?? '');
  const [preferred, setPreferred] = useState<string | null>(me?.profile?.preferred_contact ?? null);
  const [avatarUri, setAvatarUri] = useState<string | null>(me?.profile?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [orgName, setOrgName] = useState(data?.org?.org_name ?? '');
  const [supportEmail, setSupportEmail] = useState(data?.org?.support_email ?? '');
  const [orgBusy, setOrgBusy] = useState(false);

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setMsg({ text: 'Photo library access is required.', tone: 'error' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy(true); setMsg(null);
    try {
      const url = await uploadUserAvatar(getAccessToken()!, asset.uri, { mimeType: asset.mimeType, file: asset.file, fileName: asset.fileName });
      setAvatarUri(url);
      await refresh();
      setMsg({ text: 'Avatar updated.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

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

  const saveOrg = async () => {
    if (!orgName.trim()) { setMsg({ text: 'Organisation name is required.', tone: 'error' }); return; }
    setOrgBusy(true); setMsg(null);
    try {
      await updateOrg(getAccessToken()!, { org_name: orgName.trim(), support_email: supportEmail || undefined });
      await refresh();
      setMsg({ text: 'Organisation saved.', tone: 'success' });
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setOrgBusy(false); }
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

  const webOnLocalhost = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const canEnrolPasskey = passkeySupported && !webOnLocalhost;
  const passkeyStatus = webOnLocalhost
    ? 'Off in local development'
    : passkeySupported ? 'Tap to add a passkey for this device' : 'Not supported on this device';


  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>

      {/* ── Identity header ─────────────────────────── */}
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={pickAvatar} accessibilityLabel="Change profile photo" accessibilityRole="button"
          style={{ position: 'relative', width: 96, height: 96 }}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
            : <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person" size={42} color={t.color.textMuted} />
              </View>
          }
          <View style={{ position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: t.color.primary, borderWidth: 3, borderColor: t.color.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={16} color={t.color.primaryText} />
          </View>
        </Pressable>
        <View style={{ alignItems: 'center', gap: 3 }}>
          <Text variant="heading" style={{ fontSize: 26, letterSpacing: -0.5 }}>{me?.name || 'Your name'}</Text>
          <Text muted style={{ fontSize: 14 }}>{me?.email}</Text>
        </View>
      </View>

      {/* ── About you ────────────────────────────────── */}
      <View style={{ gap: 8 }}>
        <SectionLabel>About you</SectionLabel>
        <GroupedCard>
          <ExpandableRow label="Name" value={name} onChange={setName} onSave={saveProfile} placeholder="Full name" />
          <ExpandableRow label="Email" value={contactEmail} onChange={setContactEmail} onSave={saveProfile} placeholder="you@example.com" />
          <ExpandableRow label="Phone" value={phone} onChange={setPhone} onSave={saveProfile} placeholder="+64 21 000 000" last />
          <View style={{ padding: 14, gap: 10, borderTopWidth: 1, borderColor: t.color.border }}>
            <Text variant="label">Best way to reach you</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CONTACT_OPTS.map((o) => {
                const sel = preferred === o.key;
                return (
                  <Pressable key={o.key} onPress={() => { setPreferred(o.key); saveProfile(); }} accessibilityRole="button"
                    style={{ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                    <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </GroupedCard>
      </View>

      {/* ── Organisation (admin only) ─────────────────── */}
      {isAdmin && (
        <View style={{ gap: 8 }}>
          <SectionLabel>{data?.org?.org_name || 'Organisation'}</SectionLabel>
          <GroupedCard>
            <ExpandableRow label="Organisation name" value={orgName} onChange={setOrgName} onSave={saveOrg} placeholder="Organisation name" />
            <ExpandableRow label="Support email" value={supportEmail} onChange={setSupportEmail} onSave={saveOrg} placeholder="support@example.com" last={manageLinks.length === 0} />
            {manageLinks.map((l, i) => (
              <GRow key={l.href} onPress={() => router.push(l.href)} last={i === manageLinks.length - 1}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={l.icon} size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={{ flex: 1 }}>{l.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </GRow>
            ))}
          </GroupedCard>
        </View>
      )}

      {/* ── This device ──────────────────────────────── */}
      <View style={{ gap: 8 }}>
        <SectionLabel>This device</SectionLabel>
        <GroupedCard>
          <View style={{ padding: 14, gap: 10, borderBottomWidth: 1, borderColor: t.color.border }}>
            <Text variant="label">Appearance</Text>
            <View style={{ flexDirection: 'row', backgroundColor: t.color.surfaceAlt, borderRadius: 999, padding: 4 }}>
              {SCHEME_OPTS.map((o) => {
                const sel = pref === o.key;
                return (
                  <Pressable key={o.key} onPress={() => setPref(o.key)} accessibilityRole="button"
                    style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                    <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Pressable onPress={canEnrolPasskey ? enrolPasskey : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 56, opacity: busy ? 0.6 : 1 }}>
            <Ionicons name="key-outline" size={19} color={t.color.textMuted} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">Passkey sign-in</Text>
              <Text variant="small" muted>{passkeyStatus}</Text>
            </View>
            {canEnrolPasskey && <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />}
          </Pressable>
        </GroupedCard>
      </View>

      {/* ── Log out ──────────────────────────────────── */}
      <Pressable onPress={signOut} accessibilityRole="button"
        style={(state) => {
          const { pressed } = state as { pressed: boolean };
          return { minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, paddingVertical: t.space.md, opacity: pressed ? 0.7 : 1 };
        }}>
        <Text variant="label" color={t.color.danger}>Log out</Text>
      </Pressable>

    </Screen>
  );
}
