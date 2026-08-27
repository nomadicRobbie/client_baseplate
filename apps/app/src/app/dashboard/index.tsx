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
          <GroupedCard>
            {modules.map((m, i) => {
              const pinned = isPinned(m.href);
              const last = i === modules.length - 1 && mobileAdminLinks.length === 0;
              // Split nav tap and pin tap into siblings — nested Pressables are invalid HTML on web.
              return (
                <View key={m.href} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: last ? 0 : 1, borderColor: t.color.border }}>
                  <Pressable
                    onPress={() => router.push(m.href)}
                    accessibilityRole="button"
                    style={(state) => {
                      const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                      return {
                        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
                        minHeight: 56, paddingLeft: 16, paddingVertical: 10,
                        backgroundColor: pressed || hovered ? t.color.surfaceAlt : 'transparent',
                      };
                    }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={m.icon} size={18} color={t.color.text} />
                    </View>
                    <Text variant="label" style={{ flex: 1 }}>{m.label}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggle(m.href)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: pinned }}
                    accessibilityLabel={pinned ? `Remove ${m.label} from bottom bar` : `Pin ${m.label} to bottom bar`}
                    hitSlop={8}
                    style={{ paddingHorizontal: 16, paddingVertical: 18 }}
                  >
                    <Ionicons name={pinned ? 'star' : 'star-outline'} size={20} color={pinned ? t.color.primary : t.color.textMuted} />
                  </Pressable>
                </View>
              );
            })}
          </GroupedCard>
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
