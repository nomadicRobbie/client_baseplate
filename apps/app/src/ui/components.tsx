import type { ReactNode } from 'react';
import {
  View, Text as RNText, Pressable, TextInput, ScrollView, ActivityIndicator,
  type StyleProp, type ViewStyle, type TextStyle, type TextInput as RNTextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

// react-native-web passes `hovered` in the Pressable style state; RN core types
// don't include it, so read it through this widened shape.
type PressState = { pressed: boolean; hovered?: boolean };

// ── Text ────────────────────────────────────────────────────────────────────
type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'mono' | 'small';

export function Text({
  variant = 'body', muted, color, style, children,
}: {
  variant?: TextVariant; muted?: boolean; color?: string;
  style?: StyleProp<TextStyle>; children: ReactNode;
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
    <RNText style={[{ color: color ?? (muted ? t.color.textMuted : t.color.text) }, map[variant], style]}>
      {children}
    </RNText>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
// Caps content width and centres it so lines stay readable on wide desktop.
export function Screen({
  children, scroll = true, padded = true, maxWidth = 920,
}: { children: ReactNode; scroll?: boolean; padded?: boolean; maxWidth?: number }) {
  const t = useTheme();
  const pad = padded ? t.space.xl : 0;
  const content = (
    <View style={{ width: '100%', maxWidth, alignSelf: 'center', padding: pad, gap: t.space.lg, flexGrow: scroll ? 1 : undefined, flex: scroll ? undefined : 1 }}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.color.bg }}>
      {scroll
        ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>{content}</ScrollView>
        : content}
    </SafeAreaView>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{
      backgroundColor: t.color.surface, borderRadius: t.radius.lg,
      borderWidth: 1, borderColor: t.color.border, padding: t.space.lg, gap: t.space.sm,
    }, style]}>
      {children}
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, variant = 'primary', disabled, loading, style,
}: {
  label: string; onPress: () => void; variant?: ButtonVariant;
  disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg: Record<ButtonVariant, string> = {
    primary: t.color.primary, secondary: t.color.surfaceAlt, ghost: 'transparent', danger: t.color.danger,
  };
  const fg: Record<ButtonVariant, string> = {
    primary: t.color.primaryText, secondary: t.color.text, ghost: t.color.text, danger: '#ffffff',
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
          minHeight: 44, // accessible touch target
          paddingVertical: t.space.md, paddingHorizontal: t.space.lg,
          borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center',
          borderWidth: variant === 'ghost' || variant === 'secondary' ? 1 : 0,
          borderColor: t.color.border,
        }, style];
      }}
    >
      {loading ? <ActivityIndicator color={fg[variant]} /> : <Text variant="label" color={fg[variant]}>{label}</Text>}
    </Pressable>
  );
}

// ── TextField ──────────────────────────────────────────────────────────────────
export function TextField({
  label, value, onChangeText, placeholder, keyboardType, secureTextEntry, autoCapitalize, inputRef,
}: {
  label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad'; secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences'; inputRef?: React.Ref<RNTextInput>;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xs }}>
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
        accessibilityLabel={label}
        style={{
          backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
          borderRadius: t.radius.md, padding: t.space.md, minHeight: 44,
          fontSize: t.size.md, color: t.color.text,
        }}
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
  const bg = tone === 'success' ? t.color.success : tone === 'accent' ? t.color.accent : t.color.surfaceAlt;
  const fg = tone === 'neutral' ? t.color.textMuted : '#ffffff';
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: t.radius.pill, paddingVertical: 3, paddingHorizontal: t.space.sm }}>
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
