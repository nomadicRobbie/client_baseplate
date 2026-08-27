import { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, TextInput, Modal, Animated, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateOrg } from '@/lib/api';
import { useTheme, useColorSchemePref } from '@/theme';
import { lightColor, darkColor } from '@/theme/tokens';
import { Text, GroupedCard, GRow, SectionLabel } from '@/ui/components';
import { ColorWheel } from '@/ui/color-wheel';

// ── HSV helpers ───────────────────────────────────────────────────────────────
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hsv2hex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}

function hex2hsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: mx ? d / mx : 0, v: mx };
}

function blendHex(from: string, to: string, t: number): string {
  const fn = parseInt(from.slice(1), 16), tn = parseInt(to.slice(1), 16);
  const lerp = (a: number, b: number) => Math.round(a * (1 - t) + b * t);
  const r = lerp((fn >> 16) & 255, (tn >> 16) & 255);
  const g = lerp((fn >> 8) & 255, (tn >> 8) & 255);
  const bl = lerp(fn & 255, tn & 255);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + bl.toString(16).padStart(2, '0');
}

function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.179 ? '#0e0e0e' : '#ffffff';
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'primary' | 'accent' | 'bgColor' | 'surfaceColor';
type Colors = { primary: string | null; accent: string | null; bgColor: string | null; surfaceColor: string | null };

const TABS: { key: Tab; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'bgColor', label: 'Background' },
  { key: 'surfaceColor', label: 'Ink' },
];

// ── Mini preview ──────────────────────────────────────────────────────────────
type PT = { bg: string; surface: string; text: string; textMuted: string; border: string; primary: string; accent: string };

// makePTStyles: all values derived from the PT token — dynamic per preview colour state
const makePTStyles = (pt: PT) => ({
  card: { backgroundColor: pt.surface, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: pt.border, overflow: 'hidden' as const },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: pt.bg, alignItems: 'center' as const, justifyContent: 'center' as const },
  textStack: { flex: 1 },
  accentBadge: { backgroundColor: pt.accent + '22', borderWidth: 1, borderColor: pt.accent, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  btnRow: { flexDirection: 'row' as const, gap: 8 },
  primaryBtn: { flex: 1, backgroundColor: pt.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' as const },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: pt.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' as const },
});

function MiniPreview({ pt }: { pt: PT }) {
  const p = makePTStyles(pt);
  return (
    <View style={p.card}>
      <View style={p.headerRow}>
        <View style={p.iconBox}>
          <Ionicons name="document-outline" size={18} color={pt.textMuted} />
        </View>
        <View style={p.textStack}>
          <Text variant="label" color={pt.text}>Quarterly report</Text>
          <Text variant="small" color={pt.textMuted}>Updated 2 minutes ago</Text>
        </View>
        <View style={p.accentBadge}>
          <Text variant="small" color={pt.accent}>Due</Text>
        </View>
      </View>
      <View style={p.btnRow}>
        <View style={p.primaryBtn}>
          <Text variant="label" color={textOn(pt.primary)}>Save</Text>
        </View>
        <View style={p.cancelBtn}>
          <Text variant="label" color={pt.text}>Cancel</Text>
        </View>
      </View>
    </View>
  );
}

// ── Brightness slider ─────────────────────────────────────────────────────────
// Static slider styles — backgroundColor on segments and left on thumb are dynamic (per-frame)
const bs = {
  wrapper: { width: '100%' as const, gap: 6 },
  labelRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  labelText: { fontWeight: '600' as const },
  track: { height: 24, justifyContent: 'center' as const, position: 'relative' as const },
  trackBar: { flexDirection: 'row' as const, borderRadius: 999, overflow: 'hidden' as const, height: 10 },
  segFlex: { flex: 1 },
  thumbBase: { position: 'absolute' as const, top: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.3)' },
  thumbWeb: { boxShadow: '0 1px 4px rgba(0,0,0,0.4)' } as any,
  thumbNative: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },
};

