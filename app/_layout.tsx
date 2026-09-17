import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  NotoSansJP_400Regular,
  NotoSansJP_500Medium,
  NotoSansJP_600SemiBold,
  NotoSansJP_700Bold,
} from '@expo-google-fonts/noto-sans-jp';
import {
  SairaCondensed_600SemiBold,
  SairaCondensed_700Bold,
} from '@expo-google-fonts/saira-condensed';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorFallback } from '@/components/common';
import { useOnboardingStore } from '@/stores';
import { ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

const sentryDsn = Constants.expoConfig?.extra?.sentryDsn as string | undefined;

Sentry.init({
  dsn: sentryDsn,
  enabled: !__DEV__ && Boolean(sentryDsn),
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 0.2,
  attachStacktrace: true,
});

function AppStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    NotoSansJP_400Regular,
    NotoSansJP_500Medium,
    NotoSansJP_600SemiBold,
    NotoSansJP_700Bold,
    SairaCondensed_600SemiBold,
    SairaCondensed_700Bold,
  });
  const [onboardingHydrated, setOnboardingHydrated] = useState(
    useOnboardingStore.persist.hasHydrated()
  );

  useEffect(() => {
    const unsub = useOnboardingStore.persist.onFinishHydration(() => setOnboardingHydrated(true));

    if (useOnboardingStore.persist.hasHydrated()) {
      setOnboardingHydrated(true);
    }

    return unsub;
  }, []);

  useEffect(() => {
    if (fontsLoaded && onboardingHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, onboardingHydrated]);

  if (!fontsLoaded || !onboardingHydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Sentry.ErrorBoundary
            fallback={({ eventId, resetError }) => (
              <ErrorFallback eventId={eventId} resetError={resetError} />
            )}
          >
            <AppStack />
          </Sentry.ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
