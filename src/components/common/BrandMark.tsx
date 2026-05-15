import { StyleSheet, Text, View } from 'react-native';
import { G, Line, Rect, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

interface BrandMarkProps {
  size?: number;
  withText?: boolean;
  color?: string;
}

export function BrandMark({ size = 22, withText = true, color }: BrandMarkProps) {
  const { colors } = useTheme();
  const bg = color ?? colors.primary;
  const iconSize = size * 0.7;

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.logoBox,
          { width: size, height: size, borderRadius: 6, backgroundColor: bg },
        ]}
      >
        <Svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 14 14"
          fill="none"
          stroke={colors.surface}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <G>
            <Rect x="2" y="3" width="10" height="8" rx={0.4} />
            <Line x1="7" y1="3" x2="7" y2="11" strokeWidth={1.3} />
            <Line x1="2" y1="7" x2="12" y2="7" />
          </G>
        </Svg>
      </View>
      {withText && <Text style={[styles.wordmark, { color: colors.text }]}>CourtLens</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBox: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wordmark: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
