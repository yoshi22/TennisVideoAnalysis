import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { OUTCOME_LABELS } from '@/constants/labels';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { type TimestampedPoint } from '@/hooks/useSessionVideo';
import { fontFamily, useTheme } from '@/theme';
import { formatSeconds } from '@/utils/formatTime';
import { getPointDetailStatus } from '@/utils/pointDetails';

interface VideoPointRowProps {
  item: TimestampedPoint;
  index: number;
  total: number;
  isSelected: boolean;
  onSelect: (point: TimestampedPoint) => void;
}

export function VideoPointRow({ item, index, total, isSelected, onSelect }: VideoPointRowProps) {
  const { colors } = useTheme();
  const isWon = item.outcome === 'won';

  return (
    <TouchableOpacity
      accessibilityLabel={`${formatSeconds(item.videoTimestamp)}のポイントを動画で確認`}
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={() => onSelect(item)}
      style={[
        styles.pointRow,
        {
          backgroundColor: isSelected ? colors.primaryLo : colors.surface,
          borderBottomColor: colors.border,
          borderBottomWidth: index === total - 1 ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View
        style={[styles.pointDot, { backgroundColor: isWon ? colors.primary : colors.danger }]}
      />
      <Text style={[styles.pointTime, { color: colors.text }]}>
        {formatSeconds(item.videoTimestamp)}
      </Text>
      <View style={styles.pointBody}>
        <Text style={[styles.pointTitle, { color: colors.text }]} numberOfLines={1}>
          {item.shotType ? SHOT_TYPE_META[item.shotType].label : '詳細未入力'}
        </Text>
        <Text
          style={[
            styles.pointOutcome,
            {
              color:
                getPointDetailStatus(item) === 'quick'
                  ? colors.warning
                  : isWon
                    ? colors.primary
                    : colors.danger,
            },
          ]}
        >
          {getPointDetailStatus(item) === 'quick' ? '後で補完' : OUTCOME_LABELS[item.outcome]}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pointRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pointDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  pointTime: {
    fontFamily: fontFamily.numeric,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    width: 48,
  },
  pointBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  pointTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  pointOutcome: {
    fontSize: 12,
    fontWeight: '700',
  },
});
