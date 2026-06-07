import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/theme';

// Root: theme + safe-area context wrap the whole app.
// Auth-gating is handled per-screen via the session token.
// A client clone re-skins by passing `theme={...}` to ThemeProvider.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
