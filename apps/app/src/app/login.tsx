import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { otpSend, otpVerify, passkeyLoginBegin, passkeyLoginComplete, TENANT } from '@/lib/api';
import { setTokens } from '@/lib/session';
import { doAuthenticate, passkeySupported } from '@/lib/passkey';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Notice } from '@/ui/components';

type Msg = { text: string; tone: 'info' | 'success' | 'error' };

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); } finally { setBusy(false); }
  };

  const sendCode = () => run(async () => {
    await otpSend(email);
    setSent(true);
    setMsg({ text: 'Code sent — check the blnk_auth dev log', tone: 'success' });
  });

  const verify = () => run(async () => {
    const tokens = await otpVerify(email, code);
    setTokens(tokens.access_token, tokens.refresh_token);
    router.replace('/dashboard');
  });

  const loginPasskey = () => run(async () => {
    const options = await passkeyLoginBegin(email);
    const assertion = await doAuthenticate(options);
    const tokens = await passkeyLoginComplete(email, assertion);
    setTokens(tokens.access_token, tokens.refresh_token);
    router.replace('/dashboard');
  });

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: t.space.xl }}>
        <View style={{ width: '100%', maxWidth: 380, gap: t.space.lg }}>
          <View style={{ gap: t.space.xs }}>
            <Text variant="title">blnk</Text>
            <Text muted>sign in · {TENANT}</Text>
          </View>

          <Card>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {!sent ? (
              <Button label="Send code" onPress={sendCode} loading={busy} />
            ) : (
              <>
                <TextField label="Verification code" value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" />
                <Button label="Verify & sign in" onPress={verify} loading={busy} />
                <Button label="Use a different email" variant="ghost" onPress={() => { setSent(false); setCode(''); setMsg(null); }} />
              </>
            )}
          </Card>

          {passkeySupported && (
            <Button label="Sign in with passkey" variant="secondary" onPress={loginPasskey} loading={busy} />
          )}

          {msg && <Notice message={msg.text} tone={msg.tone} />}
        </View>
      </View>
    </Screen>
  );
}
