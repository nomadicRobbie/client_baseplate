import { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { useLocalSearchParams, Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ClientSubscription, Plan } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listPlans, listMySubscriptions, subscribeCheckout, cancelSubscription, oneOffCheckout } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Badge, Notice } from '@/ui/components';

function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
}
async function goToCheckout(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else await WebBrowser.openBrowserAsync(url);
}
function money(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`; }
}

export default function Payments() {
  const t = useTheme();
  const { features } = useAuth();
  const params = useLocalSearchParams<{ billing?: string }>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<ClientSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const token = getAccessToken()!;
      const [p, s] = await Promise.all([listPlans(token), listMySubscriptions(token)]);
      setPlans(p.plans);
      setSubs(s.subscriptions);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (params.billing === 'success') setMsg({ text: 'Payment complete — thank you!', tone: 'success' });
    else if (params.billing === 'cancel') setMsg({ text: 'Checkout cancelled.', tone: 'info' });
    void load();
  }, [params.billing]);

  if (features && !features.stripe) return <Redirect href="/dashboard" />;

  const active = subs.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));
  const urls = () => ({
    success_url: `${origin()}/dashboard/payments?billing=success`,
    cancel_url: `${origin()}/dashboard/payments?billing=cancel`,
  });

  const subscribe = async (priceId: string) => {
    setBusy(true); setMsg(null);
    try {
      const { url } = await subscribeCheckout(getAccessToken()!, { price_id: priceId, ...urls() });
      await goToCheckout(url);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setBusy(true); setMsg(null);
    try { await cancelSubscription(getAccessToken()!, id); setMsg({ text: 'Subscription will cancel at period end.', tone: 'info' }); await load(); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const payOnce = async () => {
    setBusy(true); setMsg(null);
    try {
      const { url } = await oneOffCheckout(getAccessToken()!, { amount_cents: 1000, description: 'One-off payment', ...urls() });
      await goToCheckout(url);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <Text variant="title">Payments</Text>

      <Card>
        <Text variant="heading">Subscription</Text>
        {loading ? (
          <Text muted>Loading…</Text>
        ) : active ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Badge label={active.status} tone="success" />
              {active.cancel_at_period_end && <Badge label="cancels at period end" />}
            </View>
            {active.current_period_end && (
              <Text variant="small" muted>Renews {new Date(active.current_period_end).toLocaleDateString()}</Text>
            )}
            {!active.cancel_at_period_end && (
              <Button label="Cancel subscription" variant="ghost" onPress={() => cancel(active.stripe_subscription_id)} loading={busy} />
            )}
          </>
        ) : plans.length === 0 ? (
          <Text muted>No plans available. Add a recurring product in Stripe to offer one.</Text>
        ) : (
          <View style={{ gap: t.space.md }}>
            <Text muted>Choose a plan:</Text>
            {plans.map((p) => (
              <View key={p.price_id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, borderTopWidth: 1, borderTopColor: t.color.border, paddingTop: t.space.md }}>
                <View style={{ flex: 1 }}>
                  <Text>{p.product_name}</Text>
                  <Text variant="small" muted>{money(p.unit_amount, p.currency)} / {p.interval}</Text>
                </View>
                <Button label="Subscribe" onPress={() => subscribe(p.price_id)} loading={busy} />
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Text variant="heading">One-off payment</Text>
        <Text muted>Demo: a $10.00 one-time charge via Stripe Checkout.</Text>
        <Button label="Pay $10.00" variant="secondary" onPress={payOnce} loading={busy} />
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
