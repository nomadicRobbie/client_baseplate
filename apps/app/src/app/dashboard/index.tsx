import { View, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePins } from '@/lib/pins-context';
import { useTheme } from '@/theme';
import { Screen, Text, SectionLabel } from '@/ui/components';

export default function Library() {
  const t = useTheme();
  const router = useRouter();
  const { modules, isPinned, toggle } = usePins();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

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

    </Screen>
  );
}
