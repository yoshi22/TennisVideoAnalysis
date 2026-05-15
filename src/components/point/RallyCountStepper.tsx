import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

interface RallyCountStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function RallyCountStepper({ value, onChange, min = 0, max = 99 }: RallyCountStepperProps) {
  const decrementDisabled = value <= min;
  const incrementDisabled = value >= max;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityLabel="ラリー数を減らす"
        accessibilityRole="button"
        accessibilityState={{ disabled: decrementDisabled }}
        activeOpacity={0.8}
        disabled={decrementDisabled}
        onPress={() => onChange(clamp(value - 1, min, max))}
        style={[styles.button, decrementDisabled && styles.disabled]}
      >
        <Text style={styles.buttonText}>-</Text>
      </TouchableOpacity>
      <Text accessibilityLabel={`ラリー数 ${value}`} style={styles.value}>
        {value}
      </Text>
      <TouchableOpacity
        accessibilityLabel="ラリー数を増やす"
        accessibilityRole="button"
        accessibilityState={{ disabled: incrementDisabled }}
        activeOpacity={0.8}
        disabled={incrementDisabled}
        onPress={() => onChange(clamp(value + 1, min, max))}
        style={[styles.button, incrementDisabled && styles.disabled]}
      >
        <Text style={styles.buttonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.surfaceHover,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typography.h2,
    color: colors.text,
  },
  value: {
    ...typography.h2,
    minWidth: 48,
    textAlign: 'center',
  },
});
