import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './components';

export function NumberStepper({ label, value, onChange, min = 0, max = 999, unit }: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={s.root}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <View style={s.row}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          style={({ pressed }) => [s.btn, pressed && s.btnPressed, value <= min && s.btnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Decrease"
        >
          <Ionicons name="remove" size={20} color={value <= min ? t.color.textMuted : t.color.text} />
        </Pressable>
        <View style={s.display}>
          <Text variant="label">{value}{unit ? ` ${unit}` : ''}</Text>
        </View>
        <Pressable
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          style={({ pressed }) => [s.btn, pressed && s.btnPressed, value >= max && s.btnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Increase"
        >
          <Ionicons name="add" size={20} color={value >= max ? t.color.textMuted : t.color.text} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: ReturnType<typeof useTheme>) => StyleSheet.create({
  root: { gap: t.space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  btn: {
    width: 44, height: 44, borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPressed: { opacity: 0.6 },
  btnDisabled: { opacity: 0.35 },
  display: {
    minWidth: 64, height: 44, borderRadius: t.radius.md,
    backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space.md,
  },
});
