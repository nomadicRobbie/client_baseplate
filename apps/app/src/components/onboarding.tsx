import { useState } from 'react';
import { View, Pressable } from 'react-native';
import type { PreferredContact } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateMyProfile, updateOrg } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice, ColorPicker } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
const CONTACT_OPTS: { key: PreferredContact; label: string }[] = [
  { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'sms', label: 'SMS' }, { key: 'in_app', label: 'In-app' },
];

const s = { headerGroup: { gap: 4 }, fieldGroup: { gap: 6 } };

const makeChipsStyles = (t: ThemeT) => ({
  container: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  chip: (sel: boolean) => ({ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
});

// Chip selector
function Chips({ options, value, onChange }: { options: { key: string; label: string }[]; value: string | null; onChange: (v: string) => void }) {
  const t = useTheme();
  const s = makeChipsStyles(t);
  return (
    <View style={s.container}>
      {options.map((o) => {
        const sel = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button"
            style={s.chip(sel)}>
            <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}


export function Onboarding({ onDone }: { onDone: () => Promise<void> | void }) {
  const { data } = useProfile();
  const steps: ('personal' | 'org' | 'email')[] = [];
  if (data?.onboarding.needs_personal) steps.push('personal');
  if (data?.onboarding.needs_org_setup) steps.push('org');
  if (data?.onboarding.needs_email_setup) steps.push('email');

  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // personal
  const [name, setName] = useState(data?.me.name ?? '');
  const [contactEmail, setContactEmail] = useState(data?.me.profile?.contact_email ?? data?.me.email ?? '');
  const [phone, setPhone] = useState(data?.me.profile?.phone ?? '');
  const [preferred, setPreferred] = useState<string | null>(data?.me.profile?.preferred_contact ?? null);
  // org
  const [orgName, setOrgName] = useState(data?.org?.org_name ?? '');
  const [brand, setBrand] = useState<string | null>(data?.org?.brand_color ?? null);
  // email recipients — default notification to support_email, overridable
  const [notifyEmail, setNotifyEmail] = useState(
    data?.email?.notification_email ?? data?.org?.support_email ?? data?.me.email ?? ''
  );
  const [backupEmail, setBackupEmail] = useState(data?.email?.backup_email ?? '');

  const step = steps[idx];
  if (!step) { void onDone(); return null; }

  const advance = async () => {
    if (idx + 1 < steps.length) setIdx(idx + 1);
    else await onDone();
  };

  const submitPersonal = async () => {
    if (!name.trim() || !preferred) { setErr('Name and a preferred contact method are required.'); return; }
    setBusy(true); setErr('');
    try {
      await updateMyProfile(getAccessToken()!, { name: name.trim(), contact_email: contactEmail || undefined, phone: phone || undefined, preferred_contact: preferred });
      await advance();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  };

  const submitOrg = async () => {
    if (!orgName.trim()) { setErr('Organisation name is required.'); return; }
    setBusy(true); setErr('');
    try {
      await updateOrg(getAccessToken()!, { org_name: orgName.trim(), brand_color: brand ?? undefined });
      await advance();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  };

  const submitEmail = async () => {
    const notify = notifyEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notify)) { setErr('A valid notification email is required.'); return; }
    const backup = backupEmail.trim();
    if (backup && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(backup)) { setErr('The backup email is not valid.'); return; }
    setBusy(true); setErr('');
    try {
      await updateOrg(getAccessToken()!, { notification_email: notify, backup_email: backup || null });
      await advance();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  };

  const stepNo = idx + 1;
  const total = steps.length;

  return (
    <Screen>
      <View style={s.headerGroup}>
        <Text variant="small" muted>Step {stepNo} of {total}</Text>
        <Text variant="title">{step === 'personal' ? 'Welcome — tell us about you' : step === 'org' ? 'Set up your organisation' : 'Where should replies go?'}</Text>
      </View>

      {step === 'personal' ? (
        <Card>
          <TextField label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="sentences" />
          <TextField label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Best way to reach you</Text>
            <Chips options={CONTACT_OPTS} value={preferred} onChange={setPreferred} />
          </View>
          <Button label={total > 1 ? 'Continue' : 'Finish'} onPress={submitPersonal} loading={busy} />
        </Card>
      ) : step === 'org' ? (
        <Card>
          <TextField label="Organisation name" value={orgName} onChangeText={setOrgName} placeholder="Organisation name" autoCapitalize="sentences" />
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Brand colour (optional)</Text>
            <Text variant="small" muted>Sets the app's accent for everyone. You can change or set this later in Settings.</Text>
            <ColorPicker value={brand} onChange={(v) => setBrand(v)} nullable />
          </View>
          <Button label={idx + 1 < total ? 'Continue' : 'Finish'} onPress={submitOrg} loading={busy} />
          {!!brand && <Button label="Skip colour for now" variant="ghost" onPress={() => setBrand(null)} />}
        </Card>
      ) : (
        <Card>
          <Text variant="small" muted>When a customer replies to an email from your organisation, we forward it to this inbox. You can change it later in Settings.</Text>
          <TextField label="Notification email" value={notifyEmail} onChangeText={setNotifyEmail} placeholder="you@yourorg.com" keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Backup email (optional)" value={backupEmail} onChangeText={setBackupEmail} placeholder="Used if the primary bounces" keyboardType="email-address" autoCapitalize="none" />
          <Button label="Finish" onPress={submitEmail} loading={busy} />
        </Card>
      )}

      {!!err && <Notice message={err} tone="error" />}
    </Screen>
  );
}
