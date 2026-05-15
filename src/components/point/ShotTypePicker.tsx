import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/common';
import { SHOT_TYPE_META, SHOT_TYPES } from '@/constants/shotTypes';
import { spacing } from '@/theme';
import { type ShotType } from '@/types';

interface ShotTypePickerProps {
  selected?: ShotType;
  onSelect: (shot: ShotType) => void;
}

export function ShotTypePicker({ selected, onSelect }: ShotTypePickerProps) {
  return (
    <View style={styles.container}>
      {SHOT_TYPES.map((shot) => {
        const meta = SHOT_TYPE_META[shot];

        return (
          <Chip
            accessibilityLabel={`ショット ${meta.label}`}
            color={meta.color}
            key={shot}
            label={meta.label}
            onPress={() => onSelect(shot)}
            selected={selected === shot}
          />
        );
      })}
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
