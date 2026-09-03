import { useEffect, useState } from 'react';
import { View, Platform, Pressable } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { BlnkBillingStatus } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { getBlnkBilling, blnkBillingCheckout, blnkBillingPortal } from '@/lib/api';
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

function origin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
}

async function openUrl(url: string) {
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const [billing, setBilling] = useState<BlnkBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setBilling(await getBlnkBilling(getAccessToken()!)); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const active = billing && billing.status !== 'none' && ['active', 'trialing', 'past_due'].includes(billing.status);

  const urls = () => ({
    success_url: `${origin()}/dashboard/billing`,
    cancel_url: `${origin()}/dashboard/billing`,
  });

  const subscribe = async () => {
    setBusy(true); setMsg(null);
    try {
      const { url } = await blnkBillingCheckout(getAccessToken()!, urls());
      await openUrl(url);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const openPortal = async () => {
    setBusy(true); setMsg(null);
    try {
      const { url } = await blnkBillingPortal(getAccessToken()!, { return_url: `${origin()}/dashboard/billing` });
      await openUrl(url);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color={t.color.primary} />
        <Text variant="label" color={t.color.primary}>Account</Text>
      </Pressable>

      {loading ? null : active && billing ? (
        <>
          <View style={s.section}>
            <SectionLabel>Subscription</SectionLabel>
            <GroupedCard>
              {!!billing.plan_name && (
                <GRow>
                  <Text variant="label" style={s.flex1}>Plan</Text>
                  <Text variant="body" muted>{billing.plan_name}</Text>
                </GRow>
              )}
              <GRow>
                <Text variant="label" style={s.flex1}>Status</Text>
                <StatusPill status={billing.status} />
              </GRow>
              {!!billing.current_period_end && (
                <GRow>
                  <Text variant="label" style={s.flex1}>{billing.cancel_at_period_end ? 'Cancels' : 'Renews'}</Text>
                  <Text variant="body" muted>{formatDMY(billing.current_period_end)}</Text>
                </GRow>
              )}
              {billing.next_invoice_cents != null && !!billing.currency && (
                <GRow>
                  <Text variant="label" style={s.flex1}>Monthly total</Text>
                  <Text variant="body" style={s.bold}>
                    {new Intl.NumberFormat('en', { style: 'currency', currency: billing.currency.toUpperCase() }).format(billing.next_invoice_cents / 100)}
                  </Text>
                </GRow>
              )}
              {!!billing.card_last4 && (
                <GRow last>
                  <Text variant="label" style={s.flex1}>Card</Text>
                  <Text variant="body" muted>•••• {billing.card_last4}</Text>
                </GRow>
              )}
            </GroupedCard>
          </View>

          <View style={s.section}>
            <SectionLabel>Manage</SectionLabel>
            <GroupedCard>
              <GRow onPress={openPortal}>
                <View style={s.iconBox}>
                  <Ionicons name="card-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Payment method &amp; invoices</Text>
                <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
              </GRow>
              {!billing.cancel_at_period_end && (
                <GRow last onPress={openPortal}>
                  <View style={s.iconBox}>
                    <Ionicons name="close-circle-outline" size={18} color={t.color.danger} />
                  </View>
                  <Text variant="label" style={s.flex1} color={t.color.danger}>Cancel subscription</Text>
                  <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
                </GRow>
              )}
            </GroupedCard>
          </View>
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
