import { StyleSheet, Text, View } from 'react-native';
import { Polygon, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

interface AnnotationCalloutProps {
  label: string;
  direction?: 'up' | 'down';
}

export function AnnotationCallout({ label, direction = 'down' }: AnnotationCalloutProps) {
  const { colors } = useTheme();
  const points = direction === 'down' ? '0,0 8,0 4,6' : '0,6 8,6 4,0';

  return (
    <View style={styles.container}>
      {direction === 'up' ? (
        <Svg height={6} width={8}>
          <Polygon fill={colors.primary} points={points} />
        </Svg>
      ) : null}
      <View style={[styles.pill, { backgroundColor: colors.primaryLo }]}>
        <Text style={[styles.label, { color: colors.primary }]}>{label}</Text>
      </View>
      {direction === 'down' ? (
        <Svg height={6} width={8}>
          <Polygon fill={colors.primary} points={points} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  pill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 14,
  },
});
