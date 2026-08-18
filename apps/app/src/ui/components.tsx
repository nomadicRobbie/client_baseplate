import React, { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  View, Text as RNText, Pressable, TextInput, ScrollView, ActivityIndicator,
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
    label: { fontSize: t.size.sm, fontWeight: '600' },
    mono: { fontSize: t.size.sm, fontFamily: t.font.mono },
    small: { fontSize: t.size.xs, lineHeight: t.size.xs * 1.4 },
  };
  return (
    <RNText numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? t.color.textMuted : t.color.text) }, map[variant], style]}>
      {children}
    </RNText>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
// Caps content width and centres it so lines stay readable on wide desktop.
export function Screen({
  children, scroll = true, padded = true, maxWidth = 920, scrollRef, onScroll,
}: {
  children: ReactNode; scroll?: boolean; padded?: boolean; maxWidth?: number;
  // Optional handles so a screen can preserve/restore scroll position across
  // in-place overlays (e.g. opening then cancelling a record form).
  scrollRef?: RefObject<ScrollView | null>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
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
    <SafeAreaView style={s.safeArea}>
      {scroll
        ? <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" style={s.scrollView} contentContainerStyle={s.scrollContent}>{content}</ScrollView>
        : content}
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
}: {
  label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad'; secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences'; autoComplete?: 'email' | 'off'; autoFocus?: boolean; inputRef?: React.Ref<RNTextInput>;
  multiline?: boolean;
}) {
  const t = useTheme();
  const s = makeStyles(t);
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
        accessibilityLabel={label}
        style={[s.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
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
export function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' | 'error' }) {
  const t = useTheme();
  const color = tone === 'error' ? t.color.danger : tone === 'success' ? t.color.success : t.color.textMuted;
  return <Text variant="small" color={color}>{message}</Text>;
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
