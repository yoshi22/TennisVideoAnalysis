import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '@/theme';

import { Button } from './Button';

interface ErrorFallbackProps {
  eventId?: string;
  resetError: () => void;
}

export function ErrorFallback({ eventId, resetError }: ErrorFallbackProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>問題が発生しました</Text>
        <Text style={[styles.body, { color: colors.textSub }]}>
          アプリで予期しないエラーが起きました。再試行しても戻らない場合は、少し時間をおいてお試しください。
        </Text>
        {eventId ? (
          <Text style={[styles.eventId, { color: colors.textMuted }]}>Error ID: {eventId}</Text>
        ) : null}
        <Button label="再試行" onPress={resetError} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  content: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  eventId: {
    ...typography.caption,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    minWidth: 140,
  },
});
