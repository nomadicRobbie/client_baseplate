import { View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTheme } from '@/theme';
import { Text } from './components';

export interface SelectOption { label: string; value: string }

export function SelectField({ label, value, onChange, options, placeholder, error }: {
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <View style={{
        borderWidth: 1,
        borderColor: error ? t.color.danger : t.color.border,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.color.surface,
      }}>
        <Picker
          selectedValue={value ?? ''}
          onValueChange={v => onChange(v === '' ? null : v)}
          style={{ color: t.color.text }}
          dropdownIconColor={t.color.textMuted}
        >
          <Picker.Item
            label={placeholder ?? 'None'}
            value=""
            color={t.color.textMuted}
          />
          {options.map(o => (
            <Picker.Item key={o.value} label={o.label} value={o.value} />
          ))}
        </Picker>
      </View>
      {error ? <Text variant="small" color={t.color.danger}>{error}</Text> : null}
    </View>
  );
}
