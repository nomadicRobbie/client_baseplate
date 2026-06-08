import { Slot, Redirect, usePathname, useRouter } from 'expo-router';
import { View, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ProfileProvider, useProfile } from '@/lib/profile-context';
import { ThemeProvider, useTheme } from '@/theme';
import { Text } from '@/ui/components';
import { Onboarding } from '@/components/onboarding';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type NavHref = '/dashboard' | '/dashboard/account' | '/dashboard/payments' | '/dashboard/billing' | '/dashboard/team' | '/dashboard/settings';
// audience: 'admin' → admin/super only · 'member' → non-admins only · undefined → everyone
type NavItem = { label: string; href: NavHref; icon: IconName; adminOnly?: boolean; audience?: 'admin' | 'member'; feature?: 'stripe' };

const NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: 'grid-outline' },
  { label: 'Payments', href: '/dashboard/payments', icon: 'card-outline', feature: 'stripe', audience: 'member' },
  { label: 'Billing', href: '/dashboard/billing', icon: 'receipt-outline', feature: 'stripe', audience: 'admin' },
  { label: 'Account', href: '/dashboard/account', icon: 'person-outline' },
  { label: 'Team', href: '/dashboard/team', icon: 'people-outline', adminOnly: true },
  { label: 'Settings', href: '/dashboard/settings', icon: 'settings-outline', adminOnly: true },
];

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

function NavList({ vertical, isAdmin, stripeOn }: { vertical: boolean; isAdmin: boolean; stripeOn: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const items = NAV.filter((i) =>
    (!i.adminOnly || isAdmin) &&
    (!i.feature || (i.feature === 'stripe' && stripeOn)) &&
    (!i.audience || (i.audience === 'admin' ? isAdmin : !isAdmin))
  );
  return (
    <View style={{ flexDirection: vertical ? 'column' : 'row', gap: t.space.xs, justifyContent: vertical ? 'flex-start' : 'space-around' }}>
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
              const bg = active || pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent';
              return {
                flexDirection: vertical ? 'row' : 'column', alignItems: 'center', gap: vertical ? t.space.md : 2,
                paddingVertical: t.space.md, paddingHorizontal: vertical ? t.space.md : t.space.sm,
                borderRadius: t.radius.md, minHeight: 44, flex: vertical ? undefined : 1,
                backgroundColor: vertical ? bg : active ? t.color.surfaceAlt : 'transparent',
              };
            }}
          >
            <Ionicons name={item.icon} size={20} color={active ? t.color.primary : t.color.textMuted} />
            <Text variant={vertical ? 'label' : 'small'} color={active ? t.color.text : t.color.textMuted}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Shell() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const { tenantSlug, signOut, features } = useAuth();
  const { data } = useProfile();
  const wide = width >= 900;

  const orgName = data?.org?.org_name ?? tenantSlug ?? 'dashboard';
  const firstName = data?.me.name?.split(' ')[0];
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';
  const stripeOn = !!features?.stripe;

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
            <NavList vertical isAdmin={isAdmin} stripeOn={stripeOn} />
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
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
        <NavList vertical={false} isAdmin={isAdmin} stripeOn={stripeOn} />
      </View>
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
      {needsOnboarding ? <Onboarding onDone={refresh} /> : <Shell />}
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
