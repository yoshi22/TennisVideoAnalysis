import { StyleSheet, Text, View } from 'react-native';
import { Circle, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';
import { type ShotType } from '@/types';

import { getShotTypeLabel } from './constants';

interface FormScoreRingProps {
  score: number;
  shotType: ShotType;
}

export function FormScoreRing({ score, shotType }: FormScoreRingProps) {
  const { colors } = useTheme();
  const size = 168;
  const stroke = 10;
  const radius = 72;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, score));
  const pct = clampedScore / 100;
  const roundedScore = Math.round(clampedScore);

  return (
    <View style={styles.container}>
      <View style={{ width: size, height: size }}>
        <Svg
          height={size}
          origin={`${center}, ${center}`}
          rotation="-90"
          style={StyleSheet.absoluteFill}
          width={size}
        >
          <Circle
            cx={center}
            cy={center}
            fill="none"
            r={radius}
            stroke={colors.border}
            strokeWidth={stroke}
          />
          <Circle
            cx={center}
            cy={center}
            fill="none"
            r={radius}
            stroke={colors.primary}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference - circumference * pct}
            strokeLinecap="round"
            strokeWidth={stroke}
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={[styles.score, { color: colors.text }]}>{roundedScore}</Text>
          <Text style={[styles.scoreUnit, { color: colors.textMuted }]}>点</Text>
        </View>
      </View>
      <Text style={[styles.shotLabel, { color: colors.textSub }]}>
        {getShotTypeLabel(shotType)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontSize: 48,
    fontWeight: '700',
    lineHeight: 54,
    fontVariant: ['tabular-nums'],
  },
  scoreUnit: {
    fontSize: 13,
    fontWeight: '600',
  },
  shotLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
});
