import { ScrollView, StyleSheet } from 'react-native';

import { Chip } from '@/components/common';
import { SERVE_RESULT_META, SERVE_RESULTS } from '@/constants/serveResults';
import { spacing } from '@/theme';
import { type ServeResult } from '@/types';

interface ServeResultPickerProps {
  selected?: ServeResult;
  onSelect: (result: ServeResult) => void;
}

export function ServeResultPicker({ selected, onSelect }: ServeResultPickerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {SERVE_RESULTS.map((result) => {
        const meta = SERVE_RESULT_META[result];

        return (
          <Chip
            accessibilityLabel={`サーブ結果 ${meta.label}`}
            color={meta.color}
            key={result}
            label={meta.label}
            onPress={() => onSelect(result)}
            selected={selected === result}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
