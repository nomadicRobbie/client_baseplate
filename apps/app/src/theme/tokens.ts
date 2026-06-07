import { Platform } from 'react-native';

// ── Design tokens ───────────────────────────────────────────────────────────
// Default theme is blnk-branded. Clients override via <ThemeProvider theme={...}>.
// Keep this the single source of truth — components never hardcode colours/spacing.

export const tokens = {
  color: {
    // brand
    ink: '#0e0e0e',
    parchment: '#f5f0e8',
    operator: '#2a7f62',
    signal: '#e8613a',
    // semantic surfaces
    bg: '#f5f0e8',
    surface: '#ffffff',
    surfaceAlt: '#efe8db',
    // text
    text: '#0e0e0e',
    textMuted: '#6b675f',
    textInverse: '#f5f0e8',
    // lines / states
    border: '#e3dccd',
    primary: '#2a7f62',
    primaryText: '#ffffff',
    accent: '#e8613a',
    danger: '#e8613a',
    success: '#2a7f62',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  font: {
    body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui, sans-serif' }) as string,
    // Brand accent face. Clients can load DM Mono via expo-font and swap this.
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, monospace' }) as string,
  },
  size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 34 },
} as const;

export type Theme = typeof tokens;
