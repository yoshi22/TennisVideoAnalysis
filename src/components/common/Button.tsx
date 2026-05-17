import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 's' | 'm' | 'l';
type Tone = 'default' | 'danger';

interface ButtonProps {
  label?: string;
  children?: ReactNode;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  tone?: Tone;
}

export function Button({
  label,
  children,
  onPress,
  variant = 'primary',
  size = 'm',
  disabled,
  loading,
  full,
  style,
  accessibilityLabel,
  tone = 'default',
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled === true || loading === true;

  const bgColor =
    variant === 'primary'
      ? tone === 'danger'
        ? colors.danger
        : colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'ghost'
          ? 'transparent'
          : colors.surfaceAlt;

  const textColor =
    variant === 'primary' || variant === 'danger'
      ? colors.surface
      : variant === 'ghost'
        ? tone === 'danger'
          ? colors.danger
          : colors.primary
        : colors.text;

  const borderColor =
    variant === 'ghost' && tone === 'danger'
      ? colors.danger
      : variant === 'ghost'
        ? colors.border
        : bgColor;
  const fontSize = size === 's' ? 13 : size === 'l' ? 16 : 14;
  const paddingV = size === 's' ? 8 : size === 'l' ? 14 : 10;
  const paddingH = size === 's' ? 12 : size === 'l' ? 20 : 16;

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      activeOpacity={0.85}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          backgroundColor: bgColor,
          borderColor,
          borderWidth: variant === 'ghost' ? 1 : 0,
          paddingVertical: paddingV,
          paddingHorizontal: paddingH,
          width: full ? '100%' : undefined,
        },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading === true ? (
        <ActivityIndicator
          color={variant === 'secondary' ? colors.text : colors.surface}
          size="small"
          style={styles.indicator}
        />
      ) : null}
      <Text style={[styles.label, { fontSize, color: textColor }]}>{label ?? children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderRadius: 10,
    minHeight: 44,
  },
  disabled: {
    opacity: 0.5,
  },
  indicator: {
    marginRight: 8,
  },
  label: {
    fontWeight: '600',
  },
});
