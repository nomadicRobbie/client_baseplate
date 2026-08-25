import { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, TextInput, Animated, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { updateOrg } from '@/lib/api';
import { useTheme } from '@/theme';
import { lightColor, darkColor } from '@/theme/tokens';
import { Text } from '@/ui/components';
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

function contrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [0.2126, 0.7152, 0.0722].reduce((acc, w, i) => {
      const v = ((n >> ((2 - i) * 8)) & 255) / 255;
      return acc + w * (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    }, 0);
  };
  const l1 = lum(hex1), l2 = lum(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.179 ? '#0e0e0e' : '#ffffff';
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Scheme = 'light' | 'dark';
type Tab = 'primary' | 'accent' | 'bgColor' | 'surfaceColor';
type Colors = { primary: string | null; accent: string | null; bgColor: string | null; surfaceColor: string | null };

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'primary', label: 'Brand', hint: 'Buttons, links and active states.' },
  { key: 'accent', label: 'Accent', hint: 'Badges, highlights and alerts.' },
  { key: 'bgColor', label: 'Background', hint: 'The page behind every card.' },
  { key: 'surfaceColor', label: 'Surface', hint: 'Cards, inputs and sheets.' },
];

// ── Preview ───────────────────────────────────────────────────────────────────
type PT = { bg: string; surface: string; text: string; textMuted: string; border: string; primary: string; accent: string };

