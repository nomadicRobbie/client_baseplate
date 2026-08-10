import { useEffect } from 'react';
import { Slot, Redirect, usePathname, useRouter } from 'expo-router';
import { View, Pressable, useWindowDimensions, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { FeatureFlags } from '@blnk/shared';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProfileProvider, useProfile } from '@/lib/profile-context';
import { PinsProvider, usePins } from '@/lib/pins-context';
import { visibleNav, HOME_HREF, ACCOUNT_HREF, type IconName, type NavHref } from '@/lib/nav';
import { ThemeProvider, useTheme } from '@/theme';
import { Text } from '@/ui/components';
import { Onboarding } from '@/components/onboarding';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Spinner() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.bg }}>
      <ActivityIndicator color={t.color.primary} />
    </View>
  );
}

// Desktop sidebar — the full set of destinations, stacked vertically.
function Sidebar({ isAdmin, features, myModules }: { isAdmin: boolean; features: FeatureFlags | null; myModules: string[] }) {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  // Admin destinations (People, Settings) live under Account → Manage, not the
  // sidebar — keeps the desktop nav to Library · modules · Billing · Account.
  const items = visibleNav(isAdmin, features, myModules).filter((i) => i.group !== 'admin');
  return (
    <View style={{ gap: t.space.xs }}>
      {items.map((item) => {
        const active = pathname === item.href;
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
                backgroundColor: active || pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent',
              };
            }}
          >
            <Ionicons name={item.icon} size={20} color={active ? t.color.primary : t.color.textMuted} />
            <Text variant="label" color={active ? t.color.text : t.color.textMuted}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Mobile bottom bar — curated: Library · Account · two pinned modules.
function MobileTabBar() {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { pinned } = usePins();

  const tabs: { label: string; href: NavHref; icon: IconName }[] = [
    { label: 'Library', href: HOME_HREF, icon: 'library-outline' },
    { label: 'Account', href: ACCOUNT_HREF, icon: 'person-outline' },
    ...pinned.map((m) => ({ label: m.label, href: m.href, icon: m.icon })),
  ];

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Pressable
            key={tab.href}
            onPress={() => router.replace(tab.href)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={(state) => {
              const { pressed } = state as { pressed: boolean };
              return {
                flex: 1, flexDirection: 'column', alignItems: 'center', gap: 2,
                paddingTop: t.space.sm, paddingBottom: t.space.xs, minHeight: 52,
                backgroundColor: active || pressed ? t.color.surfaceAlt : 'transparent',
              };
            }}
          >
            <Ionicons name={tab.icon} size={22} color={active ? t.color.primary : t.color.textMuted} />
            <Text variant="small" color={active ? t.color.text : t.color.textMuted} numberOfLines={1}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Shell() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const { tenantSlug, signOut, features, user } = useAuth();
  const { data, myModules } = useProfile();
  const wide = width >= 900;

  const orgName = data?.org?.org_name ?? tenantSlug ?? 'dashboard';

  // Web browser-tab title follows the business name, not the raw URL.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = orgName;
  }, [orgName]);
  const firstName = data?.me.name?.split(' ')[0];
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const Brand = (
    <View style={{ gap: 2 }}>
      <Text variant="heading">{orgName}</Text>
      {!!firstName && <Text variant="small" muted>{greeting()}, {firstName}</Text>}
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.color.bg }}>
        <View style={{ width: 248, backgroundColor: t.color.surface, borderRightWidth: 1, borderRightColor: t.color.border, padding: t.space.lg, justifyContent: 'space-between' }}>
          <View style={{ gap: t.space.lg }}>
            {Brand}
            <Sidebar isAdmin={isAdmin} features={features} myModules={myModules} />
          </View>
          <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Log out">
            <Text variant="label" color={t.color.accent}>Log out</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}><Slot /></View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.color.bg }} edges={['bottom']}>
      <View style={{ flex: 1 }}><Slot /></View>
      <MobileTabBar />
    </SafeAreaView>
  );
}

// Applies the client's brand colour as a theme override, then gates onboarding.
function Themed() {
  const { data, loading, refresh } = useProfile();

  if (loading) return <Spinner />;

  const colorOverride: Record<string, string> = {};
  if (data?.org?.brand_color) colorOverride.primary = data.org.brand_color;
  if (data?.org?.accent_color) colorOverride.accent = data.org.accent_color;
  const theme = Object.keys(colorOverride).length ? { color: colorOverride } : undefined;

  const needsOnboarding = data?.onboarding.needs_org_setup || data?.onboarding.needs_personal;

  return (
    <ThemeProvider theme={theme}>
      {needsOnboarding
        ? <Onboarding onDone={refresh} />
        : <PinsProvider><Shell /></PinsProvider>}
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
