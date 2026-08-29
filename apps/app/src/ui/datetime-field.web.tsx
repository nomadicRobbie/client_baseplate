import { createElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './components';

export function DateTimeField({ label, value, onChange, error }: {
  label?: string; value: string; onChange: (iso: string) => void; error?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      {createElement('input', {
        type: 'datetime-local',
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: {
          borderWidth: 1, borderStyle: 'solid' as const,
          borderColor: error ? t.color.danger : t.color.border,
          borderRadius: t.radius.md, padding: t.space.md, fontSize: 16,
          color: t.color.text, backgroundColor: t.color.surface, fontFamily: 'inherit',
          width: '100%', boxSizing: 'border-box' as const,
        },
      })}
      {error ? <Text variant="small" color={t.color.danger}>{error}</Text> : null}
    </View>
  );
}
