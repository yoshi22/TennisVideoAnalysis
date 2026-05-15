import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/common';
import { colors, spacing } from '@/theme';
import { type ResultReason } from '@/types';

interface ResultReasonPickerProps {
  selected?: ResultReason;
  onSelect: (reason: ResultReason) => void;
}

const RESULT_REASONS: { reason: ResultReason; label: string; color: string }[] = [
  { reason: 'winner', label: 'ウィナー', color: colors.success },
  { reason: 'forcedError', label: 'フォースドエラー', color: colors.warning },
  { reason: 'unforcedError', label: 'アンフォースドエラー', color: colors.danger },
  { reason: 'net', label: 'ネット', color: colors.navyLight },
  { reason: 'out', label: 'アウト', color: colors.softAccent },
];

export function ResultReasonPicker({ selected, onSelect }: ResultReasonPickerProps) {
  return (
    <View style={styles.container}>
      {RESULT_REASONS.map((item) => (
        <Chip
          accessibilityLabel={`結果理由 ${item.label}`}
          color={item.color}
          key={item.reason}
          label={item.label}
          onPress={() => onSelect(item.reason)}
          selected={selected === item.reason}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