function MiniPreview({ pt }: { pt: PT }) {
  return (
    <View style={{ backgroundColor: pt.bg, borderRadius: 14, padding: 12, gap: 10, borderWidth: 1, borderColor: '#303030', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="label" color={pt.text}>Library</Text>
        <View style={{ backgroundColor: pt.accent, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
          <Text variant="small" color={textOn(pt.accent)}>Due</Text>
        </View>
      </View>
      <View style={{ backgroundColor: pt.surface, borderRadius: 12, borderWidth: 1, borderColor: pt.border, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: pt.primary, flexShrink: 0 }} />
          <View style={{ flex: 1 }}>
            <Text variant="label" color={pt.text}>Quarterly report</Text>
            <Text variant="small" color={pt.textMuted}>Updated 2 minutes ago</Text>
          </View>
        </View>
        <View style={{ backgroundColor: pt.surface, borderRadius: 8, borderWidth: 1, borderColor: pt.border, padding: 9 }}>
          <Text variant="small" color={pt.textMuted}>Search records</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ backgroundColor: pt.primary, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 18 }}>
            <Text variant="small" color={textOn(pt.primary)} style={{ fontWeight: '600' }}>Save</Text>
          </View>
          <View style={{ borderWidth: 1, borderColor: pt.border, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 18 }}>
            <Text variant="small" color={pt.text} style={{ fontWeight: '600' }}>Cancel</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Brightness slider ─────────────────────────────────────────────────────────
function BrightnessSlider({ value, maxColor, onChange }: { value: number; maxColor: string; onChange: (v: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const SEGMENTS = 12;

  const handleResponder = (locationX: number) => {
    if (trackWidth === 0) return;
    const v = Math.max(0.04, Math.min(1, locationX / trackWidth));
    onChange(v);
  };

  const thumbLeft = Math.max(0, Math.min(trackWidth - 24, value * trackWidth - 12));

  return (
    <View style={{ width: '100%', gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="small" color="#9a9590" style={{ fontWeight: '600' }}>Brightness</Text>
        <Text variant="small" color="#9a9590" style={{ fontWeight: '600' }}>{Math.round(value * 100)}%</Text>
      </View>
      <View
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        style={{ height: 24, justifyContent: 'center', position: 'relative' }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => handleResponder(e.nativeEvent.locationX)}
        onResponderMove={(e) => handleResponder(e.nativeEvent.locationX)}
      >
        <View style={{ flexDirection: 'row', borderRadius: 999, overflow: 'hidden', height: 10 }}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: blendHex('#000000', maxColor, (i + 0.5) / SEGMENTS) }} />
          ))}
        </View>
        {trackWidth > 0 && (
          <View style={{
            position: 'absolute', left: thumbLeft, top: 0,
            width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
            borderWidth: 1, borderColor: 'rgba(0,0,0,0.3)',
            ...(Platform.OS === 'web' ? { boxShadow: '0 1px 4px rgba(0,0,0,0.4)' } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 }),
          }} />
        )}
      </View>
    </View>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// Theme / appearance. Admin-only; brand colours apply to everyone.
export default function Theme() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data, refresh } = useProfile();
  const isAdmin = data?.me.role === 'admin' || data?.me.role === 'super';
  const orgName = data?.org?.org_name ?? 'your organisation';

  // Saved colors from org (restore on discard)
  const savedColorsRef = useRef<Colors>({
    primary: data?.org?.brand_color ?? null,
    accent: data?.org?.accent_color ?? null,
    bgColor: data?.org?.custom_colors?.bg ?? null,
    surfaceColor: data?.org?.custom_colors?.surface ?? null,
  });

  const [colors, setColors] = useState<Colors>(savedColorsRef.current);
  const [tab, setTab] = useState<Tab>('primary');
  const [previewScheme, setPreviewScheme] = useState<Scheme>('dark');
  const [hexOpen, setHexOpen] = useState(false);
  const [hexInput, setHexInput] = useState('');
  const [hexErr, setHexErr] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Derive current color for active tab
  const base = previewScheme === 'dark' ? darkColor : lightColor;
  const defaultForTab: Record<Tab, string> = {
    primary: base.primary, accent: base.accent, bgColor: base.bg, surfaceColor: base.surface,
  };
  const currentHex = colors[tab] ?? defaultForTab[tab];
  const [hsv, setHsv] = useState(() => hex2hsv(currentHex));

  // When tab changes, update hsv to match the new tab's color
  useEffect(() => {
    setHsv(hex2hsv(colors[tab] ?? defaultForTab[tab]));
    setHexOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Preview theme (merges overrides onto the selected base scheme)
  const pt: PT = {
    bg: colors.bgColor ?? base.bg,
    surface: colors.surfaceColor ?? base.surface,
    text: base.text,
    textMuted: base.textMuted,
    border: base.border,
    primary: colors.primary ?? base.primary,
    accent: colors.accent ?? base.accent,
  };

  // Contrast warnings
  const primaryContrast = contrastRatio(pt.primary, textOn(pt.primary));
  const bodyContrast = contrastRatio(pt.text, pt.surface);
  const warn =
    primaryContrast < 3
      ? `Button text contrast is low (${primaryContrast.toFixed(1)}:1). Try a different shade.`
      : bodyContrast < 4.5
        ? `Body text sits at ${bodyContrast.toFixed(1)}:1 on this surface — below the 4.5:1 minimum.`
        : null;

  // Animated save bar (slides up when dirty)
  const saveBarAnim = useRef(new Animated.Value(80)).current;
  useEffect(() => {
    Animated.spring(saveBarAnim, {
      toValue: dirty ? 0 : 80,
      useNativeDriver: false,
      tension: 80, friction: 12,
    }).start();
  }, [dirty, saveBarAnim]);

  // Toast (fades out after save)
  const toastAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!saved) return;
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2400),
      Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: false }),
    ]).start(() => setSaved(false));
  }, [saved, toastAnim]);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const setColor = (hex: string) => {
    setColors((c) => ({ ...c, [tab]: hex }));
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
    setHsv(hex2hsv(defaultForTab[tab]));
    setDirty(true);
  };

  const discard = () => {
    setColors(savedColorsRef.current);
    setHsv(hex2hsv(savedColorsRef.current[tab] ?? defaultForTab[tab]));
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
      // ponytail: surface error via alert — dedicated error UI is overkill for save failures
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    } finally { setBusy(false); }
  };

  const maxColor = hsv2hex(hsv.h, hsv.s, 1);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.color.bg }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>

        {/* ── Fixed header ── */}
        <View style={{ backgroundColor: t.color.bg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 12 }}>

          {/* Title + scheme toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text variant="title" style={{ flex: 1 }}>Theme</Text>
            <View style={{ flexDirection: 'row', backgroundColor: t.color.surfaceAlt, borderRadius: 999, padding: 3 }}>
              {(['light', 'dark'] as Scheme[]).map((sc) => {
                const active = previewScheme === sc;
                return (
                  <Pressable
                    key={sc}
                    onPress={() => setPreviewScheme(sc)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999,
                      backgroundColor: active ? t.color.ink : 'transparent',
                    }}
                  >
                    <Text variant="small" style={{ fontWeight: '600' }} color={active ? t.color.parchment : t.color.textMuted}>
                      {sc === 'light' ? 'Light' : 'Dark'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Preview label */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="eye-outline" size={14} color={t.color.textMuted} />
            <Text variant="small" color={t.color.textMuted} style={{ fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' as const }}>Preview</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.color.border }} />
            <Text variant="small" color={t.color.textMuted}>{dirty ? 'unsaved' : 'not yet saved'}</Text>
          </View>

          <MiniPreview pt={pt} />

          {/* Contrast warning */}
          {!!warn && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 10, backgroundColor: t.color.warningMuted, borderWidth: 1, borderColor: t.color.warning }}>
              <Ionicons name="warning" size={16} color={t.color.warning} style={{ marginTop: 1 }} />
              <Text variant="small" color={t.color.warning} style={{ flex: 1 }}>{warn}</Text>
            </View>
          )}
        </View>

        {/* ── Scrollable picker ── */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 120 }}
        >

          {/* Tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: 999, padding: 4, width: '100%' }}>
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: active ? t.color.ink : 'transparent' }}
                >
                  <Text variant="small" style={{ fontWeight: '600' }} color={active ? t.color.parchment : t.color.textMuted}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="small" color={t.color.textMuted} style={{ textAlign: 'center', marginTop: -8 }}>
            {TABS.find((tb) => tb.key === tab)?.hint}
          </Text>

          {/* Color wheel (platform-resolved) */}
          <View style={{ alignItems: 'center' }}>
            <ColorWheel h={hsv.h} s={hsv.s} v={hsv.v} onChange={onWheelChange} />
          </View>

          {/* Brightness slider */}
          <BrightnessSlider value={hsv.v} maxColor={maxColor} onChange={onBrightness} />

          {/* Hex row */}
          <Pressable
            onPress={() => setHexOpen((o) => !o)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', minHeight: 52, paddingHorizontal: 12, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, borderRadius: 12 }}
          >
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: currentHex, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
            <Text variant="mono" style={{ flex: 1, fontSize: 15 }}>{currentHex.toUpperCase()}</Text>
            {!!colors[tab] && <Text variant="small" color={t.color.textMuted} style={{ fontWeight: '600', paddingRight: 4 }}>Custom</Text>}
            <Ionicons name="create-outline" size={18} color={t.color.textMuted} />
          </Pressable>

          {/* Hex input (expandable) */}
          {hexOpen && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', width: '100%', marginTop: -10 }}>
              <TextInput
                value={hexInput}
                onChangeText={(v) => { setHexInput(v); setHexErr(false); }}
                onSubmitEditing={applyHex}
                placeholder="#rrggbb"
                placeholderTextColor={t.color.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                style={{
                  flex: 1, backgroundColor: t.color.surface, borderWidth: 1,
                  borderColor: hexErr ? t.color.danger : t.color.border,
                  borderRadius: 10, padding: 12, minHeight: 44,
                  fontSize: 16, color: t.color.text, fontFamily: t.font.mono,
                }}
              />
              <Pressable
                onPress={applyHex}
                accessibilityRole="button"
                style={{ paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: t.color.surfaceAlt, borderRadius: 10 }}
              >
                <Text variant="label">Apply</Text>
              </Pressable>
            </View>
          )}
          {hexErr && <Text variant="small" color={t.color.danger}>Enter a valid hex colour, e.g. #2a7f62</Text>}

          {/* Reset */}
          <Pressable
            onPress={reset}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, alignSelf: 'flex-start' }}
          >
            <Ionicons name="refresh" size={16} color={t.color.accent} />
            <Text variant="label" color={t.color.accent}>Reset all four colours to defaults</Text>
          </Pressable>

        </ScrollView>

        {/* ── Floating save bar ── */}
        <Animated.View style={{
          position: 'absolute', left: 0, right: 0, bottom: insets.bottom,
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: 16, paddingVertical: 12,
          backgroundColor: t.color.surface, borderTopWidth: 1, borderTopColor: t.color.border,
          transform: [{ translateY: saveBarAnim }],
        }}>
          <Text variant="small" color={t.color.textMuted} style={{ flex: 1 }}>Applies to everyone in {orgName}</Text>
          <Pressable
            onPress={discard}
            accessibilityRole="button"
            style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center' }}
          >
            <Text variant="label" color={t.color.textMuted}>Discard</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            style={{ minHeight: 40, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: t.color.success, borderRadius: 10, opacity: busy ? 0.7 : 1 }}
          >
            <Text variant="label" color={textOn(t.color.success)}>{busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </Animated.View>

        {/* ── Toast ── */}
        <Animated.View style={{
          position: 'absolute', right: 16, bottom: insets.bottom + 72,
          flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 320,
          backgroundColor: t.color.successMuted, borderWidth: 1, borderColor: t.color.success,
          borderRadius: 10, padding: 12,
          opacity: toastAnim,
          transform: [{ translateX: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }],
          pointerEvents: 'none' as any,
        }}>
          <Ionicons name="checkmark-circle" size={16} color={t.color.success} />
          <Text variant="small" color={t.color.success}>Saved — colours apply to all users.</Text>
        </Animated.View>

      </View>
    </SafeAreaView>
  );
}
