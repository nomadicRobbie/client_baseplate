import React, { useState, useRef, useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  View, Text as RNText, Pressable, TextInput, ScrollView, ActivityIndicator, Animated, Easing,
  KeyboardAvoidingView, Platform,
  type StyleProp, type ViewStyle, type TextStyle, type TextInput as RNTextInput,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// react-native-web passes `hovered` in the Pressable style state; RN core types
// don't include it, so read it through this widened shape.
type PressState = { pressed: boolean; hovered?: boolean };

function makeStyles(t: ReturnType<typeof useTheme>) {
  return {
    safeArea: { flex: 1, backgroundColor: t.color.bg },
    scrollView: { flex: 1 },
    scrollContent: { flexGrow: 1 },
    keyboardAvoider: { flex: 1 },
    card: {
      backgroundColor: t.color.surface, borderRadius: t.radius.lg,
      borderWidth: 1, borderColor: t.color.border, padding: t.space.lg, gap: t.space.sm,
    },
    fieldWrapper: { gap: t.space.xs },
    input: {
      backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, minHeight: 44,
      fontSize: t.size.md, color: t.color.text,
    },
    badge: (bg: string) => ({
      alignSelf: 'flex-start' as const, backgroundColor: bg,
      borderRadius: t.radius.pill, paddingVertical: 3, paddingHorizontal: t.space.sm,
    }),
    colorPickerContainer: { gap: t.space.sm },
    swatchRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.md },
    swatch: (c: string, selected: boolean) => ({
      width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: c,
      borderWidth: 3, borderColor: selected ? t.color.ink : 'transparent',
    }),
    customSwatch: (c: string) => ({
      width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: c,
      borderWidth: 3, borderColor: t.color.ink,
    }),
    hexRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
    hexInput: (hasError: boolean) => ({
      flex: 1, backgroundColor: t.color.surface, borderWidth: 1,
      borderColor: hasError ? t.color.danger : t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, minHeight: 44,
      fontSize: t.size.md, color: t.color.text, fontFamily: t.font.mono,
    }),
    applyBtn: (pressed: boolean) => ({
      paddingVertical: t.space.md, paddingHorizontal: t.space.lg,
      backgroundColor: t.color.surfaceAlt, borderRadius: t.radius.md,
      minHeight: 44, justifyContent: 'center' as const, opacity: pressed ? 0.7 : 1,
    }),
    clearBtn: { alignSelf: 'flex-start' as const },
    contentWrapper: (maxWidth: number, pad: number, scroll: boolean) => ({
      width: '100%' as const, maxWidth, alignSelf: 'center' as const,
      padding: pad, gap: t.space.lg,
      flexGrow: scroll ? 1 : undefined,
      flex: scroll ? undefined : 1,
    }),
  };
}

// ── Text ────────────────────────────────────────────────────────────────────
type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'mono' | 'small';

export function Text({
  variant = 'body', muted, color, style, numberOfLines, children,
}: {
  variant?: TextVariant; muted?: boolean; color?: string;
  style?: StyleProp<TextStyle>; numberOfLines?: number; children: ReactNode;
}) {
  const t = useTheme();
  const map: Record<TextVariant, TextStyle> = {
    title: { fontSize: t.size.xxl, fontWeight: '700', fontFamily: t.font.mono, letterSpacing: -0.5 },
    heading: { fontSize: t.size.lg, fontWeight: '700', letterSpacing: -0.2 },
    body: { fontSize: t.size.md, fontWeight: '400', lineHeight: t.size.md * 1.5 },
    label: { fontSize: t.size.sm, fontWeight: '600', lineHeight: t.size.sm * 1.4 },
    mono: { fontSize: t.size.sm, fontFamily: t.font.mono },
    small: { fontSize: t.size.xs, lineHeight: t.size.xs * 1.4 },
  };
  return (
    <RNText numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? t.color.textMuted : t.color.text) }, map[variant], style]}>
      {children}
    </RNText>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────
export type ToastMsg = { text: string; tone: 'success' | 'error' | 'info' };

const IS_DEV = process.env.EXPO_PUBLIC_ENV === 'dev';

