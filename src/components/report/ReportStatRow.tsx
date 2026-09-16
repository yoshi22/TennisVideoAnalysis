import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontFamily, useTheme } from '@/theme';

export interface ReportStatItem {
  label: string;
  value: string;
  color: string;
}

interface ReportStatRowProps {
  items: ReportStatItem[];
  style?: StyleProp<ViewStyle>;
  cellGap?: number;
  padded?: boolean;
}

export function ReportStatRow({ items, style, cellGap = 0, padded = false }: ReportStatRowProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.statsRow,
        padded ? styles.statsRowPadded : styles.statsRowCompact,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {items.map((stat, index) => (
        <View
          key={stat.label}
          style={[
            styles.statCell,
            { gap: cellGap },
            index < items.length - 1 && {
              borderRightColor: colors.border,
              borderRightWidth: 0.5,
            },
          ]}
        >
          <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
          <Text
            style={[styles.statLabel, { color: colors.textMuted, marginTop: cellGap > 0 ? 0 : 4 }]}
          >
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    borderRadius: 14,
    borderWidth: 0.5,
    flexDirection: 'row',
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  statsRowCompact: {
    padding: 14,
  },
  statsRowPadded: {
    paddingHorizontal: 8,
    paddingVertical: 14,
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontFamily: fontFamily.numeric,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.04,
  },
});
