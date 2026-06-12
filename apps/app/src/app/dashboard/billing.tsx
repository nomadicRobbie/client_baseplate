import { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ClientSubscription } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listMySubscriptions, subscribeCheckout, cancelSubscription, oneOffCheckout } from '@/lib/api';
import { Screen, Text, Card, Button, Badge, Notice } from '@/ui/components';
import { Redirect } from 'expo-router';

// Client's subscription plan price (configured per client). Real clients set this
// to a price_id from their Stripe catalogue.
const PRICE_ID = process.env.EXPO_PUBLIC_SUBSCRIPTION_PRICE_ID ?? '';

function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
}

async function goToCheckout(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else await WebBrowser.openBrowserAsync(url);
}

export default function Billing() {
  const { features } = useAuth();
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

  // Payments must be enabled for this client.
  if (features && !features.stripe) return <Redirect href="/dashboard" />;

  const active = subs.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  const urls = () => ({
    success_url: `${origin()}/dashboard/billing?billing=success`,
    cancel_url: `${origin()}/dashboard/billing?billing=cancel`,
  });

  const subscribe = async () => {
    if (!PRICE_ID) { setMsg({ text: 'No plan configured (set EXPO_PUBLIC_SUBSCRIPTION_PRICE_ID).', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { url } = await subscribeCheckout(getAccessToken()!, { price_id: PRICE_ID, ...urls() });
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
      <Text variant="title">Billing</Text>

      <Card>
        <Text variant="heading">Subscription</Text>
        {loading ? <Text muted>Loading…</Text> : active ? (
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
        ) : (
          <>
            <Text muted>You don't have an active subscription.</Text>
            <Button label="Subscribe" onPress={subscribe} loading={busy} />
          </>
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
