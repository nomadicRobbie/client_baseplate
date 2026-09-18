import { View, Pressable, TextInput } from 'react-native';
import { Text, Pill } from '@/ui/components';
import { useTheme } from '@/theme';
import type { AnnouncementStyle } from '@/lib/api';

export type ToastMsg = { text: string; tone: 'success' | 'error' | 'info' };
export type Tab = 'events' | 'banners' | 'announcements' | 'info';

export const FALLBACK_PAGES = ['/', '/store', '/contact'];

export function toPageOptions(paths: string[]): { path: string; label: string }[] {
  const LABELS: Record<string, string> = {
    '/': 'Home', '/store': 'Store', '/about': 'About', '/contact': 'Contact',
    '/menu': 'Menu', '/events': 'Events', '/products': 'Products',
  };
  return [
    { path: '*', label: 'All pages' },
    ...paths.map(p => ({ path: p, label: LABELS[p] ?? p })),
  ];
}

export const BG_TOKENS: { token: string; label: string; fallback: string }[] = [
  { token: 'primary',    label: 'Primary',     fallback: '#2a7f62' },
  { token: 'accent',     label: 'Accent',      fallback: '#e8613a' },
  { token: 'surface',    label: 'Surface',     fallback: '#ffffff' },
  { token: 'surfaceAlt', label: 'Alt surface', fallback: '#efe8db' },
];

export const TEXT_TOKENS: { token: string; label: string }[] = [
  { token: 'primaryText', label: 'Primary text' },
  { token: 'text',        label: 'Body text' },
  { token: 'textMuted',   label: 'Muted text' },
];

export const FONT_TOKENS: { token: string; label: string }[] = [
  { token: 'heading', label: 'Heading' },
  { token: 'body',    label: 'Body' },
];

export const OPACITY_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: 'None' },
  { value: 0.2, label: 'Light' },
  { value: 0.5, label: 'Medium' },
  { value: 0.7, label: 'Strong' },
];

export const LAYOUTS: { value: AnnouncementStyle['layout']; label: string }[] = [
  { value: 'centered',    label: 'Centered' },
  { value: 'split-left',  label: 'Image left' },
  { value: 'split-right', label: 'Image right' },
];

