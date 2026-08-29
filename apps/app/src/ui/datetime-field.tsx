import { useState } from 'react';
import { View, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme';
import { Text } from './components';

function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DateTimeField({ label, value, onChange, error }: {
  label?: string; value: string; onChange: (iso: string) => void; error?: string;
}) {
  const t = useTheme();
  const [show, setShow] = useState(false);
  const date = value ? new Date(value) : new Date();
  const display = value ? new Date(value).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Select date & time';
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <Pressable
        onPress={() => setShow(true)}
        accessibilityRole="button"
        style={{ borderWidth: 1, borderColor: error ? t.color.danger : t.color.border, borderRadius: t.radius.md, padding: t.space.md }}
      >
        <Text color={value ? t.color.text : t.color.textMuted}>{display}</Text>
      </Pressable>
      {error ? <Text variant="small" color={t.color.danger}>{error}</Text> : null}
      {show && (
        <DateTimePicker
          value={date}
          mode="datetime"
          onChange={(_e, selected) => { setShow(false); if (selected) onChange(toLocalISO(selected)); }}
        />
      )}
    </View>
  );
}
