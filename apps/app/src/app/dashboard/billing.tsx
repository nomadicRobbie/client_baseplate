import { useEffect, useState } from 'react';
import { View, Platform, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { ClientSubscription } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listMySubscriptions, subscribeCheckout, cancelSubscription } from '@/lib/api';
import { Screen, Text, GroupedCard, GRow, SectionLabel } from '@/ui/components';
import { useTheme } from '@/theme';
import { formatDMY } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 8 },
  flex1: { flex: 1 },
  bold: { fontWeight: '700' as const },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelRow: { minHeight: 56, alignItems: 'center' as const, justifyContent: 'center' as const },
  subscribeBtn: { minHeight: 56, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.md, backgroundColor: t.color.primary },
  statusPill: (ok: boolean) => ({ paddingVertical: 4, paddingHorizontal: 10, borderRadius: t.radius.pill, borderWidth: 1, borderColor: ok ? t.color.primary : t.color.border, backgroundColor: ok ? t.color.primary + '18' : 'transparent' }),
});

const PRICE_ID = process.env.EXPO_PUBLIC_SUBSCRIPTION_PRICE_ID ?? '';

function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
}

async function goToCheckout(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else await WebBrowser.openBrowserAsync(url);
}

function StatusPill({ status }: { status: string }) {
  const t = useTheme();
  const s = makeStyles(t);
  const ok = status === 'active' || status === 'trialing';
  return (
    <View style={s.statusPill(ok)}>
      <Text variant="small" color={ok ? t.color.primary : t.color.textMuted} style={pillText}>{status}</Text>
    </View>
  );
}
const pillText = { textTransform: 'capitalize' as const };

export default function Billing() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { features, user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const params = useLocalSearchParams<{ billing?: string }>();
  const [subs, setSubs] = useState<ClientSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setSubs((await listMySubscriptions(getAccessToken()!)).subscriptions); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (params.billing === 'success') setMsg({ text: 'Payment complete — thank you!', tone: 'success' });
    else if (params.billing === 'cancel') setMsg({ text: 'Checkout cancelled.', tone: 'info' });
    void load();
  }, [params.billing]);

  if (features && !features.stripe) return <Redirect href="/dashboard" />;
  if (!isAdmin) return <Redirect href="/dashboard" />;

  const active = subs.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  const urls = () => ({
    success_url: `${origin()}/dashboard/billing?billing=success`,
    cancel_url: `${origin()}/dashboard/billing?billing=cancel`,
  });

  const subscribe = async () => {
    if (!PRICE_ID) { setMsg({ text: 'No plan configured.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { url } = await subscribeCheckout(getAccessToken()!, { price_id: PRICE_ID, ...urls() });
      await goToCheckout(url);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!active) return;
    setBusy(true); setMsg(null);
    try {
      await cancelSubscription(getAccessToken()!, active.stripe_subscription_id);
      setMsg({ text: 'Subscription will cancel at period end.', tone: 'info' });
      await load();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Account</Text>
      </Pressable>

      {loading ? null : active ? (
        <>
          <View style={s.section}>
            <SectionLabel>Subscription</SectionLabel>
            <GroupedCard>
              <GRow>
                <Text variant="label" style={s.flex1}>Plan</Text>
                <Text variant="body" muted>{active.stripe_price_id ? 'Operator' : '—'}</Text>
              </GRow>
              <GRow>
                <Text variant="label" style={s.flex1}>Status</Text>
                <StatusPill status={active.status} />
              </GRow>
              {!!active.current_period_end && (
                <GRow>
                  <Text variant="label" style={s.flex1}>{active.cancel_at_period_end ? 'Cancels' : 'Renews'}</Text>
                  <Text variant="body" muted>{formatDMY(active.current_period_end)}</Text>
                </GRow>
              )}
              <GRow last>
                <Text variant="label" style={s.flex1}>Monthly total</Text>
                <Text variant="body" style={s.bold}>—</Text>
              </GRow>
            </GroupedCard>
          </View>

          <View style={s.section}>
            <SectionLabel>Manage</SectionLabel>
            <GroupedCard>
              <GRow onPress={subscribe}>
                <View style={s.iconBox}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Change plan</Text>
                <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
              </GRow>
              <GRow>
                <View style={s.iconBox}>
                  <Ionicons name="card-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Payment method</Text>
                <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
              </GRow>
              <GRow last>
                <View style={s.iconBox}>
                  <Ionicons name="receipt-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Invoices</Text>
                <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
              </GRow>
            </GroupedCard>
          </View>

          {!active.cancel_at_period_end && (
            <GroupedCard>
              <Pressable onPress={cancel} disabled={busy} accessibilityRole="button" style={s.cancelRow}>
                <Text variant="label" color={t.color.danger}>{busy ? 'Cancelling…' : 'Cancel subscription'}</Text>
              </Pressable>
            </GroupedCard>
          )}
        </>
      ) : (
        <>
          <View style={s.section}>
            <SectionLabel>Subscription</SectionLabel>
            <GroupedCard>
              <GRow last>
                <Text variant="label" style={s.flex1}>No active subscription</Text>
              </GRow>
            </GroupedCard>
          </View>
          <Pressable onPress={subscribe} disabled={busy} accessibilityRole="button" style={s.subscribeBtn}>
            <Text variant="label" color={t.color.primaryText}>{busy ? 'Loading…' : 'Subscribe'}</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
