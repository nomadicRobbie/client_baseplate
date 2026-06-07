import { createContext, useContext, type ReactNode } from 'react';
import { tokens, type Theme } from './tokens';

// Theme context — defaults to blnk tokens. A client clone wraps the app in
// <ThemeProvider theme={partialOverrides}> to re-skin without touching components.
const ThemeContext = createContext<Theme>(tokens);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function ThemeProvider({ theme, children }: { theme?: DeepPartial<Theme>; children: ReactNode }) {
  const merged: Theme = theme
    ? {
        color: { ...tokens.color, ...(theme.color ?? {}) },
        space: { ...tokens.space, ...(theme.space ?? {}) },
        radius: { ...tokens.radius, ...(theme.radius ?? {}) },
        font: { ...tokens.font, ...(theme.font ?? {}) },
        size: { ...tokens.size, ...(theme.size ?? {}) },
      }
    : tokens;
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export type { Theme };
