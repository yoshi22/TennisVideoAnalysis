import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

import { AnnotationCallout } from './AnnotationCallout';

const STATS = [
  { label: '勝率', percent: 72 },
  { label: '1stサーブ', percent: 65 },
] as const;

export function MockReportCard() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.header, { color: colors.text }]}>レポート</Text>
      <View style={styles.statGroup}>
        {STATS.map((stat) => (
          <View key={stat.label} style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.textSub }]}>{stat.label}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${stat.percent}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.percentText, { color: colors.primary }]}>{stat.percent}%</Text>
          </View>
        ))}
      </View>
      <AnnotationCallout direction="up" label="自動でレポートを生成" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    width: 200,
  },
  header: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  statGroup: {
    gap: spacing.sm,
  },
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 14,
    width: 56,
  },
  barTrack: {
    flex: 1,
    height: 6,
  },
  barFill: {
    borderRadius: 3,
    height: 6,
  },
  percentText: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'right',
    width: 30,
  },
});
