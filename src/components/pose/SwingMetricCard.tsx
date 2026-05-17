import { StyleSheet, Text, View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';
import { type SwingMetric, type SwingRating } from '@/types';

interface SwingMetricCardProps {
  metric: SwingMetric;
}

function getRatingColor(rating: SwingRating, colors: ColorTokens): string {
  if (rating === 'good') return colors.primary;
  if (rating === 'fair') return colors.warning;
  return colors.danger;
}

function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function SwingMetricCard({ metric }: SwingMetricCardProps) {
  const { colors } = useTheme();
  const ratingColor = getRatingColor(metric.rating, colors);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderLeftColor: ratingColor,
          shadowColor: colors.text,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.text }]}>{metric.label}</Text>
        <Text style={[styles.value, { color: ratingColor }]}>
          {formatMetricValue(metric.value)}
          {metric.unit ?? ''}
        </Text>
      </View>
      <Text style={[styles.comment, { color: colors.textSub }]}>{metric.comment}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    borderLeftWidth: 4,
    elevation: 1,
    gap: 8,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  value: {
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  comment: {
    fontSize: 12,
    lineHeight: 18,
  },
});
