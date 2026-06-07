import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { Screen, Text, Card, Button, Row, Badge, Notice } from '@/ui/components';
import { passkeyRegisterBegin, passkeyRegisterComplete } from '@/lib/api';
import { getAccessToken } from '@/lib/session';
import { doRegister, passkeySupported } from '@/lib/passkey';

type Msg = { text: string; tone: 'success' | 'error' };

export default function Account() {
  const { user, signOut } = useAuth();
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);

  const enrolPasskey = async () => {
    const token = getAccessToken();
    if (!token) return;
    setBusy(true); setMsg(null);
    try {
      const options = await passkeyRegisterBegin(token);
      const attestation = await doRegister(options);
      await passkeyRegisterComplete(token, attestation);
      setMsg({ text: 'Passkey enrolled on this device', tone: 'success' });
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text variant="title">Account</Text>

      <Card>
        <Text variant="heading">Profile</Text>
        <Row><Text muted>Role</Text><View style={{ flex: 1 }} /><Badge label={user?.role ?? '—'} /></Row>
        <Row><Text muted>Type</Text><View style={{ flex: 1 }} /><Text>{user?.type}</Text></Row>
        <Row><Text muted>User ID</Text><View style={{ flex: 1 }} /><Text variant="mono">{user?.userId.slice(0, 8)}…</Text></Row>
      </Card>

      <Card>
        <Text variant="heading">Security</Text>
        <Text muted>
          {passkeySupported
            ? 'Add a passkey for faster, phishing-resistant sign-in on this device.'
            : 'Passkeys are available on the web app today; native support is coming.'}
        </Text>
        {passkeySupported && (
          <Button label="Enrol a passkey" onPress={enrolPasskey} loading={busy} />
        )}
        {msg && <Notice message={msg.text} tone={msg.tone} />}
      </Card>

      <Button label="Log out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
