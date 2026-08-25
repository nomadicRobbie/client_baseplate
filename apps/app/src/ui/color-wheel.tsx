import { View, PanResponder } from 'react-native';
import { useMemo, useRef } from 'react';

// Native color wheel — pixel grid of Views clipped to a circle.
// ponytail: 8px cells (~729 views); swap to react-native-svg if smoother rendering is needed.

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

const SIZE = 216;
const CELL = 8;
const COLS = SIZE / CELL;
const R = SIZE / 2;

export function ColorWheel({ h, s, v, onChange }: ColorWheelProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const cells = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < COLS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cx = col * CELL + CELL / 2;
        const cy = row * CELL + CELL / 2;
        const dx = cx - R, dy = cy - R;
        const dist = Math.sqrt(dx * dx + dy * dy);
        out.push(hsv2hex(
          (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360,
          Math.min(1, dist / R),
          v,
        ));
      }
    }
    return out;
  }, [v]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: ({ nativeEvent: { locationX: lx, locationY: ly } }) => {
      const dx = lx - R, dy = ly - R;
      const dist = Math.sqrt(dx * dx + dy * dy);
      onChangeRef.current((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, dist / R));
    },
    onPanResponderMove: ({ nativeEvent: { locationX: lx, locationY: ly } }) => {
      const dx = lx - R, dy = ly - R;
      const dist = Math.sqrt(dx * dx + dy * dy);
      onChangeRef.current((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, dist / R));
    },
  }), []);

  const hRad = (h * Math.PI) / 180;
  const kx = R + s * R * Math.cos(hRad);
  const ky = R - s * R * Math.sin(hRad);

  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', width: SIZE, height: SIZE, borderRadius: R, overflow: 'hidden' }}
        pointerEvents="none"
      >
        {cells.map((color, i) => (
          <View key={i} style={{ width: CELL, height: CELL, backgroundColor: color }} />
        ))}
      </View>
      <View
        style={{ position: 'absolute', top: 0, left: 0, width: SIZE, height: SIZE, borderRadius: R }}
        {...pan.panHandlers}
      />
      <View style={{
        position: 'absolute',
        left: kx - 10, top: ky - 10,
        width: 20, height: 20, borderRadius: 10,
        backgroundColor: hsv2hex(h, s, v),
        borderWidth: 2, borderColor: '#fff',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.5, shadowRadius: 3, elevation: 4,
      }} />
    </View>
  );
}
