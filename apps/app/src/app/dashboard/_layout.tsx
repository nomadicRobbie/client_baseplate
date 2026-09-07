import { useEffect } from 'react';
import { Slot, Redirect, usePathname, useRouter } from 'expo-router';
import { View, Pressable, useWindowDimensions, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { FeatureFlags } from '@blnk/shared';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { FeedBadgeProvider, useFeedBadge } from '@/lib/feed-badge-context';
import { getAccessToken } from '@/lib/session';
import { registerPushToken } from '@/lib/api';
import { ProfileProvider, useProfile } from '@/lib/profile-context';
import { PinsProvider, usePins } from '@/lib/pins-context';
import { visibleNav, HOME_HREF, ACCOUNT_HREF, type IconName, type NavHref, type NavGroup } from '@/lib/nav';
import { ThemeProvider, useTheme } from '@/theme';
import { Text } from '@/ui/components';
import { Onboarding } from '@/components/onboarding';

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Shown when trial is expired and no active subscription. Blocks all navigation.
function TrialWall({ isAdmin }: { isAdmin: boolean }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center', padding: t.space.xl, gap: t.space.lg }}>
      <Ionicons name="time-outline" size={48} color={t.color.textMuted} />
      <View style={{ alignItems: 'center', gap: t.space.sm }}>
        <Text variant="heading">Your free trial has ended</Text>
        {isAdmin
          ? <Text variant="body" muted style={{ textAlign: 'center' }}>Subscribe to keep using blnk. Choose the modules your team needs.</Text>
          : <Text variant="body" muted style={{ textAlign: 'center' }}>Your organisation's free trial has ended. Contact your admin to subscribe.</Text>}
      </View>
      {isAdmin && (
        <Pressable
          onPress={() => router.replace('/dashboard/billing')}
          accessibilityRole="button"
          style={{ backgroundColor: t.color.primary, paddingVertical: t.space.md, paddingHorizontal: t.space.xl, borderRadius: t.radius.md, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="label" color={t.color.primaryText}>Subscribe now</Text>
        </Pressable>
      )}
    </View>
  );
}

// Shown as a top banner when ≤ 7 days remain on the trial.
function TrialBanner({ daysLeft, isAdmin }: { daysLeft: number; isAdmin: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const urgent = daysLeft <= 3;
  const color = urgent ? t.color.danger : t.color.primary;
  return (
    <Pressable
      onPress={isAdmin ? () => router.push('/dashboard/billing') : undefined}
      accessibilityRole={isAdmin ? 'button' : 'text'}
      style={{ backgroundColor: color + '18', borderBottomWidth: 1, borderBottomColor: color + '40', paddingVertical: t.space.sm, paddingHorizontal: t.space.md, flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}
    >
      <Ionicons name={urgent ? 'warning-outline' : 'time-outline'} size={16} color={color} />
      <Text variant="small" color={color} style={{ flex: 1 }}>
        {daysLeft <= 0
          ? 'Your free trial has ended.'
          : daysLeft === 1
          ? 'Your free trial ends tomorrow.'
          : `${daysLeft} days left in your free trial.`}
        {isAdmin ? ' Tap to subscribe.' : ''}
      </Text>
    </Pressable>
  );
}

// Show alerts when the app is foregrounded.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  spinner: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  sidebarContainer: { gap: 0 },
  mobileBar: { flexDirection: 'row' as const, justifyContent: 'space-around' as const },
  mobileTab: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: t.space.sm, minHeight: 52 },
  brand: { gap: 2 },
  wideLayout: { flex: 1, flexDirection: 'row' as const },
  sidebar: { width: 248, borderRightWidth: 1, borderRightColor: t.color.border, padding: t.space.lg, justifyContent: 'space-between' as const },
  sidebarTop: { gap: t.space.lg },
  content: { flex: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.danger, marginLeft: 4 },
  sidebarSection: { gap: 0, paddingTop: t.space.xl },
  sectionHeading: { paddingHorizontal: t.space.md, paddingBottom: t.space.sm, fontSize: t.size.sm, fontWeight: '400' as const },
  navLabel: { fontSize: t.size.sm, fontWeight: '400' as const },
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Spinner() {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={[s.spinner, { backgroundColor: t.color.bg }]}>
      <ActivityIndicator color={t.color.primary} />
    </View>
  );
}

const SIDEBAR_SECTIONS: { group: NavGroup; label?: string }[] = [
  { group: 'home' },
  { group: 'operations', label: 'Planning' },
  { group: 'module', label: 'Tools' },
  { group: 'account', label: 'Account' },
];

// Desktop sidebar — the full set of destinations, stacked vertically.
function Sidebar({ isAdmin, features, myModules, tenantModules }: { isAdmin: boolean; features: FeatureFlags | null; myModules: string[]; tenantModules: string[] | null }) {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const pathname = usePathname();
  const { hasUnseen } = useFeedBadge();
  const items = visibleNav(isAdmin, features, myModules, tenantModules).filter((i) => i.group !== 'admin');
  return (
    <View style={s.sidebarContainer}>
      {SIDEBAR_SECTIONS.map(({ group, label }) => {
        const section = items.filter((i) => i.group === group);
        if (!section.length) return null;
        return (
          <View key={group} style={[s.sidebarSection, !label && { paddingTop: 0 }]}>
            {label && <Text variant="small" color={t.color.primary} style={s.sectionHeading}>{label}</Text>}
            {section.map((item) => {
              const active = pathname === item.href;
              const showBadge = item.href === '/dashboard/feed' && hasUnseen && !active;
              return (
                <Pressable
                  key={item.href}
                  onPress={() => router.replace(item.href)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                  style={(state) => {
                    const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                    return {
                      flexDirection: 'row', alignItems: 'center', gap: t.space.md,
                      paddingVertical: t.space.sm, paddingHorizontal: t.space.md,
                      borderRadius: t.radius.md, minHeight: 34,
                      backgroundColor: pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent',
                    };
                  }}
                >
                  <Ionicons name={item.icon} size={18} color={active ? t.color.primary : t.color.textMuted} />
                  <Text variant="small" color={active ? t.color.text : t.color.textMuted} style={s.navLabel}>{item.label}</Text>
                  {showBadge && <View style={s.badgeDot} />}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// Mobile bottom bar — curated: Library · Account · two pinned modules.
function MobileTabBar() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const pathname = usePathname();
  const { pinned } = usePins();
  const { hasUnseen } = useFeedBadge();
  const insets = useSafeAreaInsets();

  const tabs: { label: string; href: NavHref; icon: IconName }[] = [
    { label: 'Library', href: HOME_HREF, icon: 'library-outline' },
    { label: 'Company Feed', href: '/dashboard/feed', icon: 'newspaper-outline' },
    { label: 'Account', href: ACCOUNT_HREF, icon: 'person-outline' },
    ...pinned.map((m) => ({ label: m.label, href: m.href, icon: m.icon })),
  ];

  return (
    <View style={[s.mobileBar, { backgroundColor: t.color.surface, paddingBottom: insets.bottom }]}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Pressable
            key={tab.href}
            onPress={() => router.replace(tab.href)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={s.mobileTab}
          >
            <View style={{ alignItems: 'center' }}>
              <Ionicons name={tab.icon} size={24} color={active ? t.color.primary : t.color.textMuted} />
              {tab.href === '/dashboard/feed' && hasUnseen && !active && (
                <View style={[s.badgeDot, { position: 'absolute', top: 0, right: -2 }]} />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Shell() {
  const t = useTheme();
  const s = makeStyles(t);
  const { width } = useWindowDimensions();
  const { tenantSlug, signOut, features, user, trialEndsAt } = useAuth();
  const { data, myModules, tenantModules } = useProfile();
  const wide = width >= 900;
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const daysLeft = trialDaysLeft(trialEndsAt);
  // Block access when trial has expired (daysLeft < 0). Billing page is exempt so admin can subscribe.
  const pathname = usePathname();
  const trialExpired = daysLeft !== null && daysLeft <= 0 && pathname !== '/dashboard/billing';

  const orgName = data?.org?.org_name ?? tenantSlug ?? 'dashboard';
  const router = useRouter();

  // Web browser-tab title follows the business name, not the raw URL.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = orgName;
  }, [orgName]);

  // Register for push notifications on native and handle taps that deep-link.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
          process.env.EXPO_PUBLIC_PUSH_PROJECT_ID;
        if (!projectId) return;
        const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
        const tok = getAccessToken();
        if (tok) await registerPushToken(tok, pushToken);
      } catch { /* registration is best-effort */ }
    })();

    const sub = Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
      const route = response.notification.request.content.data?.route as string | undefined;
      if (route) router.push(route as never);
    });
    return () => sub.remove();
  }, []);
  const firstName = data?.me.name?.split(' ')[0];

  const Brand = (
    <View style={s.brand}>
      <Text variant="heading">{orgName}</Text>
      {!!firstName && <Text variant="small" muted>{greeting()}, {firstName}</Text>}
    </View>
  );

  const showBanner = daysLeft !== null && daysLeft > 0 && daysLeft <= 7;
  const Banner = showBanner ? <TrialBanner daysLeft={daysLeft!} isAdmin={isAdmin} /> : null;

  if (trialExpired) {
    return (
      <View style={{ flex: 1, backgroundColor: t.color.bg }}>
        <TrialWall isAdmin={isAdmin} />
      </View>
    );
  }

  if (wide) {
    return (
      <View style={[s.wideLayout, { backgroundColor: t.color.bg }]}>
        <View style={[s.sidebar, { backgroundColor: t.color.surface }]}>
          <View style={s.sidebarTop}>
            {Brand}
            <Sidebar isAdmin={isAdmin} features={features} myModules={myModules} tenantModules={tenantModules} />
          </View>
          <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Log out">
            <Text variant="label" color={t.color.accent}>Log out</Text>
          </Pressable>
        </View>
        <View style={s.content}>
          {Banner}
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.content, { backgroundColor: t.color.bg }]}>
      <View style={s.content}>
        {Banner}
        <Slot />
      </View>
      <MobileTabBar />
    </View>
  );
}

function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? '#0e0e0e' : '#ffffff';
}

// Applies the client's brand colour as a theme override, then gates onboarding.
function Themed() {
  const { data, loading, refresh } = useProfile();

  if (loading) return <Spinner />;

  const colorOverride: Record<string, string> = {
    ...data?.org?.custom_colors,
    ...(data?.org?.brand_color ? { primary: data.org.brand_color, primaryText: contrastText(data.org.brand_color) } : {}),
    ...(data?.org?.accent_color ? { accent: data.org.accent_color } : {}),
  };
  const theme = Object.keys(colorOverride).length ? { color: colorOverride } : undefined;

  const needsOnboarding = data?.onboarding.needs_org_setup || data?.onboarding.needs_personal;

  return (
    <ThemeProvider theme={theme}>
      {needsOnboarding
        ? <Onboarding onDone={refresh} />
        : <FeedBadgeProvider><PinsProvider><Shell /></PinsProvider></FeedBadgeProvider>}
    </ThemeProvider>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Redirect href="/login" />;
  return <ProfileProvider><Themed /></ProfileProvider>;
}

export default function DashboardLayout() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
