import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '@/theme';

export default function NotFoundScreen() {
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'ページが見つかりません' }} />
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <Text style={[typography.h2, { color: colors.text }]}>このページは存在しません</Text>
        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>ホームに戻る</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  link: {
    marginTop: spacing.md,
  },
  linkText: {
    ...typography.body,
  },
});
