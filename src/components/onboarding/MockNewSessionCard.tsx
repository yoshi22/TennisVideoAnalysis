import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

import { AnnotationCallout } from './AnnotationCallout';

export function MockNewSessionCard() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.uploadBox, { borderColor: colors.border }]}>
        <Ionicons color={colors.textMuted} name="camera-outline" size={16} />
        <Text style={[styles.uploadText, { color: colors.textMuted }]}>動画を追加</Text>
      </View>
      <View
        style={[
          styles.inputBox,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.placeholder, { color: colors.textMuted }]}>タイトルを入力…</Text>
      </View>
      <View style={[styles.startButton, { backgroundColor: colors.primary }]}>
        <Text style={[styles.startButtonText, { color: colors.surface }]}>セッション開始</Text>
      </View>
      <AnnotationCallout direction="up" label="タイトル入力後にタップ" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    width: 200,
  },
  uploadBox: {
    alignItems: 'center',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  inputBox: {
    borderRadius: 6,
    borderWidth: 0.5,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  placeholder: {
    fontSize: 10,
    lineHeight: 14,
  },
  startButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
  },
  startButtonText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
});
