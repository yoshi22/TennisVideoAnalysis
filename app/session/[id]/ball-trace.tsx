import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, EmptyState, SecondSlider, SectionHeader } from '@/components/common';
import { BallTraceOverlay } from '@/components/court';
import { analyzeRally, detectRallyWindows, type RallyWindow } from '@/services/ball';
import { extractStillFrame, type StillFrame } from '@/services/pose/frameSampler';
import { useSessionStore } from '@/stores';
import { useTheme } from '@/theme';
import { type BallTrajectory, type Bounce } from '@/types';

interface RallyResult {
  trajectory: BallTrajectory;
  bounces: Bounce[];
  peakSpeedKmh: number | null;
}

const SLIDER_MIN = 0;
const SLIDER_MAX = 60;
const SLIDER_STEP = 0.5;
const CANVAS_WIDTH = Dimensions.get('window').width - 40;
const CANVAS_HEIGHT = CANVAS_WIDTH * 0.75;

function getParamId(id: string | string[] | undefined): string {
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatWindowLabel(window: RallyWindow): string {
  const confidence =
    window.confidence >= 0.7 ? '高信頼' : window.confidence >= 0.4 ? '中信頼' : '低信頼';
  return `${formatSeconds(window.startSec)}〜${formatSeconds(window.endSec)} (${confidence})`;
}

export default function BallTraceScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === sessionId));
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(10);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<RallyResult | null>(null);
  const [thumbnail, setThumbnail] = useState<StillFrame | null>(null);
  const [detectedWindows, setDetectedWindows] = useState<RallyWindow[]>([]);

  const resetResult = () => {
    setResult(null);
    setThumbnail(null);
  };

  const handleStartChange = (value: number) => {
    setStartSec(Math.min(value, endSec - SLIDER_STEP));
    resetResult();
  };

  const handleEndChange = (value: number) => {
    setEndSec(Math.max(value, startSec + SLIDER_STEP));
    resetResult();
  };

  const handleAnalyze = async () => {
    if (!session?.videoUri || endSec <= startSec) {
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setResult(null);
    setThumbnail(null);

    try {
      const [rally, frame] = await Promise.all([
        analyzeRally({
          videoUri: session.videoUri,
          startSec,
          endSec,
          calibration: session.courtCalibration,
          onProgress: (value) => setProgress(Math.max(0, Math.min(1, value))),
        }),
        extractStillFrame(session.videoUri, startSec),
      ]);

      setResult({
        trajectory: rally.trajectory,
        bounces: rally.bounces,
        peakSpeedKmh: rally.peakSpeedKmh,
      });
      setThumbnail(frame);
    } catch {
      Alert.alert(
        '解析に失敗しました',
        '範囲、動画、コート較正を確認して、もう一度お試しください。'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAutoSegment = async () => {
    if (!session?.videoUri || !session.courtCalibration) {
      return;
    }

    const controller = new AbortController();
    setIsSegmenting(true);
    setProgress(0);
    setDetectedWindows([]);
    resetResult();

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec: 60,
        onProgress: (value) => setProgress(Math.max(0, Math.min(1, value))),
        signal: controller.signal,
      });
      setDetectedWindows(windows);
    } catch {
      Alert.alert('自動分割に失敗しました', '動画とコート較正を確認して、もう一度お試しください。');
    } finally {
      setIsSegmenting(false);
    }
  };

  const inBoundsCount = result?.bounces.filter((bounce) => bounce.inBounds).length ?? 0;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'ボール軌跡解析',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.surface} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      {!session ? (
        <View style={styles.emptyWrapper}>
          <EmptyState icon="alert-circle-outline" title="セッションが見つかりません" />
        </View>
      ) : !session.videoUri ? (
        <View style={styles.emptyWrapper}>
          <EmptyState
            action={{ label: '戻る', onPress: () => router.back() }}
            description="ボール軌跡解析にはセッション動画が必要です。"
            title="動画がありません"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View>
            <SectionHeader title="自動分割" />
            <View
              style={[
                styles.card,
                styles.segmentCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Button
                accessibilityLabel="ラリーを自動分割"
                disabled={isAnalyzing || isSegmenting || !session.courtCalibration}
                label="自動分割"
                loading={isSegmenting}
                onPress={() => void handleAutoSegment()}
                size="l"
              />
              {!session.courtCalibration ? (
                <Text style={[styles.segmentHint, { color: colors.textMuted }]}>
                  自動分割にはコート較正が必要です。
                </Text>
              ) : null}
              {detectedWindows.length > 0 ? (
                <ScrollView
                  contentContainerStyle={styles.windowChipContent}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {detectedWindows.map((window) => (
                    <Chip
                      accessibilityLabel={`${formatWindowLabel(window)}を解析範囲に設定`}
                      key={`${window.startSec}-${window.endSec}`}
                      label={formatWindowLabel(window)}
                      onPress={() => {
                        setStartSec(window.startSec);
                        setEndSec(window.endSec);
                        resetResult();
                      }}
                      selected={
                        Math.abs(startSec - window.startSec) < 0.01 &&
                        Math.abs(endSec - window.endSec) < 0.01
                      }
                      size="sm"
                    />
                  ))}
                </ScrollView>
              ) : null}
            </View>
          </View>

          <View>
            <SectionHeader title="解析範囲" />
            <View
              style={[
                styles.card,
                styles.rangeCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <SecondSlider
                label="開始"
                max={SLIDER_MAX}
                min={SLIDER_MIN}
                onChange={handleStartChange}
                step={SLIDER_STEP}
                value={startSec}
              />
              <SecondSlider
                label="終了"
                max={SLIDER_MAX}
                min={SLIDER_MIN}
                onChange={handleEndChange}
                step={SLIDER_STEP}
                value={endSec}
              />
              <Button
                accessibilityLabel="ボール軌跡を解析"
                disabled={isAnalyzing || isSegmenting || endSec <= startSec}
                label="解析"
                loading={isAnalyzing}
                onPress={() => void handleAnalyze()}
                size="l"
              />
            </View>
          </View>

          {isAnalyzing || isSegmenting ? (
            <View
              style={[
                styles.card,
                styles.progressCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.progressLabel, { color: colors.text }]}>
                {isSegmenting ? '自動分割中...' : '解析中...'}
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: colors.surfaceAlt }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.progressText, { color: colors.textMuted }]}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
          ) : null}

          {result && thumbnail ? (
            <View>
              <SectionHeader title="解析結果" />
              <View
                style={[
                  styles.card,
                  styles.overlayCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <BallTraceOverlay
                  bounces={result.bounces}
                  height={CANVAS_HEIGHT}
                  imageUri={thumbnail.uri}
                  trajectory={result.trajectory}
                  width={CANVAS_WIDTH}
                />
                <Text style={[styles.resultText, { color: colors.text }]}>
                  バウンド検出: {result.bounces.length} 回 (インバウンド {inBoundsCount} 回)
                </Text>
                {result.peakSpeedKmh !== null ? (
                  <Text style={[styles.speedText, { color: colors.primary }]}>
                    ピーク速度: {Math.round(result.peakSpeedKmh)} km/h
                  </Text>
                ) : null}
                {result.bounces.length === 0 ? (
                  <Text style={[styles.warningText, { color: colors.danger }]}>
                    ボールを検出できませんでした。コート較正を確認するか、撮影条件を改善してください。
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View
            style={[
              styles.card,
              styles.noteCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.noteText, { color: colors.textMuted }]}>
              精度が低い場合はコート較正を見直してください。
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    gap: 18,
    paddingBottom: 48,
    paddingTop: 20,
  },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    marginHorizontal: 20,
    padding: 14,
  },
  rangeCard: {
    gap: 16,
  },
  segmentCard: {
    gap: 12,
  },
  segmentHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  windowChipContent: {
    gap: 8,
    paddingRight: 8,
  },
  progressCard: {
    alignItems: 'center',
    gap: 10,
  },
  progressLabel: {
    fontSize: 14,
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
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  overlayCard: {
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    padding: 0,
    paddingBottom: 14,
  },
  resultText: {
    alignSelf: 'stretch',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  speedText: {
    alignSelf: 'stretch',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  warningText: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    paddingHorizontal: 14,
  },
  noteCard: {
    padding: 14,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 20,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
