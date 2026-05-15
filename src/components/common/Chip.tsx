import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/theme';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  size?: 'sm' | 'md';
  /** Legacy color prop — accepted for compat; selection color is now always primary */
  color?: string;
}

export function Chip({ label, selected, onPress, accessibilityLabel, size = 'md' }: ChipProps) {
  const { colors } = useTheme();
  const isSelected = selected === true;

  const chipStyle = [
    styles.base,
    size === 'sm' ? styles.sm : styles.md,
    {
      backgroundColor: isSelected ? colors.primary : colors.surface,
      borderColor: isSelected ? colors.primary : colors.border,
    },
  ];

  const labelStyle = [
    size === 'sm' ? styles.labelSm : styles.labelMd,
    { color: isSelected ? colors.surface : colors.text },
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        activeOpacity={0.85}
        onPress={onPress}
        style={chipStyle}
      >
        <Text style={labelStyle}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View accessibilityLabel={accessibilityLabel ?? label} style={chipStyle}>
      <Text style={labelStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 0.5,
  },
  md: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 36,
  },
  sm: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 30,
  },
  labelMd: {
    fontSize: 13,
    fontWeight: '600',
  },
  labelSm: {
    fontSize: 12,
    fontWeight: '600',
  },
});
