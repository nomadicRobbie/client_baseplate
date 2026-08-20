import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePins } from '@/lib/pins-context';
import { visibleNav } from '@/lib/nav';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Row, Badge } from '@/ui/components';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  header: { gap: 4 },
  moduleRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  moduleButton: { flex: 1 },
  moduleLabel: { flex: 1 },
  pinButton: { padding: t.space.sm, minHeight: 44, justifyContent: 'center' as const },
});

// Library — the dashboard landing. Lists the client's blnk modules and lets
// them star up to two onto the mobile bottom bar (the "two most used").
export default function Library() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { modules, isPinned, toggle } = usePins();
  const { width } = useWindowDimensions();
  const { features, user } = useAuth();
  const wide = width >= 900;
  const isAdmin = user?.role === 'admin' || user?.role === 'super';
  // Admin/account links that have no tab slot on mobile (People, Billing, Settings).
  const mobileAdminLinks = wide ? [] : visibleNav(isAdmin, features)
    .filter((i) => i.group === 'account' || i.group === 'admin')
    .filter((i) => i.href !== '/dashboard/account');

  return (
    <Screen>
      <View style={s.header}>
        <Text variant="title">Library</Text>
        <Text muted>Your blnk modules</Text>
      </View>

      {modules.length === 0 ? (
        <Card><Text muted>No modules enabled yet. Modules turned on for your account appear here.</Text></Card>
      ) : (
        <Card>
          {modules.map((m) => {
            const pinned = isPinned(m.href);
            return (
              <View key={m.href} style={s.moduleRow}>
                <Row onPress={() => router.push(m.href)} style={s.moduleButton}>
                  <Ionicons name={m.icon} size={20} color={t.color.text} />
                  <Text variant="label" style={s.moduleLabel}>{m.label}</Text>
                  {pinned && !wide && (
                    <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 99, backgroundColor: t.color.primary }}>
                      <Text variant="small" color={t.color.primaryText}>Pinned</Text>
                    </View>
                  )}
                </Row>
                <Pressable
                  onPress={() => toggle(m.href)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: pinned }}
                  accessibilityLabel={pinned ? `Remove ${m.label} from bottom bar` : `Pin ${m.label} to bottom bar`}
                  hitSlop={8}
                  style={s.pinButton}
                >
                  <Ionicons name={pinned ? 'star' : 'star-outline'} size={22} color={pinned ? t.color.primary : t.color.textMuted} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}


      {mobileAdminLinks.length > 0 && (
        <Card>
          <Text variant="heading">Manage</Text>
          {mobileAdminLinks.map((l) => (
            <Row key={l.href} onPress={() => router.push(l.href)}>
              <Ionicons name={l.icon} size={20} color={t.color.text} />
              <Text variant="label" style={s.moduleLabel}>{l.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
            </Row>
          ))}
        </Card>
      )}
    </Screen>
  );
}
