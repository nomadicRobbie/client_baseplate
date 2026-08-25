import ColorPicker, { Panel5 } from 'reanimated-color-picker';

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

function hex2hs(hex: string): { h: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: mx ? d / mx : 0 };
}

const SIZE = 216;

export function ColorWheel({ h, s, v, onChange }: ColorWheelProps) {
  return (
    <ColorPicker
      value={hsv2hex(h, s, v)}
      thumbAnimationDuration={0}
      thumbSize={24}
      adaptSpectrum
      onChangeJS={(colors) => {
        const { h: nh, s: ns } = hex2hs(colors.hex);
        onChange(nh, ns);
      }}
    >
      <Panel5 style={{ width: SIZE, height: SIZE }} />
    </ColorPicker>
  );
}
