import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

interface SegmentedControlProps<T extends string> {
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  selected,
  onSelect,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.container}>
      {options.map((option) => {
        const isSelected = option.value === selected;

        return (
          <TouchableOpacity
            accessibilityLabel={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            activeOpacity={0.85}
            key={option.value}
            onPress={() => onSelect(option.value)}
            style={[styles.option, isSelected ? styles.selected : styles.unselected]}
          >
            <Text style={[styles.label, isSelected ? styles.selectedText : styles.unselectedText]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    minHeight: 44,
    minWidth: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  selected: {
    backgroundColor: colors.primary,
  },
  unselected: {
    backgroundColor: colors.surfaceHover,
  },
  label: {
    ...typography.bodyStrong,
  },
  selectedText: {
    color: colors.surface,
  },
  unselectedText: {
    color: colors.text,
  },
});
