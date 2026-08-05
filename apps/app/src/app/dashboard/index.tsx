import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePins } from '@/lib/pins-context';
import { MAX_PINS } from '@/lib/nav';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Row, Badge } from '@/ui/components';

// Library — the dashboard landing. Lists the client's blnk modules and lets
// them star up to two onto the mobile bottom bar (the "two most used").
export default function Library() {
  const t = useTheme();
  const router = useRouter();
  const { modules, isPinned, toggle } = usePins();

  return (
    <Screen>
      <View style={{ gap: 4 }}>
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
              <View key={m.href} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Row onPress={() => router.push(m.href)} style={{ flex: 1 }}>
                  <Ionicons name={m.icon} size={20} color={t.color.text} />
                  <Text variant="label" style={{ flex: 1 }}>{m.label}</Text>
                  {pinned && <Badge label="On bar" tone="success" />}
                </Row>
                <Pressable
                  onPress={() => toggle(m.href)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: pinned }}
                  accessibilityLabel={pinned ? `Remove ${m.label} from bottom bar` : `Pin ${m.label} to bottom bar`}
                  hitSlop={8}
                  style={{ padding: t.space.sm, minHeight: 44, justifyContent: 'center' }}
                >
                  <Ionicons name={pinned ? 'star' : 'star-outline'} size={22} color={pinned ? t.color.primary : t.color.textMuted} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      <Card>
        <Text variant="heading">Bottom bar</Text>
        <Text muted>Star up to {MAX_PINS} modules to keep them one tap away on the bottom bar. Starring another replaces the oldest.</Text>
      </Card>
    </Screen>
  );
}
