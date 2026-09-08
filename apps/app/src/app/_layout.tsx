import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme';

function ThemedApp() {
  const t = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }
      meta.content = t.color.bg;
    }
    if (Platform.OS === 'web' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [t.color.bg]);

  return (
    // ponytail: style on SafeAreaProvider fills the strip behind the iOS status bar with the theme bg
    <SafeAreaProvider style={{ backgroundColor: t.color.bg }}>
      <StatusBar style="auto" backgroundColor={t.color.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.color.bg } }} />
    </SafeAreaProvider>
  );
}

// Root: theme wraps everything so ThemedApp can colour the safe-area provider.
// Auth-gating is handled per-screen via the session token.
// A client clone re-skins by passing `theme={...}` to ThemeProvider.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
