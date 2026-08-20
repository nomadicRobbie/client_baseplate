import { View, Pressable } from 'react-native';
import type { VesselFieldDef } from '@blnk/shared';
import { useTheme } from '@/theme';
import { Text, TextField } from './components';
import { DateField } from './date-field';

type ThemeT = ReturnType<typeof useTheme>;

const makeStyles = (t: ThemeT) => ({
  container: { gap: t.space.md },
  selectField: { gap: t.space.xs },
  optionRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  option: (sel: boolean) => ({
    paddingVertical: t.space.xs, paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill, borderWidth: 1,
    borderColor: sel ? t.color.primary : t.color.border,
    backgroundColor: sel ? t.color.primary : 'transparent',
  }),
});

// Renders a schema-driven form for a single asset's particulars.
// `fields` comes from VesselAssetType.fields; `value` / `onChange` are controlled.
export function ParticularsForm({
  fields,
  value,
  onChange,
}: {
  fields: VesselFieldDef[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  if (!fields.length) return null;

  const set = (key: string, v: string) => onChange({ ...value, [key]: v });

  return (
    <View style={s.container}>
      {fields.map((f) => {
        const v = value[f.key] ?? '';
        const label = f.unit ? `${f.label} (${f.unit})` : f.label;

        if (f.type === 'date') {
          return (
            <DateField key={f.key} label={label} value={v} onChange={(iso) => set(f.key, iso)} placeholder={f.placeholder} />
          );
        }

        if (f.type === 'select' && f.options?.length) {
          return (
            <View key={f.key} style={s.selectField}>
              <Text variant="label" muted>{label}</Text>
              <View style={s.optionRow}>
                {f.options.map((opt) => {
                  const sel = v === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => set(f.key, opt)}
                      accessibilityRole="button"
                      style={s.option(sel)}
                    >
                      <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        }

        return (
          <TextField
            key={f.key}
            label={label}
            value={v}
            onChangeText={(s) => set(f.key, s)}
            placeholder={f.placeholder}
            keyboardType={f.type === 'number' ? 'number-pad' : 'default'}
            autoCapitalize="sentences"
          />
        );
      })}
    </View>
  );
}
