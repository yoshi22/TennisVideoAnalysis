import { StyleSheet, Text, View } from 'react-native';
import { Circle, Line, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { spacing, useTheme } from '@/theme';

export function MockCalibrationCard() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.header, { color: colors.text }]}>コート較正</Text>
      <Svg height={118} viewBox="0 0 200 118" width={200}>
        <Rect
          fill={colors.primaryLo}
          height={84}
          rx={6}
          stroke={colors.primary}
          strokeWidth={2}
          width={168}
          x={16}
          y={16}
        />
        <Line stroke={colors.primary} strokeWidth={1.5} x1={16} x2={184} y1={58} y2={58} />
        <Line stroke={colors.primary} strokeWidth={1} x1={58} x2={58} y1={16} y2={100} />
        <Line stroke={colors.primary} strokeWidth={1} x1={142} x2={142} y1={16} y2={100} />
        <Circle cx={16} cy={100} fill={colors.primary} r={5} />
        <Circle cx={16} cy={16} fill={colors.primary} r={5} />
        <Circle cx={184} cy={100} fill={colors.primary} r={5} />
        <Circle cx={184} cy={16} fill={colors.primary} r={5} />
        <SvgText fill={colors.textSub} fontSize={9} x={4} y={114}>
          手前左
        </SvgText>
        <SvgText fill={colors.textSub} fontSize={9} x={4} y={10}>
          奥左
        </SvgText>
        <SvgText fill={colors.textSub} fontSize={9} textAnchor="end" x={196} y={114}>
          手前右
        </SvgText>
        <SvgText fill={colors.textSub} fontSize={9} textAnchor="end" x={196} y={10}>
          奥右
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    width: 200,
  },
  header: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
});
