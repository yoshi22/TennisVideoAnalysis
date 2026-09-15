import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fontFamily, spacing, typography, useTheme } from '@/theme';

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
  const { colors } = useTheme();

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
            style={[
              styles.option,
              {
                backgroundColor: isSelected ? colors.primary : colors.surfaceAlt,
              },
            ]}
          >
            <Text style={[styles.label, { color: isSelected ? colors.onHero : colors.text }]}>
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
  label: {
    ...typography.bodyStrong,
    fontFamily: fontFamily.numeric,
  },
});
