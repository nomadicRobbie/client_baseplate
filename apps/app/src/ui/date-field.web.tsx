import { createElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './components';

// Web date input — the browser's native date picker. The VALUE is always
// YYYY-MM-DD; the DISPLAYED format follows the browser locale (dd/mm/yyyy on
// en-NZ). Native (iOS/Android) uses date-field.tsx with a forced dd/mm/yyyy label.
export function DateField({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (iso: string) => void; placeholder?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      {createElement('input', {
        type: 'date',
        value,
        placeholder,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: {
          borderWidth: 1, borderStyle: 'solid', borderColor: t.color.border,
          borderRadius: t.radius.md, padding: t.space.md, fontSize: 16,
          color: t.color.text, backgroundColor: t.color.surface, fontFamily: 'inherit',
        },
      })}
    </View>
  );
}
