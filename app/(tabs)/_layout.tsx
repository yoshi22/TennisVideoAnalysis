import { Redirect, Tabs } from 'expo-router';

import { CustomTabBar } from '@/components/common/CustomTabBar';
import { useOnboardingStore } from '@/stores';

export default function TabLayout() {
  const hasCompletedOnboarding = useOnboardingStore((s) => s.hasCompletedOnboarding);

  if (!hasCompletedOnboarding) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <Redirect href={'/onboarding' as any} />;
  }

  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'ホーム' }} />
      <Tabs.Screen name="history" options={{ title: '履歴' }} />
      <Tabs.Screen name="new" options={{ title: '新規', href: null }} />
      <Tabs.Screen name="report" options={{ title: 'レポート' }} />
      <Tabs.Screen name="settings" options={{ title: '設定' }} />
    </Tabs>
  );
}