function Toast({ msg, onDismiss }: { msg: ToastMsg; onDismiss: () => void }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(340)).current;

  useEffect(() => {
    x.setValue(340);
    Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (IS_DEV) return;
    const timer = setTimeout(() => {
      Animated.timing(x, { toValue: 340, duration: 180, useNativeDriver: true }).start(onDismiss);
    }, 3500);
    return () => clearTimeout(timer);
  }, [msg.text, msg.tone]);

  const borderColor = msg.tone === 'error' ? t.color.danger : msg.tone === 'success' ? t.color.success : t.color.border;
  const bg = msg.tone === 'error' ? t.color.dangerMuted : msg.tone === 'success' ? t.color.successMuted : t.color.surfaceAlt;
  const textColor = msg.tone === 'error' ? t.color.danger : msg.tone === 'success' ? t.color.success : t.color.textMuted;

  return (
    <Animated.View onTouchEnd={IS_DEV ? onDismiss : undefined} style={{
      position: 'absolute', right: 16, bottom: 88, zIndex: 1000, maxWidth: 320,
      transform: [{ translateX: x }],
      backgroundColor: bg, borderWidth: 1, borderColor, borderRadius: t.radius.md,
      padding: t.space.md,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 4,
    }}>
      <Text variant="small" color={textColor}>{msg.text}</Text>
    </Animated.View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
// Caps content width and centres it so lines stay readable on wide desktop.
export function Screen({
  children, scroll = true, padded = true, maxWidth = 920, scrollRef, onScroll, toast, onDismissToast,
}: {
  children: ReactNode; scroll?: boolean; padded?: boolean; maxWidth?: number;
  // Optional handles so a screen can preserve/restore scroll position across
  // in-place overlays (e.g. opening then cancelling a record form).
  scrollRef?: RefObject<ScrollView | null>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  toast?: ToastMsg | null;
  onDismissToast?: () => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const pad = padded ? t.space.xl : 0;
  const content = (
    <View style={s.contentWrapper(maxWidth, pad, scroll)}>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={s.safeArea}>
      {/* Keyboard handling lives here so every screen gets it for free.
          Scrolling screens: automaticallyAdjustKeyboardInsets is the native iOS
          inset — the focused input scrolls clear of the keyboard on its own.
          Non-scroll screens (login): KeyboardAvoidingView shrinks the frame.
          Android needs neither — app.json's default adjustResize handles it. */}
      {scroll
        ? (
          <ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
            style={s.scrollView}
            contentContainerStyle={s.scrollContent}
          >{content}</ScrollView>
        )
        : (
          <KeyboardAvoidingView
            style={s.keyboardAvoider}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >{content}</KeyboardAvoidingView>
        )}
      {toast && onDismissToast && <Toast msg={toast} onDismiss={onDismissToast} />}
    </SafeAreaView>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={[s.card, style]}>
      {children}
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';

export function Button({
  label, onPress, variant = 'primary', icon, disabled, loading, style,
}: {
  label: string; onPress: () => void; variant?: ButtonVariant;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg: Record<ButtonVariant, string> = {
    primary: t.color.primary, secondary: t.color.surfaceAlt, ghost: 'transparent', danger: t.color.danger, warning: 'transparent',
  };
  const fg: Record<ButtonVariant, string> = {
    primary: t.color.primaryText, secondary: t.color.text, ghost: t.color.text, danger: '#ffffff', warning: t.color.danger,
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={(state) => {
        const { pressed, hovered } = state as PressState;
        return [{
          backgroundColor: bg[variant],
          opacity: disabled ? 0.5 : pressed ? 0.82 : hovered ? 0.92 : 1,
          minHeight: 44,
          paddingVertical: t.space.md, paddingHorizontal: t.space.lg,
          borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center',
          flexDirection: 'row', gap: 6,
          borderWidth: variant === 'ghost' || variant === 'secondary' || variant === 'warning' ? 1 : 0,
          borderColor: variant === 'warning' ? t.color.danger : t.color.border,
        }, style];
      }}
    >
      {loading
        ? <ActivityIndicator color={fg[variant]} />
        : <>
            {icon && <Ionicons name={icon} size={16} color={fg[variant]} />}
            <Text variant="label" color={fg[variant]}>{label}</Text>
          </>}
    </Pressable>
  );
}

// ── TextField ──────────────────────────────────────────────────────────────────
export function TextField({
  label, value, onChangeText, placeholder, keyboardType, secureTextEntry, autoCapitalize, autoComplete, autoFocus, inputRef, multiline,
  error, disabled,
}: {
  label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad'; secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences'; autoComplete?: 'email' | 'off'; autoFocus?: boolean; inputRef?: React.Ref<RNTextInput>;
  multiline?: boolean; error?: string; disabled?: boolean;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [focused, setFocused] = useState(false);
  const borderColor = error ? t.color.danger : focused ? t.color.primary : t.color.border;
  const bg = error ? t.color.dangerMuted : disabled ? t.color.surfaceAlt : t.color.surface;
  return (
    <View style={s.fieldWrapper}>
      {!!label && <Text variant="label" muted>{label}</Text>}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.color.textMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        multiline={multiline}
        editable={!disabled}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[s.input, { borderColor, backgroundColor: bg }, multiline && { minHeight: 80, textAlignVertical: 'top' }, disabled && { opacity: 0.6 }]}
      />
      {!!error && <Text variant="small" color={t.color.danger}>{error}</Text>}
    </View>
  );
}

// ── Row (list / nav item) ──────────────────────────────────────────────────────
export function Row({
  children, onPress, active, style,
}: { children: ReactNode; onPress?: () => void; active?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const base: ViewStyle = {
    flexDirection: 'row', alignItems: 'center', gap: t.space.md,
    paddingVertical: t.space.sm, paddingHorizontal: t.space.xs,
    borderRadius: t.radius.md,
  };
  if (!onPress) return <View style={[base, active && { backgroundColor: t.color.surfaceAlt }, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={(state) => {
        const { pressed, hovered } = state as PressState;
        return [base, {
          backgroundColor: active || pressed ? t.color.surfaceAlt : hovered ? t.color.bg : 'transparent',
        }, style];
      }}
    >
      {children}
    </Pressable>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────────
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'accent' }) {
  const t = useTheme();
  const s = makeStyles(t);
  const bg = tone === 'success' ? t.color.success : tone === 'accent' ? t.color.accent : t.color.surfaceAlt;
  const fg = tone === 'neutral' ? t.color.textMuted : '#ffffff';
  return (
    <View style={s.badge(bg)}>
      <Text variant="small" color={fg}>{label}</Text>
    </View>
  );
}

// ── Inline status message (info / success / error) ──────────────────────────────
export function Notice({ message, tone = 'info', title }: { message: string; tone?: 'info' | 'success' | 'error'; title?: string }) {
  const t = useTheme();
  const color = tone === 'error' ? t.color.danger : tone === 'success' ? t.color.success : t.color.textMuted;
  const bg = tone === 'error' ? t.color.dangerMuted : tone === 'success' ? t.color.successMuted : t.color.surfaceAlt;
  const borderColor = tone === 'error' ? t.color.danger : tone === 'success' ? t.color.success : t.color.border;
  const icon: React.ComponentProps<typeof Ionicons>['name'] = tone === 'error' ? 'warning' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm, padding: t.space.md, borderRadius: t.radius.md, backgroundColor: bg, borderWidth: 1, borderColor }}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {!!title && <Text variant="label" color={color}>{title}</Text>}
        <Text variant="small" color={color}>{message}</Text>
      </View>
    </View>
  );
}

// ── ColorPicker ────────────────────────────────────────────────────────────────
// Swatches + hex input. `value` is a 6-digit hex string or null.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SWATCHES = ['#2a7f62', '#e8613a', '#1d4ed8', '#7c3aed', '#db2777', '#0e0e0e', '#c8922e'];

export function ColorPicker({ value, onChange, nullable = false }: {
  value: string | null;
  onChange: (v: string | null) => void;
  nullable?: boolean;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [hex, setHex] = useState('');
  const [hexErr, setHexErr] = useState(false);

  const commitHex = () => {
    const h = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
    if (HEX_RE.test(h)) { onChange(h); setHex(''); setHexErr(false); }
    else setHexErr(true);
  };

  return (
    <View style={s.colorPickerContainer}>
      <View style={s.swatchRow}>
        {SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            accessibilityRole="button"
            accessibilityLabel={c}
            style={s.swatch(c, value === c)}
          />
        ))}
        {/* Show custom colour as a swatch if it's not in the preset list */}
        {value && !SWATCHES.includes(value) && (
          <View style={s.customSwatch(value)} />
        )}
      </View>
      <View style={s.hexRow}>
        <TextInput
          value={hex}
          onChangeText={(v) => { setHex(v); setHexErr(false); }}
          onSubmitEditing={commitHex}
          placeholder="#rrggbb"
          placeholderTextColor={t.color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={s.hexInput(hexErr)}
        />
        <Pressable
          onPress={commitHex}
          accessibilityRole="button"
          accessibilityLabel="Apply hex colour"
          style={(state) => {
            const { pressed } = state as { pressed: boolean };
            return s.applyBtn(pressed);
          }}
        >
          <Text variant="label">Apply</Text>
        </Pressable>
      </View>
      {hexErr && <Text variant="small" color={t.color.danger}>Enter a valid hex colour, e.g. #2a7f62</Text>}
      {nullable && value && (
        <Pressable onPress={() => onChange(null)} accessibilityRole="button" style={s.clearBtn}>
          <Text variant="small" color={t.color.textMuted}>Clear colour</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Pill / Chip selector ──────────────────────────────────────────────────────
export function Pill({ label, active, onPress, disabled }: {
  label: string; active: boolean; onPress: () => void; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        minHeight: 40, paddingHorizontal: t.space.lg, justifyContent: 'center',
        borderRadius: t.radius.pill, borderWidth: 1,
        borderColor: active ? t.color.primary : t.color.border,
        backgroundColor: active ? t.color.primary : t.color.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text variant="small" style={{ fontWeight: '600' }} color={active ? t.color.primaryText : t.color.text}>{label}</Text>
    </Pressable>
  );
}

// ── Yes / No pair ─────────────────────────────────────────────────────────────
export function YesNo({ value, onChange }: {
  value: boolean | null; onChange: (v: boolean | null) => void;
}) {
  const t = useTheme();
  const yesActive = value === true;
  const noActive = value === false;
  const pill = (yes: boolean, active: boolean): ViewStyle => ({
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: t.radius.pill, borderWidth: 1,
    borderColor: active ? (yes ? t.color.primary : t.color.danger) : t.color.border,
    backgroundColor: active ? (yes ? t.color.primary : t.color.danger) : t.color.surface,
  });
  const toggle = (yes: boolean) => {
    const isActive = yes ? yesActive : noActive;
    onChange(isActive ? null : yes);
  };
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm }}>
      <Pressable onPress={() => toggle(true)} accessibilityRole="button" accessibilityState={{ selected: yesActive }} style={pill(true, yesActive)}>
        <Text variant="label" color={yesActive ? '#fff' : t.color.primary}>Yes</Text>
      </Pressable>
      <Pressable onPress={() => toggle(false)} accessibilityRole="button" accessibilityState={{ selected: noActive }} style={pill(false, noActive)}>
        <Text variant="label" color={noActive ? '#fff' : t.color.danger}>No</Text>
      </Pressable>
    </View>
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────
export function Checkbox({ checked, onChange, label, error }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; error?: boolean;
}) {
  const t = useTheme();
  const borderColor = error ? t.color.danger : checked ? t.color.primary : t.color.border;
  const bg = error ? t.color.dangerMuted : checked ? t.color.primary : t.color.surface;
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 44 }}
    >
      <View style={{ width: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1.5, borderColor, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
      {!!label && <Text variant="label" style={{ flex: 1 }}>{label}</Text>}
    </Pressable>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
export function Toggle({ value, onChange, label }: {
  value: boolean; onChange: (v: boolean) => void; label?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}
    >
      {!!label && <Text variant="label" style={{ flex: 1 }}>{label}</Text>}
      <View style={{ width: 44, height: 26, borderRadius: t.radius.pill, backgroundColor: value ? t.color.primary : t.color.border, justifyContent: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', marginLeft: value ? 21 : 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 }} />
      </View>
    </Pressable>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────
export function Stepper({ value, onChange, min = 0 }: {
  value: number; onChange: (v: number) => void; min?: number;
}) {
  const t = useTheme();
  const btn: ViewStyle = { width: 44, height: 44, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} accessibilityRole="button" accessibilityLabel="Decrease" style={btn}>
        <Text variant="heading">−</Text>
      </Pressable>
      <View style={{ width: 44, alignItems: 'center' }}>
        <Text variant="heading">{value}</Text>
      </View>
      <Pressable onPress={() => onChange(value + 1)} accessibilityRole="button" accessibilityLabel="Increase" style={btn}>
        <Text variant="heading">+</Text>
      </Pressable>
    </View>
  );
}
