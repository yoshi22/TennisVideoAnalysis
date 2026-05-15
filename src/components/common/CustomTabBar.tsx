import { type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, G, Line, Path, Rect, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

// Inline stroke icons (react-native-svg, no Ionicons dependency)
function IcHome({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1v-9z" />
    </Svg>
  );
}

function IcHistory({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </Svg>
  );
}

function IcPlus({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

function IcChart({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M4 19V5" />
      <Path d="M4 19h16" />
      <Path d="M7 15l4-5 3 3 5-7" />
    </Svg>
  );
}

function IcSettings({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </Svg>
  );
}

// CourtLens brand mark for the FAB icon (mini court lines)
function IcCourt({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke={color}
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <G>
        <Rect x="2" y="3" width="10" height="8" rx={0.4} />
        <Line x1="7" y1="3" x2="7" y2="11" strokeWidth={1.3} />
        <Line x1="2" y1="7" x2="12" y2="7" />
      </G>
    </Svg>
  );
}

type TabKey = 'index' | 'history' | 'new' | 'report' | 'settings';

const TABS: { key: TabKey; route: string; label: string; primary?: boolean }[] = [
  { key: 'index', route: '/(tabs)/', label: 'ホーム' },
  { key: 'history', route: '/(tabs)/history', label: '履歴' },
  { key: 'new', route: '/session/new', label: '新規', primary: true },
  { key: 'report', route: '/(tabs)/report', label: 'レポート' },
  { key: 'settings', route: '/(tabs)/settings', label: '設定' },
];

export function CustomTabBar({ state }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const activeRouteName = state.routes[state.index]?.name ?? 'index';

  const IconComponents: Record<string, typeof IcHome> = {
    index: IcHome,
    history: IcHistory,
    new: IcPlus,
    report: IcChart,
    settings: IcSettings,
  };

  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 0 : 0);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.tabBg,
          borderTopColor: colors.tabBorder,
          paddingBottom: bottomPad + 8,
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = activeRouteName === tab.key;
        const isPrimary = tab.primary === true;
        const IconComp = IconComponents[tab.key];
        const color = isPrimary ? colors.surface : isActive ? colors.primary : colors.textMuted;

        return (
          <TouchableOpacity
            key={tab.key}
            accessibilityLabel={tab.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive && !isPrimary }}
            activeOpacity={0.7}
            style={styles.tab}
            onPress={() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              router.push((isPrimary ? '/session/new' : tab.route) as any);
            }}
          >
            {isPrimary ? (
              <View style={[styles.fab, { backgroundColor: colors.primary }]}>
                <IcCourt color={colors.surface} size={16} />
              </View>
            ) : (
              <IconComp color={color} size={22} />
            )}
            <Text
              style={[
                styles.tabLabel,
                {
                  color,
                  fontWeight: isActive && !isPrimary ? '600' : '500',
                },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 0.5,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
  },
  fab: {
    width: 44,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F6F4A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.33,
    shadowRadius: 8,
    elevation: 4,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.02,
  },
});
