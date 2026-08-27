import { useState } from 'react';
import { View, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme';
import { Text } from './components';

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fromHHMM(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export function TimeField({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (hhmm: string) => void; placeholder?: string;
}) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  const date = value ? fromHHMM(value) : new Date();
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <Pressable
        onPress={() => setShow(true)}
        accessibilityRole="button"
        style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md }}
      >
        <Text color={value ? t.color.text : t.color.textMuted}>{value || (placeholder ?? 'Select time')}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={date}
          mode="time"
          onChange={(_e, selected) => { setShow(false); if (selected) onChange(toHHMM(selected)); }}
        />
      )}
    </View>
  );
}
