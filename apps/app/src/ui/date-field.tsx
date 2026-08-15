import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme';
import { Text } from './components';
import { formatDMY } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  container: { gap: 6 },
  input: { borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md },
});

// Native (iOS/Android) date field — a pressable showing the date as dd/mm/yyyy,
// opening the OS date picker. Value in/out is YYYY-MM-DD. Web uses date-field.web.tsx.
function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function DateField({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (iso: string) => void; placeholder?: string;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [show, setShow] = useState(false);
  const date = value ? new Date(value + 'T00:00:00') : new Date();
  return (
    <View style={s.container}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <Pressable onPress={() => setShow(true)} accessibilityRole="button"
        style={s.input}>
        <Text color={value ? t.color.text : t.color.textMuted}>{value ? formatDMY(value) : (placeholder ?? 'Select date')}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={date}
          mode="date"
          onChange={(_e, selected) => { setShow(false); if (selected) onChange(toISO(selected)); }}
        />
      )}
    </View>
  );
}
