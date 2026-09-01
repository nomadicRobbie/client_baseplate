import { View, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePins } from '@/lib/pins-context';
import { visibleNav } from '@/lib/nav';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel } from '@/ui/components';

export default function Library() {
  const t = useTheme();
  const router = useRouter();
  const { modules, isPinned, toggle } = usePins();
  const { width } = useWindowDimensions();
  const { features, user } = useAuth();
  const wide = width >= 900;
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  const mobileAdminLinks = wide ? [] : visibleNav(isAdmin, features)
    .filter((i) => i.group === 'account' || i.group === 'admin')
    .filter((i) => i.href !== '/dashboard/account');

  return (
    <Screen>
      {modules.length === 0 ? (
        <Text muted>No modules enabled yet.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          <SectionLabel>Modules</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md }}>
            {modules.map((m) => {
              const pinned = isPinned(m.href);
              return (
                <Pressable
                  key={m.href}
                  onPress={() => router.push(m.href)}
                  accessibilityRole="button"
                  style={(state) => {
                    const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                    return {
                      width: wide ? 180 : '48%' as unknown as number,
                      padding: t.space.lg,
                      borderRadius: t.radius.md,
                      borderWidth: 1,
                      borderColor: t.color.border,
                      backgroundColor: pressed ? t.color.surfaceAlt : hovered ? t.color.surface : t.color.surface,
                      gap: t.space.sm,
                    };
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={m.icon} size={18} color={t.color.primary} />
                    </View>
                    {!wide && (
                      <View
                        onStartShouldSetResponder={() => true}
                        onResponderRelease={(e) => { e.stopPropagation(); toggle(m.href); }}
                        accessibilityLabel={pinned ? `Unpin ${m.label}` : `Pin ${m.label}`}
                        hitSlop={8}
                      >
                        <Ionicons name={pinned ? 'star' : 'star-outline'} size={16} color={pinned ? t.color.primary : t.color.textMuted} />
                      </View>
                    )}
                  </View>
                  <Text variant="label">{m.label}</Text>
                  {!!m.description && <Text variant="small" muted>{m.description}</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {mobileAdminLinks.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionLabel>Manage</SectionLabel>
          <GroupedCard>
            {mobileAdminLinks.map((l, i) => (
              <GRow key={l.href} onPress={() => router.push(l.href)} last={i === mobileAdminLinks.length - 1}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={l.icon} size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={{ flex: 1 }}>{l.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
              </GRow>
            ))}
          </GroupedCard>
        </View>
      )}
    </Screen>
  );
}
