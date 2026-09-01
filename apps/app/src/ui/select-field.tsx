import { View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTheme } from '@/theme';
import { Text } from './components';

export interface SelectOption { label: string; value: string }

type ThemeT = ReturnType<typeof useTheme>;

const makeStyles = (t: ThemeT, hasError: boolean) => ({
  root: { gap: t.space.xs },
  pickerWrap: {
    overflow: 'hidden' as const,
  },
  picker: {
    color: t.color.text,
    backgroundColor: t.color.surface,
    height: 48,
    borderWidth: 1,
    borderColor: hasError ? t.color.danger : t.color.border,
    borderRadius: t.radius.md,
    padding: t.space.md,
    fontSize: 14,
  },
  item: { backgroundColor: t.color.surface },
});

export function SelectField({ label, value, onChange, options, placeholder, error }: {
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
}) {
  const t = useTheme();
  const s = makeStyles(t, !!error);
  return (
    <View style={s.root}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <View style={s.pickerWrap}>
        <Picker
          selectedValue={value ?? ''}
          onValueChange={v => onChange(v === '' ? null : v)}
          style={s.picker}
          dropdownIconColor={t.color.textMuted}
          itemStyle={s.picker}
        >
          <Picker.Item
            label={placeholder ?? 'None'}
            value=""
            color={t.color.textMuted}
            style={s.item}
          />
          {options.map(o => (
            <Picker.Item key={o.value} label={o.label} value={o.value} color={t.color.text} style={s.item} />
          ))}
        </Picker>
      </View>
      {error ? <Text variant="small" color={t.color.danger}>{error}</Text> : null}
    </View>
  );
}
