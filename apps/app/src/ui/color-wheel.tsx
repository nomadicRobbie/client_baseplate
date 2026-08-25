import { View, Pressable } from 'react-native';

// Native fallback: a grid of hue/saturation swatches.
// The canvas-based wheel lives in color-wheel.web.tsx.

export type ColorWheelProps = {
  h: number; s: number; v: number;
  onChange: (h: number, s: number) => void;
};

function hsv2hex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}

const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const SATS = [1, 0.65, 0.35, 0.1];

export function ColorWheel({ h, s, v, onChange }: ColorWheelProps) {
  return (
    <View style={{ width: '100%', gap: 5 }}>
      {SATS.map((sat) => (
        <View key={sat} style={{ flexDirection: 'row', gap: 5 }}>
          {HUES.map((hue) => {
            const color = hsv2hex(hue, sat, v);
            const selected = Math.abs(((h - hue + 540) % 360) - 180) < 20 && Math.abs(s - sat) < 0.2;
            return (
              <Pressable
                key={hue}
                onPress={() => onChange(hue, sat)}
                accessibilityRole="button"
                accessibilityLabel={color}
                style={{
                  flex: 1, aspectRatio: 1, borderRadius: 6, backgroundColor: color,
                  borderWidth: selected ? 3 : 0, borderColor: '#fff',
                  shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.3, shadowRadius: 2, elevation: 2,
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
