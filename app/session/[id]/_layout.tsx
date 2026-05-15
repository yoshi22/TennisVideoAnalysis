import { Ionicons } from '@expo/vector-icons';
import { Tabs, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';

function getParamId(id: string | string[] | undefined): string {
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

export default function SessionLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === sessionId));

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
