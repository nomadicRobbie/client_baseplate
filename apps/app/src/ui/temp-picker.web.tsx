import { createElement } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './components';

const INT_ITEMS = Array.from({ length: 151 }, (_, i) => i - 30);
const DEC_ITEMS = Array.from({ length: 10 }, (_, i) => i);

function makeSelectStyle(t: ReturnType<typeof useTheme>) {
  return {
    flex: 1,
    borderWidth: 1, borderStyle: 'solid' as const, borderColor: t.color.border,
    borderRadius: t.radius.md, padding: t.space.md,
    fontSize: 16, color: t.color.text,
    backgroundColor: t.color.surface, fontFamily: 'inherit',
    cursor: 'pointer',
  };
}

export function TempPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const num = parseFloat(value) || 0;
  const intPart = Math.trunc(num);
  const decPart = Math.round(Math.abs(num - intPart) * 10);

  const setInt = (i: number) =>
    onChange((i >= 0 ? i + decPart / 10 : i - decPart / 10).toFixed(1));
  const setDec = (d: number) =>
    onChange((intPart >= 0 ? intPart + d / 10 : intPart - d / 10).toFixed(1));

  const sel = makeSelectStyle(t);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: t.space.xs }}>
      {createElement('select', {
        value: intPart,
        onChange: (e: { target: { value: string } }) => setInt(parseInt(e.target.value, 10)),
        style: sel,
      }, INT_ITEMS.map((v) => createElement('option', { key: v, value: v }, String(v))))}

      <Text style={{ fontSize: 20, fontWeight: '700', color: t.color.text, paddingHorizontal: 2 }}>.</Text>

      {createElement('select', {
        value: decPart,
        onChange: (e: { target: { value: string } }) => setDec(parseInt(e.target.value, 10)),
        style: { ...sel, flex: 'none' as unknown as number, width: 80 },
      }, DEC_ITEMS.map((v) => createElement('option', { key: v, value: v }, String(v))))}
    </View>
  );
}
