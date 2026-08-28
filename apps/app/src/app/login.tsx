import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { otpSend, otpVerify, passkeyLoginBegin, passkeyLoginComplete, TENANT } from '@/lib/api';
import { setTokens } from '@/lib/session';
import { doAuthenticate, passkeySupported } from '@/lib/passkey';
import { useTheme } from '@/theme';
import { getItem, setItem } from '@/lib/storage';
import { Screen, Text, GroupedCard, Button, TextField } from '@/ui/components';

type Msg = { text: string; tone: 'info' | 'success' | 'error' };
type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  center: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, paddingHorizontal: t.space.xl, paddingVertical: t.space.xxl },
  box: { width: '100%' as const, maxWidth: 380, gap: t.space.xl },
  header: { gap: t.space.sm },
});

// Last address that signed in — prefilled so returning users don't retype it.
// Kept out of session.ts on purpose: it must survive logout (clearSession).
const LAST_EMAIL = 'blnk_last_email';

export default function Login() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const [email, setEmail] = useState(() => getItem(LAST_EMAIL) ?? '');
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
    setItem(LAST_EMAIL, email.trim()); // remember only once blnk_auth accepted it
    setSent(true);
    setMsg({ text: 'Code sent — check your inbox.', tone: 'success' });
  });

  const verify = (c = code) => run(async () => {
    const tokens = await otpVerify(email, c);
    setTokens(tokens.access_token, tokens.refresh_token);
    router.replace('/dashboard');
  });

  const onCodeChange = (v: string) => {
    setCode(v);
    if (v.length === 6) verify(v);
  };

  const loginPasskey = () => run(async () => {
    const options = await passkeyLoginBegin(email);
    const assertion = await doAuthenticate(options);
    const tokens = await passkeyLoginComplete(email, assertion);
    setTokens(tokens.access_token, tokens.refresh_token);
    router.replace('/dashboard');
  });

  return (
    <Screen scroll={false} padded={false} toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.center}>
        <View style={s.box}>
          <View style={s.header}>
            <Text variant="title">blnk</Text>
            <Text muted>sign in · {TENANT}</Text>
          </View>

          <GroupedCard>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            {sent && (
              <TextField label="Verification code" value={code} onChangeText={onCodeChange} placeholder="6-digit code" keyboardType="number-pad" autoFocus />
            )}
            <Button label={sent ? 'Verify & sign in' : 'Send code'} onPress={sent ? () => verify() : sendCode} loading={busy} />
            {sent && (
              <Button label="Use a different email" variant="ghost" onPress={() => { setSent(false); setCode(''); setMsg(null); }} />
            )}
          </GroupedCard>

          {passkeySupported && (
            <Button label="Sign in with passkey" variant="secondary" onPress={loginPasskey} loading={busy} />
          )}

        </View>
      </View>
    </Screen>
  );
}
