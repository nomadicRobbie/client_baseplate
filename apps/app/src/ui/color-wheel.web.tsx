import { useRef, useEffect, useCallback, createElement } from 'react';
import type { ColorWheelProps } from './color-wheel';

// Web: pixel-rendered HSV wheel on a <canvas> element.
// The native grid fallback lives in color-wheel.tsx.

const SIZE = 216;
const R = SIZE / 2;

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function hsv2hex(h: number, s: number, v: number): string {
  const [r, g, b] = hsv2rgb(h, s, v);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

export function ColorWheel({ h, s, v, onChange }: ColorWheelProps) {
  const canvasRef = useRef<any>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const dx = px - R, dy = py - R;
        const dist = Math.hypot(dx, dy) / R;
        const i = (py * SIZE + px) * 4;
        if (dist > 1) { data[i + 3] = 0; continue; }
        const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 90 + 360) % 360;
        const [r_, g_, b_] = hsv2rgb(hue, dist, v);
        data[i] = r_; data[i + 1] = g_; data[i + 2] = b_; data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [v]);

  useEffect(() => { draw(); }, [draw]);

  const pick = (clientX: number, clientY: number, rect: { left: number; top: number }) => {
    const dx = clientX - rect.left - R;
    const dy = clientY - rect.top - R;
    const sat = Math.min(1, Math.hypot(dx, dy) / R);
    const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 90 + 360) % 360;
    onChange(hue, sat);
  };

  const onPointerDown = (e: any) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };
  const onPointerMove = (e: any) => {
    if (e.buttons !== 1) return;
    pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  const angle = (h - 90) * Math.PI / 180;
  const kx = 50 + Math.cos(angle) * s * 50;
  const ky = 50 + Math.sin(angle) * s * 50;
  const currentColor = hsv2hex(h, s, v);

  return createElement('div', { style: { position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 } },
    createElement('canvas', {
      ref: canvasRef,
      width: SIZE,
      height: SIZE,
      style: { borderRadius: '50%', cursor: 'crosshair', display: 'block', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' },
      onPointerDown,
      onPointerMove,
    }),
    createElement('div', {
      style: {
        position: 'absolute', width: 24, height: 24, borderRadius: '50%',
        boxSizing: 'border-box', pointerEvents: 'none',
        border: '3px solid #fff', boxShadow: '0 1px 6px rgba(0,0,0,0.5)',
        background: currentColor,
        left: `calc(${kx}% - 12px)`, top: `calc(${ky}% - 12px)`,
        transition: 'left 0.05s, top 0.05s',
      },
    }),
  );
}
