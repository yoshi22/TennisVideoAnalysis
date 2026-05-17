import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { useSession } from '@/hooks';
import { useTheme } from '@/theme';

export default function SessionLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useSession();

  return (
    <Tabs
      screenOptions={{
        headerTitle: session?.title ?? 'セッション',
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.surface,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSub,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerLeft: () => (
          <TouchableOpacity
            accessibilityLabel="戻る"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons color={colors.surface} name="chevron-back" size={26} />
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="list-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="video"
        options={{
          title: 'Video',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="videocam-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="court"
        options={{
          title: 'Court',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="map-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Report',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="bar-chart-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="calibration"
        options={{
          href: null,
          headerShown: true,
          tabBarStyle: { display: 'none' },
          title: 'コート較正',
        }}
      />
      <Tabs.Screen
        name="ball-trace"
        options={{
          href: null,
          headerShown: true,
          tabBarStyle: { display: 'none' },
          title: 'ボール軌跡解析',
        }}
      />
      <Tabs.Screen
        name="auto-score"
        options={{
          href: null,
          headerShown: true,
          tabBarStyle: { display: 'none' },
          title: '自動採点（実験的）',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
