import { useState, useRef } from 'react';
import {
  View, Pressable, Image, useWindowDimensions, Platform,
  TextInput, Animated, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { PreferredContact } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { visibleNav } from '@/lib/nav';
import { useTheme, useColorSchemePref, type SchemePref } from '@/theme';
import { Screen, Text } from '@/ui/components';
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
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

// Tap to expand in-place — label shrinks to caption, value becomes input, chevron rotates.
function ExpandableRow({ label, value, onChange, onSave, placeholder, last }: {
  label: string; value: string; onChange: (v: string) => void;
  onSave: () => void; placeholder?: string; last?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const anim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  const animate = (to: number, cb?: () => void) =>
    Animated.timing(anim, { toValue: to, duration: to ? 300 : 240, easing: EASE, useNativeDriver: false }).start(cb);

  const toggle = () => {
    const next = !openRef.current;
    openRef.current = next;
    setOpen(next);
    animate(next ? 1 : 0, next ? () => inputRef.current?.focus() : undefined);
  };

  const save = () => {
    openRef.current = false;
    setOpen(false);
    animate(0);
    onSave();
  };

  const h = anim.interpolate({ inputRange: [0, 1], outputRange: [56, 112] });
  const labelTop = anim.interpolate({ inputRange: [0, 1], outputRange: [19, 12] });
  const labelSize = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 12] });
  const dispOp = anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 0, 0] });
  const editOp = anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] });
  const chevRot = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <Animated.View style={{
      height: h, overflow: 'hidden', position: 'relative',
      borderBottomWidth: last ? 0 : 1, borderColor: t.color.border,
    }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      <Animated.Text style={{ position: 'absolute', left: 16, top: labelTop, fontSize: labelSize, fontWeight: '600', color: open ? t.color.textMuted : t.color.text }}>
        {label}
      </Animated.Text>

      <Animated.Text numberOfLines={1} style={{ position: 'absolute', right: 42, top: 19, maxWidth: 200, fontSize: 15, opacity: dispOp, color: value ? t.color.textMuted : t.color.primary }}>
        {value || 'Add'}
      </Animated.Text>

      <Animated.View style={{ position: 'absolute', right: 14, top: 19, transform: [{ rotate: chevRot }] }}>
        <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
      </Animated.View>

      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={{ position: 'absolute', left: 16, right: 56, bottom: 14, opacity: editOp }}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={t.color.textMuted}
          style={{ fontSize: 17, color: t.color.text, borderBottomWidth: 1, borderBottomColor: t.color.primary, paddingBottom: 4 }}
          editable={open}
          returnKeyType="done"
          onSubmitEditing={save}
        />
      </Animated.View>

      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={{ position: 'absolute', right: 14, bottom: 14, opacity: editOp }}>
        <Pressable onPress={save} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save">
          <Ionicons name="checkmark" size={22} color={t.color.textMuted} />
        </Pressable>
      </Animated.View>
    </Animated.View>
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

  const canEnrolPasskey = Platform.OS === 'web' && passkeySupported && typeof window !== 'undefined' && window.location.hostname !== 'localhost';
  const passkeyStatus = Platform.OS !== 'web'
    ? 'Coming to the mobile app soon'
    : typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? 'Off in local development'
      : passkeySupported ? 'Tap to add a passkey for this device' : 'Not supported on this browser';

  const groupedCard = {
    backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: 16, overflow: 'hidden' as const,
  };
  const sectionLabelStyle = {
    fontSize: 12, fontWeight: '600' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const,
    fontFamily: t.font.mono, color: t.color.textMuted, paddingLeft: 4,
  };

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
        <Pressable onPress={pickAvatar} accessibilityRole="button" disabled={busy}
          style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface, opacity: busy ? 0.5 : 1 }}>
          <Text variant="label">{avatarUri ? 'Change photo' : 'Add a photo'}</Text>
        </Pressable>
      </View>

      {/* ── About you ────────────────────────────────── */}
      <View style={{ gap: 8 }}>
        <Text style={sectionLabelStyle}>About you</Text>
        <View style={groupedCard}>
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
                    style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                    <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      {/* ── Organisation (admin only) ─────────────────── */}
      {isAdmin && (
        <View style={{ gap: 8 }}>
          <Text style={sectionLabelStyle}>{data?.org?.org_name || 'Organisation'}</Text>
          <View style={groupedCard}>
            <ExpandableRow label="Organisation name" value={orgName} onChange={setOrgName} onSave={saveOrg} placeholder="Organisation name" />
            <ExpandableRow label="Support email" value={supportEmail} onChange={setSupportEmail} onSave={saveOrg} placeholder="support@example.com" last={manageLinks.length === 0} />
            {manageLinks.map((l, i) => (
              <Pressable key={l.href} onPress={() => router.push(l.href)} accessibilityRole="button"
                style={(state) => {
                  const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                  return {
                    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
                    paddingVertical: 12, paddingHorizontal: 14, minHeight: 56,
                    borderTopWidth: 1, borderColor: t.color.border,
                    backgroundColor: pressed || hovered ? t.color.surfaceAlt : 'transparent',
                  };
                }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={l.icon} size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={{ flex: 1 }}>{l.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── This device ──────────────────────────────── */}
      <View style={{ gap: 8 }}>
        <Text style={sectionLabelStyle}>This device</Text>
        <View style={groupedCard}>
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
        </View>
      </View>

      {/* ── Log out ──────────────────────────────────── */}
      <Pressable onPress={signOut} accessibilityRole="button"
        style={(state) => {
          const { pressed } = state as { pressed: boolean };
          return { minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: t.color.border, borderRadius: 10, paddingVertical: 12, opacity: pressed ? 0.7 : 1 };
        }}>
        <Text variant="label" color={t.color.danger}>Log out</Text>
      </Pressable>

    </Screen>
  );
}
