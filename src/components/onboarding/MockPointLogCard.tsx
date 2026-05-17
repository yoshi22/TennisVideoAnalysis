import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

import { AnnotationCallout } from './AnnotationCallout';

export function MockPointLogCard() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.scoreRow}>
        <Text style={[styles.scoreText, { color: colors.text }]}>3</Text>
        <Text style={[styles.separator, { color: colors.textSub }]}>–</Text>
        <Text style={[styles.scoreText, { color: colors.text }]}>2</Text>
      </View>
      <AnnotationCallout label="得点/失点をタップ" />
      <View style={styles.buttonRow}>
        <View style={[styles.pointButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.pointButtonText, { color: colors.surface }]}>得点</Text>
        </View>
        <View style={[styles.pointButton, { backgroundColor: colors.danger }]}>
          <Text style={[styles.pointButtonText, { color: colors.surface }]}>失点</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    width: 200,
  },
  scoreRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  separator: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pointButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  pointButtonText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
});
