import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

export function MockRallyIntervalCard() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.markChip,
          { backgroundColor: colors.primaryLo, borderColor: colors.primary },
        ]}
      >
        <Text style={[styles.markText, { color: colors.primary }]}>▶ ラリー開始 00:42</Text>
      </View>
      <View style={[styles.intervalBar, { backgroundColor: colors.primaryLo }]}>
        <View style={[styles.intervalFill, { backgroundColor: colors.primary }]} />
        <Text style={[styles.intervalLabel, { color: colors.primary }]}>00:42〜00:58</Text>
      </View>
      <View style={styles.buttonRow}>
        <View style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={[styles.buttonText, { color: colors.surface }]}>得点</Text>
        </View>
        <View style={[styles.button, { backgroundColor: colors.danger }]}>
          <Text style={[styles.buttonText, { color: colors.surface }]}>失点</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    width: 220,
  },
  markChip: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  markText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  intervalBar: {
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
  },
  intervalFill: {
    borderRadius: 6,
    bottom: 0,
    left: 0,
    opacity: 0.25,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  intervalLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    opacity: 0.65,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
