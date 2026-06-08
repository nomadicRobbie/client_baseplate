import { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { useLocalSearchParams, Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { BlnkBillingStatus } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { getBlnkBilling, blnkCheckout, blnkPortal } from '@/lib/api';
import { Screen, Text, Card, Button, Badge, Notice } from '@/ui/components';

// blnk PLATFORM billing — the client's blnk plan. Admin/super only.
// (Members manage their own product payments on the separate Payments page.)
function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
}
async function open(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else await WebBrowser.openBrowserAsync(url);
}
function money(cents: number | null, currency: string | null): string {
  if (cents == null) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency ?? 'nzd').toUpperCase() }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${(currency ?? 'nzd').toUpperCase()}`; }
}

export default function Billing() {
  const { data } = useProfile();
  const params = useLocalSearchParams<{ billing?: string }>();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';
  const [billing, setBilling] = useState<BlnkBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setBilling((await getBlnkBilling(getAccessToken()!)).billing); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (params.billing === 'success') setMsg({ text: 'Thanks — your blnk subscription is active.', tone: 'success' });
    else if (params.billing === 'cancel') setMsg({ text: 'Checkout cancelled.', tone: 'info' });
    void load();
  }, [params.billing]);

  if (data && !isAdmin) return <Redirect href="/dashboard" />;

  const urls = () => ({
    success_url: `${origin()}/dashboard/billing?billing=success`,
    cancel_url: `${origin()}/dashboard/billing?billing=cancel`,
  });

  const startSubscription = async () => {
    setBusy(true); setMsg(null);
    try { const { url } = await blnkCheckout(getAccessToken()!, urls()); await open(url); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const manage = async () => {
    setBusy(true); setMsg(null);
    try { const { url } = await blnkPortal(getAccessToken()!, { return_url: `${origin()}/dashboard/billing` }); await open(url); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const active = billing && ['active', 'trialing', 'past_due'].includes(billing.status);

  return (
    <Screen>
      <Text variant="title">Billing</Text>
      <Text muted>Your blnk plan — the subscription for this dashboard.</Text>

      <Card>
        <Text variant="heading">Plan</Text>
        {loading ? (
          <Text muted>Loading…</Text>
        ) : active ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text>{billing!.plan_name ?? 'blnk plan'}</Text>
              <Badge label={billing!.status} tone="success" />
              {billing!.cancel_at_period_end && <Badge label="cancels at period end" />}
            </View>
            {billing!.current_period_end && (
              <Text variant="small" muted>
                Next invoice {money(billing!.next_invoice_cents, billing!.currency)} on {new Date(billing!.current_period_end).toLocaleDateString()}
              </Text>
            )}
            {billing!.card_last4 && <Text variant="small" muted>Card ending {billing!.card_last4}</Text>}
            <Button label="Manage billing" onPress={manage} loading={busy} />
          </>
        ) : (
          <>
            <Text muted>
              {billing?.status === 'past_due' ? 'Your subscription needs attention.'
                : 'No active blnk subscription — start one to keep your dashboard running.'}
            </Text>
            <Button label="Set up billing" onPress={startSubscription} loading={busy} />
          </>
        )}
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