function BrightnessSlider({ value, maxColor, onChange }: { value: number; maxColor: string; onChange: (v: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const SEGMENTS = 12;
  const handleResponder = (locationX: number) => {
    if (trackWidth === 0) return;
    onChange(Math.max(0.04, Math.min(1, locationX / trackWidth)));
  };
  // ponytail: left is genuinely dynamic per touch event — cannot pre-compute in makeStyles
  const thumbLeft = Math.max(0, Math.min(trackWidth - 24, value * trackWidth - 12));
  const thumbShadow = Platform.OS === 'web' ? bs.thumbWeb : bs.thumbNative;
  return (
    <View style={bs.wrapper}>
      <View style={bs.labelRow}>
        <Text variant="small" color="#9a9590" style={bs.labelText}>Brightness</Text>
        <Text variant="small" color="#9a9590" style={bs.labelText}>{Math.round(value * 100)}%</Text>
      </View>
      <View
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        style={bs.track}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => handleResponder(e.nativeEvent.locationX)}
        onResponderMove={(e) => handleResponder(e.nativeEvent.locationX)}
      >
        <View style={bs.trackBar}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            // ponytail: backgroundColor is per-segment computed gradient — cannot pre-compute
            <View key={i} style={[bs.segFlex, { backgroundColor: blendHex('#000000', maxColor, (i + 0.5) / SEGMENTS) }]} />
          ))}
        </View>
        {trackWidth > 0 && (
          // ponytail: left is dynamic per touch — cannot pre-compute
          <View style={[bs.thumbBase, thumbShadow, { left: thumbLeft }]} />
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
type ThemeT = ReturnType<typeof useTheme>;

// Page-level styles
const makeStyles = (t: ThemeT) => ({
  root: { flex: 1, backgroundColor: t.color.bg },
  inner: { flex: 1 },
  scrollContent: { flexGrow: 1, width: '100%' as const, padding: 20, gap: 20, paddingBottom: 20 },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  section: { gap: 8 },
  flex1: { flex: 1 },
  swatchRow: { fontFamily: 'monospace', fontSize: 13 },
  swatch: (hex: string) => ({ width: 32, height: 32, borderRadius: 8, backgroundColor: hex, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }),
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBar: (bottomInset: number) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + bottomInset, backgroundColor: t.color.surface, borderTopWidth: 1, borderTopColor: t.color.border }),
  discardBtn: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center' as const },
  saveBtn: (busy: boolean) => ({ minHeight: 40, paddingHorizontal: 18, justifyContent: 'center' as const, backgroundColor: t.color.success, borderRadius: 10, opacity: busy ? 0.5 : 1 }),
  toastView: { position: 'absolute' as const, right: 16, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: t.color.successMuted, borderWidth: 1, borderColor: t.color.success, borderRadius: 10, padding: 12, pointerEvents: 'none' as any },
});

// Mobile bottom-sheet styles — slide up from bottom, scrollable content
const makeMobileSheet = (t: ThemeT, bottomInset: number) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropClose: { flex: 1 },
  // No fixed height — content determines size; maxHeight caps it at 75% of screen
  sheet: { backgroundColor: t.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' as const, maxHeight: '75%' as any },
  handle: { alignItems: 'center' as const, paddingTop: 12, paddingBottom: 4 },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.color.border },
  scrollContent: { padding: 20, paddingTop: 8, gap: 16, paddingBottom: bottomInset + 24 },
});

// Web dialog styles — fade in centred, standard modal
const makeWebDialog = (t: ThemeT) => ({
  backdrop: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(0,0,0,0.5)' },
  // Absolute fill so pressing outside the dialog closes it without stealing layout space
  backdropClose: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
  dialog: { backgroundColor: t.color.surface, borderRadius: 16, overflow: 'hidden' as const, width: '90%' as any, maxWidth: 440 },
  scrollContent: { padding: 24, gap: 16 },
});