export const MODAL_SIZES: { value: AnnouncementStyle['modal_size']; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

export function makeStyles(t: ReturnType<typeof useTheme>) {
  return {
    tabRow:        { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, marginBottom: t.space.sm },
    itemRow:       { flex: 1, gap: 2 },
    rowActions:    { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
    iconBtn:       (busy: boolean) => ({ padding: t.space.sm, opacity: busy ? 0.4 : 1 }),
    input: {
      backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14,
    },
    inputMulti: {
      backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14,
      minHeight: 72, textAlignVertical: 'top' as const,
    },
    switchRow:     { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, minHeight: 44 },
    badge:         (published: boolean) => ({ alignSelf: 'flex-start' as const, backgroundColor: published ? t.color.successMuted : t.color.surfaceAlt, borderRadius: t.radius.pill, paddingVertical: 2, paddingHorizontal: t.space.sm }),
    swatchRow:     { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
    swatch:        (color: string, selected: boolean) => ({ width: 36, height: 36, borderRadius: t.radius.md, backgroundColor: color, borderWidth: selected ? 3 : 1, borderColor: selected ? t.color.text : t.color.border }),
    pillRow:       { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
    sectionDivider: { borderTopWidth: 1, borderTopColor: t.color.border, marginTop: t.space.md, paddingTop: t.space.md },
    layoutRow:     { flexDirection: 'row' as const, gap: t.space.sm },
    layoutCard:    (selected: boolean) => ({ borderRadius: t.radius.md, borderWidth: selected ? 2 : 1, borderColor: selected ? t.color.primary : t.color.border, backgroundColor: t.color.surface, overflow: 'hidden' as const, alignItems: 'center' as const, paddingBottom: t.space.sm }),
    layoutLabel:   { marginTop: t.space.xs },
    btnRow:        { flexDirection: 'row' as const, gap: t.space.sm },
    btnFlex:       { flex: 1 },
    ctaStack:      { gap: t.space.sm },
    ctaOtherLabel: { marginTop: t.space.xs },
    imageSlot:     { width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' as const, backgroundColor: t.color.surfaceAlt },
    imageThumb:    { width: 80, height: 80 },
    imageOverlay:  { ...({ position: 'absolute' as const, inset: 0 }), backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' as const, justifyContent: 'center' as const },
    imageAdd:      { width: 80, height: 80, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, borderStyle: 'dashed' as const, alignItems: 'center' as const, justifyContent: 'center' as const },
  };
}

export function resolveToken(
  token: string,
  org: { brand_color: string | null; accent_color: string | null } | null | undefined,
  fallback: string,
): string {
  if (token === 'primary' && org?.brand_color) return org.brand_color;
  if (token === 'accent'  && org?.accent_color) return org.accent_color;
  return fallback;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ── Shared components ─────────────────────────────────────────────────────────

export function ColorSwatchPicker({
  options, selected, onSelect, org,
}: {
  options: { token: string; label: string; fallback: string }[];
  selected: string;
  onSelect: (token: string) => void;
  org: { brand_color: string | null; accent_color: string | null } | null | undefined;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={s.swatchRow}>
      {options.map((opt) => {
        const hex = resolveToken(opt.token, org, opt.fallback);
        return (
          <Pressable key={opt.token} onPress={() => onSelect(opt.token)}
            accessibilityRole="button" accessibilityLabel={opt.label}
            accessibilityState={{ selected: selected === opt.token }}
            style={s.swatch(hex, selected === opt.token)} />
        );
      })}
    </View>
  );
}

export function LayoutThumb({ layout }: { layout: AnnouncementStyle['layout'] }) {
  if (layout === 'centered') {
    return (
      <svg viewBox="0 0 80 60" width={80} height={60} xmlns="http://www.w3.org/2000/svg">
        <rect width={80} height={60} fill="#f5f0e8" />
        <rect x={10} y={8}  width={60} height={8}  rx={2} fill="#2a7f62" opacity={0.7} />
        <rect x={16} y={20} width={48} height={4}  rx={1} fill="#0e0e0e" opacity={0.3} />
        <rect x={16} y={27} width={48} height={4}  rx={1} fill="#0e0e0e" opacity={0.3} />
        <rect x={16} y={34} width={48} height={4}  rx={1} fill="#0e0e0e" opacity={0.3} />
        <rect x={24} y={44} width={32} height={10} rx={3} fill="#2a7f62" />
      </svg>
    );
  }
  if (layout === 'split-left') {
    return (
      <svg viewBox="0 0 80 60" width={80} height={60} xmlns="http://www.w3.org/2000/svg">
        <rect width={80} height={60} fill="#f5f0e8" />
        <rect x={0}  y={0}  width={32} height={60} fill="#2a7f62" opacity={0.18} />
        <rect x={4}  y={16} width={24} height={28} rx={2} fill="#2a7f62" opacity={0.4} />
        <rect x={38} y={8}  width={36} height={6}  rx={1} fill="#0e0e0e" opacity={0.5} />
        <rect x={38} y={18} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
        <rect x={38} y={25} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
        <rect x={38} y={32} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
        <rect x={38} y={44} width={28} height={10} rx={3} fill="#2a7f62" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 60" width={80} height={60} xmlns="http://www.w3.org/2000/svg">
      <rect width={80} height={60} fill="#f5f0e8" />
      <rect x={48} y={0}  width={32} height={60} fill="#2a7f62" opacity={0.18} />
      <rect x={52} y={16} width={24} height={28} rx={2} fill="#2a7f62" opacity={0.4} />
      <rect x={6}  y={8}  width={36} height={6}  rx={1} fill="#0e0e0e" opacity={0.5} />
      <rect x={6}  y={18} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
      <rect x={6}  y={25} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
      <rect x={6}  y={32} width={36} height={4}  rx={1} fill="#0e0e0e" opacity={0.25} />
      <rect x={6}  y={44} width={28} height={10} rx={3} fill="#2a7f62" />
    </svg>
  );
}

export function SizeThumb({ size }: { size: AnnouncementStyle['modal_size'] }) {
  const W = 80, H = 60;
  const mw = size === 'sm' ? 38 : size === 'md' ? 52 : 70;
  const mh = size === 'sm' ? 24 : size === 'md' ? 34 : 46;
  const mx = (W - mw) / 2;
  const my = (H - mh) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} xmlns="http://www.w3.org/2000/svg">
      {/* screen bg */}
      <rect width={W} height={H} fill="#e8e2d9" />
      {/* dimmed overlay */}
      <rect width={W} height={H} fill="rgba(0,0,0,0.35)" />
      {/* modal card */}
      <rect x={mx} y={my} width={mw} height={mh} rx={3} fill="#fff" />
      {/* title bar */}
      <rect x={mx + 6} y={my + 7} width={mw - 20} height={5} rx={1} fill="#2a7f62" opacity={0.8} />
      {/* body lines */}
      <rect x={mx + 6} y={my + 16} width={mw - 12} height={3} rx={1} fill="#0e0e0e" opacity={0.2} />
      <rect x={mx + 6} y={my + 22} width={(mw - 12) * 0.7} height={3} rx={1} fill="#0e0e0e" opacity={0.2} />
      {/* button */}
      <rect x={mx + 6} y={my + mh - 12} width={mw - 40} height={7} rx={2} fill="#2a7f62" opacity={0.7} />
    </svg>
  );
}

export function CtaUrlPicker({
  value, onChange, pages,
}: {
  value: string;
  onChange: (v: string) => void;
  pages: { path: string; label: string }[];
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const ctaPages = pages.filter(p => p.path !== '*');
  const knownPath = ctaPages.find(p => p.path === value)?.path ?? null;
  const otherValue = knownPath ? '' : value;

  return (
    <View style={s.ctaStack}>
      <View style={s.pillRow}>
        {ctaPages.map(p => (
          <Pill key={p.path} label={p.label} size="sm"
            active={knownPath === p.path}
            onPress={() => onChange(knownPath === p.path ? '' : p.path)} />
        ))}
      </View>
      <Text variant="small" muted style={s.ctaOtherLabel}>Or enter a URL</Text>
      <TextInput value={otherValue} onChangeText={onChange} placeholder="https://…"
        autoCapitalize="none" placeholderTextColor={t.color.textMuted} style={s.input} />
    </View>
  );
}
