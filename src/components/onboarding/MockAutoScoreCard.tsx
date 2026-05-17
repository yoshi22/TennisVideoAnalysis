import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

export function MockAutoScoreCard() {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.badge, { color: colors.primary }]}>自動採点候補</Text>
      <Text style={[styles.body, { color: colors.text }]}>
        ボール軌跡から判定: 相手側 2 バウンド → 得点
      </Text>
      <View style={styles.actions}>
        <View style={[styles.button, { backgroundColor: colors.success }]}>
          <Text style={[styles.buttonText, { color: colors.surface }]}>採用して保存</Text>
        </View>
        <View style={[styles.button, styles.rejectButton, { borderColor: colors.danger }]}>
          <Text style={[styles.rejectText, { color: colors.danger }]}>棄却</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 0.5,
    gap: spacing.sm,
    padding: spacing.md,
    width: 220,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  body: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 30,
    justifyContent: 'center',
    opacity: 0.65,
  },
  rejectButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rejectText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
