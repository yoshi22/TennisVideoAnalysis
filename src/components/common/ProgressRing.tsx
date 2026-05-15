import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Circle, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

interface ProgressRingProps {
  value?: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}

export function ProgressRing({
  value = 0,
  size = 56,
  stroke = 6,
  color,
  track,
  children,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const c = color ?? colors.primary;
  const t = track ?? colors.surfaceAlt;

  return (
    <View style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
        rotation="-90"
        origin={`${size / 2}, ${size / 2}`}
      >
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={c}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference - circumference * pct}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
