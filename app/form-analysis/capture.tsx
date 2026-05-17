import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { normalizeFormShotTypeParam } from '@/components/pose';
import { VideoRecorder } from '@/components/video/VideoRecorder';
import { analyzeClip } from '@/services/pose';
import { useFormAnalysisStore } from '@/stores';
import { useTheme } from '@/theme';

export default function CaptureFormAnalysisScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const shotType = normalizeFormShotTypeParam(params.shotType);
  const mountedRef = useRef(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runAnalysis = useCallback(
    async (videoUri: string) => {
      setIsAnalyzing(true);
      setProgress(0);

      try {
        const result = await analyzeClip({
          videoUri,
          startSec: 0,
          endSec: 8,
          shotType,
          onProgress: (value) => {
            if (mountedRef.current) {
              setProgress(Math.max(0, Math.min(1, value)));
            }
          },
        });

        if (!mountedRef.current) return;

        useFormAnalysisStore.getState().addAnalysis(result);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.replace({ pathname: '/form-analysis/[id]', params: { id: result.id } } as any);
      } catch {
        if (!mountedRef.current) return;

        setIsAnalyzing(false);
        Alert.alert('解析に失敗しました', '動画を確認して、もう一度お試しください。', [
          { text: 'キャンセル', style: 'cancel' },
          { text: '再試行', onPress: () => void runAnalysis(videoUri) },
        ]);
      }
    },
    [router, shotType]
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <VideoRecorder onCancel={() => router.back()} onRecorded={(uri) => void runAnalysis(uri)} />

      {isAnalyzing ? (
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <View style={styles.overlayContent}>
            <ActivityIndicator color={colors.surface} size="large" />
            <Text style={[styles.overlayTitle, { color: colors.surface }]}>解析中...</Text>
            <View
              accessibilityLabel="解析の進捗"
              style={[styles.progressTrack, { backgroundColor: withAlpha(colors.surface, 0.28) }]}
            >
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: colors.surface, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.surface }]}>
              {Math.round(progress * 100)}%
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  overlayContent: {
    alignItems: 'center',
    gap: 14,
    width: '100%',
  },
  overlayTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  progressTrack: {
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
});