// Shared picker content styles (used inside both mobile sheet and web dialog)
const makePickerStyles = (t: ThemeT) => ({
  header: { flexDirection: 'row' as const, alignItems: 'center' as const },
  flex1: { flex: 1 },
  wheelWrapper: { alignItems: 'center' as const },
  hexRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 52, paddingHorizontal: 12, backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: 12 },
  hexSwatch: (hex: string) => ({ width: 30, height: 30, borderRadius: 8, backgroundColor: hex, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', flexShrink: 0 as const }),
  hexMono: { flex: 1, fontSize: 15 },
  hexInputRow: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
  hexInput: (err: boolean, t2: ThemeT) => ({ flex: 1, backgroundColor: t2.color.surface, borderWidth: 1, borderColor: err ? t2.color.danger : t2.color.border, borderRadius: 10, padding: 12, minHeight: 44, fontSize: 16, color: t2.color.text, fontFamily: t2.font.mono }),
  hexApplyBtn: { paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' as const, alignItems: 'center' as const, backgroundColor: t.color.surfaceAlt, borderRadius: 10 },
});

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Theme() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { pref } = useColorSchemePref();
  const { data, refresh } = useProfile();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';
  const orgName = data?.org?.org_name ?? 'your organisation';

  // Use the user's chosen scheme for the preview; fall back to system via Appearance
  const { Appearance } = require('react-native');
  const systemScheme = Appearance.getColorScheme?.() ?? 'light';
  const previewScheme = pref === 'os' ? systemScheme : pref;
  const base = previewScheme === 'dark' ? darkColor : lightColor;

  const isWeb = Platform.OS === 'web';
  // Fixed wheel sizes — no computation; ScrollView inside the modal handles any overflow
  const wheelSize = isWeb ? 220 : 180;

  const defaultForTab: Record<Tab, string> = {
    primary: base.primary, accent: base.accent, bgColor: base.bg, surfaceColor: base.surface,
  };

  const savedColorsRef = useRef<Colors>({
    primary: data?.org?.brand_color ?? null,
    accent: data?.org?.accent_color ?? null,
    bgColor: data?.org?.custom_colors?.bg ?? null,
    surfaceColor: data?.org?.custom_colors?.surface ?? null,
  });

  const [colors, setColors] = useState<Colors>(savedColorsRef.current);
  const [editingTab, setEditingTab] = useState<Tab | null>(null);
  const [hexOpen, setHexOpen] = useState(false);
  const [hexInput, setHexInput] = useState('');
  const [hexErr, setHexErr] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentHex = editingTab ? (colors[editingTab] ?? defaultForTab[editingTab]) : base.primary;
  const [hsv, setHsv] = useState(() => hex2hsv(currentHex));

  // Sync HSV when a different colour row is opened
  useEffect(() => {
    if (!editingTab) { setHexOpen(false); setHexInput(''); setHexErr(false); return; }
    setHsv(hex2hsv(colors[editingTab] ?? defaultForTab[editingTab]));
    setHexOpen(false); setHexInput(''); setHexErr(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTab]);

  const pt: PT = {
    bg: colors.bgColor ?? base.bg,
    surface: colors.surfaceColor ?? base.surface,
    text: base.text,
    textMuted: base.textMuted,
    border: base.border,
    primary: colors.primary ?? base.primary,
    accent: colors.accent ?? base.accent,
  };

  // Toast
  const toastAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!saved) return;
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2400),
      Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
    ]).start(() => setSaved(false));
  }, [saved, toastAnim]);

  const s = makeStyles(t);
  const ms = makeMobileSheet(t, insets.bottom);
  const wd = makeWebDialog(t);
  const pc = makePickerStyles(t);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const setColor = (hex: string) => {
    if (!editingTab) return;
    setColors((c) => ({ ...c, [editingTab]: hex }));
    setHsv(hex2hsv(hex));
    setDirty(true);
  };

  const onWheelChange = (h: number, s: number) => {
    const v = hsv.v;
    setHsv({ h, s, v });
    setColor(hsv2hex(h, s, v));
  };

  const onBrightness = (v: number) => {
    const { h, s } = hsv;
    setHsv((prev) => ({ ...prev, v }));
    setColor(hsv2hex(h, s, v));
  };

  const applyHex = () => {
    const h = hexInput.trim().startsWith('#') ? hexInput.trim() : `#${hexInput.trim()}`;
    if (HEX_RE.test(h)) { setColor(h); setHexInput(''); setHexErr(false); setHexOpen(false); }
    else setHexErr(true);
  };

  const reset = () => {
    setColors({ primary: null, accent: null, bgColor: null, surfaceColor: null });
    setDirty(true);
    setEditingTab(null);
  };

  const discard = () => {
    setColors(savedColorsRef.current);
    setDirty(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const custom_colors: Record<string, string> = {};
      if (colors.bgColor) custom_colors.bg = colors.bgColor;
      if (colors.surfaceColor) custom_colors.surface = colors.surfaceColor;
      await updateOrg(getAccessToken()!, {
        brand_color: colors.primary ?? undefined,
        accent_color: colors.accent ?? undefined,
        custom_colors,
      });
      savedColorsRef.current = { ...colors };
      await refresh();
      setDirty(false);
      setSaved(true);
    } catch (e) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const maxColor = editingTab ? hsv2hex(hsv.h, hsv.s, 1) : base.primary;
  const activeLabel = TABS.find((tb) => tb.key === editingTab)?.label ?? '';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={s.root}>
      <View style={s.inner}>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scrollContent}>
          {/* Back */}
          {!wide && (
            <Pressable onPress={() => router.back()} accessibilityRole="button" style={s.backBtn}>
              <Ionicons name="chevron-back" size={18} color={t.color.primary} />
              <Text variant="label" color={t.color.primary}>Account</Text>
            </Pressable>
          )}

          {/* Preview */}
          <View style={s.section}>
            <SectionLabel>Preview</SectionLabel>
            <MiniPreview pt={pt} />
          </View>

          {/* Brand colours */}
          <View style={s.section}>
            <SectionLabel>Brand colours</SectionLabel>
            <GroupedCard>
              {TABS.map(({ key, label }, i) => {
                const hex = colors[key] ?? defaultForTab[key];
                return (
                  <GRow key={key} last={i === TABS.length - 1} onPress={() => setEditingTab(key)}>
                    <Text variant="label" style={s.flex1}>{label}</Text>
                    <Text variant="body" muted style={s.swatchRow}>{hex.toUpperCase()}</Text>
                    <View style={s.swatch(hex)} />
                    <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
                  </GRow>
                );
              })}
            </GroupedCard>
          </View>

          {/* Manage */}
          <View style={s.section}>
            <SectionLabel>Manage</SectionLabel>
            <GroupedCard>
              <GRow last onPress={reset}>
                <View style={s.iconBox}>
                  <Ionicons name="refresh-outline" size={18} color={t.color.text} />
                </View>
                <Text variant="label" style={s.flex1}>Reset to blnk default</Text>
                <Ionicons name="chevron-forward" size={16} color={t.color.textMuted} />
              </GRow>
            </GroupedCard>
          </View>
        </ScrollView>

        {/* Save bar */}
        {dirty && (
          <View style={s.saveBar(insets.bottom)}>
            <Text variant="small" color={t.color.textMuted} style={s.flex1}>Applies to everyone in {orgName}</Text>
            <Pressable onPress={discard} accessibilityRole="button" style={s.discardBtn}>
              <Text variant="label" color={t.color.textMuted}>Discard</Text>
            </Pressable>
            <Pressable onPress={save} disabled={busy} accessibilityRole="button" style={s.saveBtn(busy)}>
              <Text variant="label" color={textOn(t.color.success)}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        )}

        {/* Toast */}
        <Animated.View style={[s.toastView, { bottom: insets.bottom + 20, opacity: toastAnim, transform: [{ translateX: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] }]}>
          <Ionicons name="checkmark-circle" size={16} color={t.color.success} />
          <Text variant="small" color={t.color.success}>Saved — colours apply to all users.</Text>
        </Animated.View>
      </View>

      {/* ── Colour picker modal ── */}
      <Modal
        visible={editingTab !== null}
        transparent
        animationType={isWeb ? 'fade' : 'slide'}
        onRequestClose={() => setEditingTab(null)}
      >
        {isWeb ? (
          // Web: standard centred dialog
          <View style={wd.backdrop}>
            <Pressable style={wd.backdropClose} onPress={() => setEditingTab(null)} />
            <View style={wd.dialog}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={wd.scrollContent}>
                <View style={pc.header}>
                  <Text variant="heading" style={pc.flex1}>{activeLabel}</Text>
                  <Pressable onPress={() => setEditingTab(null)} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="close" size={22} color={t.color.textMuted} />
                  </Pressable>
                </View>
                <View style={pc.wheelWrapper}>
                  <ColorWheel h={hsv.h} s={hsv.s} v={hsv.v} onChange={onWheelChange} size={wheelSize} />
                </View>
                <BrightnessSlider value={hsv.v} maxColor={maxColor} onChange={onBrightness} />
                <Pressable onPress={() => setHexOpen((o) => !o)} accessibilityRole="button" style={pc.hexRow}>
                  <View style={pc.hexSwatch(currentHex)} />
                  <Text variant="mono" style={pc.hexMono}>{currentHex.toUpperCase()}</Text>
                  <Ionicons name="create-outline" size={18} color={t.color.textMuted} />
                </Pressable>
                {hexOpen && (
                  <View style={pc.hexInputRow}>
                    <TextInput value={hexInput} onChangeText={(v) => { setHexInput(v); setHexErr(false); }}
                      onSubmitEditing={applyHex} placeholder="#rrggbb" placeholderTextColor={t.color.textMuted}
                      autoCapitalize="none" autoCorrect={false} returnKeyType="done" style={pc.hexInput(hexErr, t)} />
                    <Pressable onPress={applyHex} accessibilityRole="button" style={pc.hexApplyBtn}>
                      <Text variant="label">Apply</Text>
                    </Pressable>
                  </View>
                )}
                {hexErr && <Text variant="small" color={t.color.danger}>Enter a valid hex, e.g. #2a7f62</Text>}
              </ScrollView>
            </View>
          </View>
        ) : (
          // Mobile: bottom sheet — content in ScrollView so maxHeight clips cleanly
          <View style={ms.backdrop}>
            <Pressable style={ms.backdropClose} onPress={() => setEditingTab(null)} />
            <View style={ms.sheet}>
              <View style={ms.handle}>
                <View style={ms.handleBar} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ms.scrollContent}>
                <View style={pc.header}>
                  <Text variant="heading" style={pc.flex1}>{activeLabel}</Text>
                  <Pressable onPress={() => setEditingTab(null)} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="close" size={22} color={t.color.textMuted} />
                  </Pressable>
                </View>
                <View style={pc.wheelWrapper}>
                  <ColorWheel h={hsv.h} s={hsv.s} v={hsv.v} onChange={onWheelChange} size={wheelSize} />
                </View>
                <BrightnessSlider value={hsv.v} maxColor={maxColor} onChange={onBrightness} />
                <Pressable onPress={() => setHexOpen((o) => !o)} accessibilityRole="button" style={pc.hexRow}>
                  <View style={pc.hexSwatch(currentHex)} />
                  <Text variant="mono" style={pc.hexMono}>{currentHex.toUpperCase()}</Text>
                  <Ionicons name="create-outline" size={18} color={t.color.textMuted} />
                </Pressable>
                {hexOpen && (
                  <View style={pc.hexInputRow}>
                    <TextInput value={hexInput} onChangeText={(v) => { setHexInput(v); setHexErr(false); }}
                      onSubmitEditing={applyHex} placeholder="#rrggbb" placeholderTextColor={t.color.textMuted}
                      autoCapitalize="none" autoCorrect={false} returnKeyType="done" style={pc.hexInput(hexErr, t)} />
                    <Pressable onPress={applyHex} accessibilityRole="button" style={pc.hexApplyBtn}>
                      <Text variant="label">Apply</Text>
                    </Pressable>
                  </View>
                )}
                {hexErr && <Text variant="small" color={t.color.danger}>Enter a valid hex, e.g. #2a7f62</Text>}
              </ScrollView>
            </View>
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}
