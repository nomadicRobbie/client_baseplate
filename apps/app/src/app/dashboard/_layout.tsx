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
import { visibleNav, HOME_HREF, ACCOUNT_HREF, type IconName, type NavHref } from '@/lib/nav';
import { ThemeProvider, useTheme } from '@/theme';
import { Text } from '@/ui/components';
import { Onboarding } from '@/components/onboarding';

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
  sidebarContainer: { gap: t.space.xs },
  mobileBar: { flexDirection: 'row' as const, justifyContent: 'space-around' as const },
  mobileTab: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: t.space.sm, minHeight: 52 },
  brand: { gap: 2 },
  wideLayout: { flex: 1, flexDirection: 'row' as const },
  sidebar: { width: 248, borderRightWidth: 1, borderRightColor: t.color.border, padding: t.space.lg, justifyContent: 'space-between' as const },
  sidebarTop: { gap: t.space.lg },
  content: { flex: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.danger ?? '#e53e3e', marginLeft: 4 },
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

// Desktop sidebar — the full set of destinations, stacked vertically.
function Sidebar({ isAdmin, features, myModules }: { isAdmin: boolean; features: FeatureFlags | null; myModules: string[] }) {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const pathname = usePathname();
  const { hasUnseen } = useFeedBadge();
  const items = visibleNav(isAdmin, features, myModules).filter((i) => i.group !== 'admin');
  return (
    <View style={s.sidebarContainer}>
      {items.map((item) => {
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
                paddingVertical: t.space.md, paddingHorizontal: t.space.md,
                borderRadius: t.radius.md, minHeight: 44,
                backgroundColor: pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent',
              };
            }}
          >
            <Ionicons name={item.icon} size={20} color={active ? t.color.primary : t.color.textMuted} />
            <Text variant="label" color={active ? t.color.text : t.color.textMuted}>{item.label}</Text>
            {showBadge && <View style={s.badgeDot} />}
          </Pressable>
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
  const { tenantSlug, signOut, features, user } = useAuth();
  const { data, myModules } = useProfile();
  const wide = width >= 900;

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
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const Brand = (
    <View style={s.brand}>
      <Text variant="heading">{orgName}</Text>
      {!!firstName && <Text variant="small" muted>{greeting()}, {firstName}</Text>}
    </View>
  );

  if (wide) {
    return (
      <View style={[s.wideLayout, { backgroundColor: t.color.bg }]}>
        <View style={[s.sidebar, { backgroundColor: t.color.surface }]}>
          <View style={s.sidebarTop}>
            {Brand}
            <Sidebar isAdmin={isAdmin} features={features} myModules={myModules} />
          </View>
          <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Log out">
            <Text variant="label" color={t.color.accent}>Log out</Text>
          </Pressable>
        </View>
        <View style={s.content}><Slot /></View>
      </View>
    );
  }

  return (
    <View style={[s.content, { backgroundColor: t.color.bg }]}>
      <View style={s.content}><Slot /></View>
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
