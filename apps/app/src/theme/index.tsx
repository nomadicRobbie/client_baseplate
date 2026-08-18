import { createContext, useContext, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { tokens, lightColor, darkColor, type Theme } from './tokens';
import { getItem, setItem } from '@/lib/storage';

// Theme context — defaults to blnk tokens. A client clone wraps the app in
// <ThemeProvider theme={partialOverrides}> to re-skin without touching components.
const ThemeContext = createContext<Theme>(tokens);

export type SchemePref = 'light' | 'dark' | 'os';
const SCHEME_KEY = 'color-scheme-pref';

const SchemePrefContext = createContext<{
  pref: SchemePref;
  setPref: (p: SchemePref) => void;
}>({ pref: 'os', setPref: () => {} });

export function useColorSchemePref() {
  return useContext(SchemePrefContext);
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function ThemeProvider({ theme, children }: { theme?: DeepPartial<Theme>; children: ReactNode }) {
  const [pref, setPrefState] = useState<SchemePref>(
    () => (getItem(SCHEME_KEY) as SchemePref | null) ?? 'os'
  );

  const setPref = (p: SchemePref) => {
    setPrefState(p);
    setItem(SCHEME_KEY, p);
  };

  const osScheme = useColorScheme() ?? 'light';
  const scheme = pref === 'os' ? osScheme : pref;
  const baseColor = scheme === 'dark' ? darkColor : lightColor;

  const merged: Theme = {
    color: { ...baseColor, ...(theme?.color ?? {}) },
    space: { ...tokens.space, ...(theme?.space ?? {}) },
    radius: { ...tokens.radius, ...(theme?.radius ?? {}) },
    font: { ...tokens.font, ...(theme?.font ?? {}) },
    size: { ...tokens.size, ...(theme?.size ?? {}) },
  };

  return (
    <SchemePrefContext.Provider value={{ pref, setPref }}>
      <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>
    </SchemePrefContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export type { Theme };
