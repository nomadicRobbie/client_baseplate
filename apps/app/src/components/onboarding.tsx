import { useState } from 'react';
import { View, Pressable } from 'react-native';
import type { PreferredContact } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateMyProfile, updateOrg } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice } from '@/ui/components';

const CONTACT_OPTS: { key: PreferredContact; label: string }[] = [
  { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'sms', label: 'SMS' }, { key: 'in_app', label: 'In-app' },
];

const SWATCHES = ['#2a7f62', '#e8613a', '#1d4ed8', '#7c3aed', '#db2777', '#0e0e0e'];

// Chip selector
function Chips({ options, value, onChange }: { options: { key: string; label: string }[]; value: string | null; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
      {options.map((o) => {
        const sel = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button"
            style={{ paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
            <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Swatches({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md }}>
      {SWATCHES.map((c) => (
        <Pressable key={c} onPress={() => onChange(c)} accessibilityRole="button" accessibilityLabel={`Brand colour ${c}`}
          style={{ width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: c, borderWidth: 3, borderColor: value === c ? t.color.ink : 'transparent' }} />
      ))}
    </View>
  );
}

export function Onboarding({ onDone }: { onDone: () => Promise<void> | void }) {
  const { data } = useProfile();
  const steps: ('personal' | 'org')[] = [];
  if (data?.onboarding.needs_personal) steps.push('personal');
  if (data?.onboarding.needs_org_setup) steps.push('org');

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

  const stepNo = idx + 1;
  const total = steps.length;

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="small" muted>Step {stepNo} of {total}</Text>
        <Text variant="title">{step === 'personal' ? 'Welcome — tell us about you' : 'Set up your organisation'}</Text>
      </View>

      {step === 'personal' ? (
        <Card>
          <TextField label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="sentences" />
          <TextField label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />
          <View style={{ gap: 6 }}>
            <Text variant="label" muted>Best way to reach you</Text>
            <Chips options={CONTACT_OPTS} value={preferred} onChange={setPreferred} />
          </View>
          <Button label={total > 1 ? 'Continue' : 'Finish'} onPress={submitPersonal} loading={busy} />
        </Card>
      ) : (
        <Card>
          <TextField label="Organisation name" value={orgName} onChangeText={setOrgName} placeholder="e.g. ting test studios" autoCapitalize="sentences" />
          <View style={{ gap: 6 }}>
            <Text variant="label" muted>Brand colour (optional)</Text>
            <Text variant="small" muted>Sets the app's accent for everyone. You can change or set this later in Settings.</Text>
            <Swatches value={brand} onChange={setBrand} />
          </View>
          <Button label="Finish" onPress={submitOrg} loading={busy} />
          {!!brand && <Button label="Skip colour for now" variant="ghost" onPress={() => setBrand(null)} />}
        </Card>
      )}

      {!!err && <Notice message={err} tone="error" />}
    </Screen>
  );
}
