import { Slot, Redirect, usePathname, useRouter } from 'expo-router';
import { View, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme';
import { Text } from '@/ui/components';

type NavItem = { label: string; href: '/dashboard' | '/dashboard/account'; glyph: string };

const NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', glyph: '◆' },
  { label: 'Account', href: '/dashboard/account', glyph: '●' },
];

function NavList({ vertical }: { vertical: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <View style={{ flexDirection: vertical ? 'column' : 'row', gap: t.space.xs, flex: vertical ? undefined : 1, justifyContent: vertical ? 'flex-start' : 'space-around' }}>
      {NAV.map((item) => {
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
              const bg = active ? t.color.surfaceAlt : pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent';
              return {
                flexDirection: vertical ? 'row' : 'column',
                alignItems: 'center', gap: vertical ? t.space.md : 2,
                paddingVertical: t.space.md, paddingHorizontal: vertical ? t.space.md : t.space.sm,
                borderRadius: t.radius.md,
                backgroundColor: vertical ? bg : active ? t.color.surfaceAlt : 'transparent',
                minHeight: 44,
                flex: vertical ? undefined : 1,
              };
            }}
          >
            <Text color={active ? t.color.primary : t.color.textMuted}>{item.glyph}</Text>
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
  const { user, tenantSlug, loading, signOut } = useAuth();
  const wide = width >= 900;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.bg }}>
        <ActivityIndicator color={t.color.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  // ── Wide (web desktop): persistent left sidebar ──────────────────────────
  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.color.bg }}>
        <View style={{ width: 248, backgroundColor: t.color.surface, borderRightWidth: 1, borderRightColor: t.color.border, padding: t.space.lg, justifyContent: 'space-between' }}>
          <View style={{ gap: t.space.lg }}>
            <View style={{ gap: 2 }}>
              <Text variant="heading">{tenantSlug}</Text>
              <Text variant="small" muted>dashboard</Text>
            </View>
            <NavList vertical />
          </View>
          <View style={{ gap: t.space.sm }}>
            <Text variant="small" muted>{user.role} · {user.type}</Text>
            <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Log out">
              <Text variant="label" color={t.color.accent}>Log out</Text>
            </Pressable>
          </View>
        </View>
        <View style={{ flex: 1 }}><Slot /></View>
      </View>
    );
  }

  // ── Narrow (mobile web / native): bottom tab bar ─────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.color.bg }} edges={['bottom']}>
      <View style={{ flex: 1 }}><Slot /></View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
        <NavList vertical={false} />
      </View>
    </SafeAreaView>
  );
}

export default function DashboardLayout() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
