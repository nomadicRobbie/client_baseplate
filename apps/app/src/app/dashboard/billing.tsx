import { useEffect, useState } from 'react';
import { View, Platform, Pressable } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { BlnkBillingStatus } from '@blnk/shared';
import { MODULE_MANIFEST } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { getBlnkBilling, blnkBillingPortal, blnkModuleCheckout, blnkUpdateModulePlan } from '@/lib/api';
import { Screen, Text, GroupedCard, GRow, SectionLabel } from '@/ui/components';
import { useTheme } from '@/theme';
import { formatDMY } from '@/lib/format';

const SELLABLE = MODULE_MANIFEST.filter(m => m.sellable);

// Monthly prices per module key — mirrors blnk_api config
const MODULE_PRICES: Record<string, number> = {
  commerce: 79, asset: 69, compliance: 59, schedule: 49, roster: 39,
};
const FLEET_CAP = 249;

function calcTotal(selected: string[], interval: 'month' | 'year'): number {
  const monthly = selected.reduce((t, k) => t + (MODULE_PRICES[k] ?? 0), 0);
  const capped = monthly >= FLEET_CAP ? FLEET_CAP : monthly;
  return interval === 'year' ? capped * 10 : capped; // 2 months free
}

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 8 },
  flex1: { flex: 1 },
  bold: { fontWeight: '700' as const },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelRow: { minHeight: 56, alignItems: 'center' as const, justifyContent: 'center' as const },
  subscribeBtn: { minHeight: 56, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.md, backgroundColor: t.color.primary },
  subscribeBtnDisabled: { minHeight: 56, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.md, backgroundColor: t.color.border },
  intervalRow: { flexDirection: 'row' as const, gap: 8 },
  intervalBtn: (active: boolean) => ({ flex: 1, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: t.radius.md, borderWidth: 1, borderColor: active ? t.color.primary : t.color.border, backgroundColor: active ? t.color.primary + '12' : 'transparent' }),
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
  const { refresh: refreshProfile } = useProfile();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const [billing, setBilling] = useState<BlnkBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [changingModules, setChangingModules] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const b = await getBlnkBilling(getAccessToken()!);
      setBilling(b);
      setSelectedModules(b.modules.length > 0 ? b.modules : SELLABLE.map(m => m.key));
    }
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

  const toggleModule = (key: string) =>
    setSelectedModules(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const hasChanges = !!billing && (
    [...selectedModules].sort().join(',') !== [...(billing.modules ?? [])].sort().join(',') ||
    interval !== (billing.interval ?? 'month')
  );

  const updatePlan = async () => {
    if (selectedModules.length === 0) { setMsg({ text: 'Select at least one module.', tone: 'info' }); return; }
    setBusy(true); setMsg(null);
    try {
      await blnkUpdateModulePlan(getAccessToken()!, { modules: selectedModules, interval });
      setChangingModules(false);
      setMsg({ text: 'Plan updated.', tone: 'success' });
      void load();
      void refreshProfile();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const subscribe = async () => {
    if (selectedModules.length === 0) { setMsg({ text: 'Select at least one module.', tone: 'info' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { url } = await blnkModuleCheckout(getAccessToken()!, { modules: selectedModules, interval, ...urls() });
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
                  <Text variant="label" style={s.flex1}>{billing.interval === 'year' ? 'Annual total' : 'Monthly total'}</Text>
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
              <GRow onPress={() => setChangingModules(v => !v)}>
                <View style={s.iconBox}>
                  <Ionicons name="apps-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Change modules</Text>
                <Ionicons name={changingModules ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} />
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

          {changingModules && (
            <>
              <View style={s.section}>
                <SectionLabel>Modules</SectionLabel>
                <GroupedCard>
                  {SELLABLE.map((m, i) => {
                    const selected = selectedModules.includes(m.key);
                    return (
                      <GRow key={m.key} last={i === SELLABLE.length - 1} onPress={() => toggleModule(m.key)}>
                        <Text variant="label" style={s.flex1}>{m.label}</Text>
                        <Text variant="body" muted style={{ marginRight: 8 }}>${MODULE_PRICES[m.key] ?? 0}/mo</Text>
                        <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? t.color.primary : t.color.textMuted} />
                      </GRow>
                    );
                  })}
                </GroupedCard>
              </View>
              <View style={s.section}>
                <SectionLabel>Interval</SectionLabel>
                <View style={s.intervalRow}>
                  {(['month', 'year'] as const).map(iv => (
                    <Pressable key={iv} onPress={() => setInterval(iv)} style={s.intervalBtn(interval === iv)} accessibilityRole="button">
                      <Text variant="label" color={interval === iv ? t.color.primary : t.color.textMuted}>
                        {iv === 'month' ? 'Monthly' : 'Annual'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {hasChanges && selectedModules.length > 0 && (
                <GroupedCard>
                  <GRow last>
                    <Text variant="label" style={s.flex1}>
                      {selectedModules.reduce((t, k) => t + (MODULE_PRICES[k] ?? 0), 0) >= FLEET_CAP ? 'Fleet (all modules)' : 'New total'}
                    </Text>
                    <Text variant="body" style={s.bold}>
                      {new Intl.NumberFormat('en', { style: 'currency', currency: 'NZD' }).format(calcTotal(selectedModules, interval))}
                      {interval === 'year' ? '/yr' : '/mo'}
                    </Text>
                  </GRow>
                </GroupedCard>
              )}
              <Pressable
                onPress={updatePlan}
                disabled={busy || !hasChanges || selectedModules.length === 0}
                accessibilityRole="button"
                style={busy || !hasChanges || selectedModules.length === 0 ? s.subscribeBtnDisabled : s.subscribeBtn}
              >
                <Text variant="label" color={t.color.primaryText}>{busy ? 'Updating…' : 'Update plan'}</Text>
              </Pressable>
            </>
          )}
        </>
      ) : (
        <>
          <View style={s.section}>
            <SectionLabel>Choose modules</SectionLabel>
            <GroupedCard>
              {SELLABLE.map((m, i) => {
                const selected = selectedModules.includes(m.key);
                return (
                  <GRow key={m.key} last={i === SELLABLE.length - 1} onPress={() => toggleModule(m.key)}>
                    <Text variant="label" style={s.flex1}>{m.label}</Text>
                    <Text variant="body" muted style={{ marginRight: 8 }}>
                      ${MODULE_PRICES[m.key] ?? 0}/mo
                    </Text>
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={selected ? t.color.primary : t.color.textMuted}
                    />
                  </GRow>
                );
              })}
            </GroupedCard>
          </View>

          <View style={s.section}>
            <SectionLabel>Billing interval</SectionLabel>
            <View style={s.intervalRow}>
              {(['month', 'year'] as const).map(iv => (
                <Pressable key={iv} onPress={() => setInterval(iv)} style={s.intervalBtn(interval === iv)} accessibilityRole="button">
                  <Text variant="label" color={interval === iv ? t.color.primary : t.color.textMuted}>
                    {iv === 'month' ? 'Monthly' : 'Annual'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {selectedModules.length > 0 && (
            <GroupedCard>
              <GRow last>
                <Text variant="label" style={s.flex1}>
                  {selectedModules.reduce((t, k) => t + (MODULE_PRICES[k] ?? 0), 0) >= FLEET_CAP ? 'Fleet (all modules)' : 'Total'}
                </Text>
                <Text variant="body" style={s.bold}>
                  {new Intl.NumberFormat('en', { style: 'currency', currency: 'NZD' }).format(calcTotal(selectedModules, interval))}
                  {interval === 'year' ? '/yr' : '/mo'}
                </Text>
              </GRow>
            </GroupedCard>
          )}

          <Pressable
            onPress={subscribe}
            disabled={busy || selectedModules.length === 0}
            accessibilityRole="button"
            style={busy || selectedModules.length === 0 ? s.subscribeBtnDisabled : s.subscribeBtn}
          >
            <Text variant="label" color={t.color.primaryText}>{busy ? 'Loading…' : 'Subscribe'}</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
