import { View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTheme } from '@/theme';
import { Text } from './components';

const INT_ITEMS = Array.from({ length: 151 }, (_, i) => i - 30);
const DEC_ITEMS = Array.from({ length: 10 }, (_, i) => i);

export function TempPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const num = parseFloat(value) || 0;
  const intPart = Math.trunc(num);
  const decPart = Math.round(Math.abs(num - intPart) * 10);

  const setInt = (i: number) =>
    onChange((i >= 0 ? i + decPart / 10 : i - decPart / 10).toFixed(1));
  const setDec = (d: number) =>
    onChange((intPart >= 0 ? intPart + d / 10 : intPart - d / 10).toFixed(1));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <Picker selectedValue={intPart} onValueChange={setInt} style={{ flex: 1, color: t.color.text }}>
        {INT_ITEMS.map((v) => <Picker.Item key={v} label={String(v)} value={v} />)}
      </Picker>
      <Text style={{ fontSize: 22, fontWeight: '700', color: t.color.text }}>.</Text>
      <Picker selectedValue={decPart} onValueChange={setDec} style={{ flex: 1, color: t.color.text }}>
        {DEC_ITEMS.map((v) => <Picker.Item key={v} label={String(v)} value={v} />)}
      </Picker>
    </View>
  );
}
