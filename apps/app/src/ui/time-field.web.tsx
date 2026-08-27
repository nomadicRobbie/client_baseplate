import { createElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './components';

export function TimeField({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (hhmm: string) => void; placeholder?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      {createElement('input', {
        type: 'time',
        value,
        placeholder,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: {
          borderWidth: 1, borderStyle: 'solid' as const, borderColor: t.color.border,
          borderRadius: t.radius.md, padding: t.space.md, fontSize: 16,
          color: t.color.text, backgroundColor: t.color.surface, fontFamily: 'inherit',
        },
      })}
    </View>
  );
}
