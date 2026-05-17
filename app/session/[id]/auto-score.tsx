import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Button,
  EmptyState,
  SecondSlider,
  SectionHeader,
  SegmentedControl,
} from '@/components/common';
import { AutoPointCard } from '@/components/scoring';
import { useSession } from '@/hooks';
import { analyzeRally, analyzeRallyBatch, detectRallyWindows } from '@/services/ball';
import { proposeCandidates } from '@/services/scoring';
import { useSessionStore } from '@/stores';
import { useTheme } from '@/theme';
import { type AutoPointCandidate, type PointRecord } from '@/types';

type PlayerSideValue = 'near' | 'far';
type ServeMode = 'yes' | 'no';
type ServeAttemptValue = '1' | '2';

const SLIDER_MIN = 0;
const SLIDER_MAX = 60;
const SLIDER_STEP = 0.5;

const PLAYER_SIDE_OPTIONS: { label: string; value: PlayerSideValue }[] = [
  { label: '手前', value: 'near' },
  { label: '奥', value: 'far' },
];

const SERVE_MODE_OPTIONS: { label: string; value: ServeMode }[] = [
  { label: 'いいえ', value: 'no' },
  { label: 'はい', value: 'yes' },
];

const SERVE_ATTEMPT_OPTIONS: { label: string; value: ServeAttemptValue }[] = [
  { label: '1st', value: '1' },
  { label: '2nd', value: '2' },
];

function isPointRecord(point: Partial<PointRecord>): point is PointRecord {
  return (
    typeof point.id === 'string' &&
    typeof point.sessionId === 'string' &&
    typeof point.timestamp === 'string' &&
    (point.outcome === 'won' || point.outcome === 'lost') &&
    typeof point.shotType === 'string' &&
    typeof point.resultReason === 'string' &&
    typeof point.rallyCount === 'number'
  );
}

export default function AutoScoreScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, sessionId } = useSession();
  const addPoint = useSessionStore((state) => state.addPoint);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(10);
  const [playerSide, setPlayerSide] = useState<PlayerSideValue>('near');
  const [serveMode, setServeMode] = useState<ServeMode>('no');
  const [serveAttempt, setServeAttempt] = useState<ServeAttemptValue>('1');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [candidates, setCandidates] = useState<AutoPointCandidate[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const resetCandidates = () => {
    setCandidates([]);
    setHasAnalyzed(false);
  };

  const handleStartChange = (value: number) => {
    setStartSec(Math.min(value, endSec - SLIDER_STEP));
    resetCandidates();
  };

  const handleEndChange = (value: number) => {
    setEndSec(Math.max(value, startSec + SLIDER_STEP));
    resetCandidates();
  };

  const handleAnalyze = async () => {
    if (!session?.videoUri || !session.courtCalibration || endSec <= startSec || isAutoDetecting) {
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);

    try {
      const rally = await analyzeRally({
        videoUri: session.videoUri,
        startSec,
        endSec,
        calibration: session.courtCalibration,
        onProgress: (value) => setProgress(Math.max(0, Math.min(1, value))),
      });
      const proposed = proposeCandidates(rally, {
        playerSide,
        isServe: serveMode === 'yes',
        serveAttempt: serveAttempt === '1' ? 1 : 2,
      });

      setCandidates(proposed);
      setHasAnalyzed(true);
    } catch {
      Alert.alert(
        '解析に失敗しました',
        '範囲、動画、コート較正を確認して、もう一度お試しください。'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAutoDetectBatch = async () => {
    if (!session?.videoUri || !session.courtCalibration || isAnalyzing) {
      return;
    }

    const controller = new AbortController();
    setIsAutoDetecting(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec: 60,
        onProgress: (value) => setProgress(Math.max(0, Math.min(0.35, value * 0.35))),
        signal: controller.signal,
      });

      const results = await analyzeRallyBatch(windows, {
        videoUri: session.videoUri,
        calibration: session.courtCalibration,
        onProgress: (value) => setProgress(Math.max(0.35, Math.min(1, 0.35 + value * 0.65))),
        signal: controller.signal,
      });

      const allCandidates = results.flatMap(({ result }) =>
        proposeCandidates(result, {
          playerSide,
          isServe: serveMode === 'yes',
          serveAttempt: serveAttempt === '1' ? 1 : 2,
        })
      );

      setProgress(1);
      setCandidates(allCandidates);
      setHasAnalyzed(true);
    } catch {
      Alert.alert(
        '一括採点に失敗しました',
        '動画、撮影範囲、コート較正を確認して、もう一度お試しください。'
      );
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleAcceptCandidate = (candidateId: string, point: Partial<PointRecord>) => {
    if (!isPointRecord(point)) {
      Alert.alert('保存に失敗しました', '採点候補の内容を確認してください。');
      return;
    }

    addPoint(sessionId, point);
    setCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
  };

  const removeCandidate = (candidateId: string) => {
    setCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '自動採点（実験的）',
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
            description="自動採点にはセッション動画が必要です。"
            title="動画がありません"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.card,
              styles.disclaimerCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.disclaimerText, { color: colors.text }]}>
              自動採点は参考値です。保存前に必ず内容を確認してください。
            </Text>
          </View>

          {!session.courtCalibration ? (
            <View
              style={[
                styles.card,
                styles.calibrationCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.calibrationTitle, { color: colors.text }]}>
                コート較正が必要です
              </Text>
              <Text style={[styles.calibrationText, { color: colors.textMuted }]}>
                動画からポイント候補を生成する前にコート座標を設定してください。
              </Text>
              <Button
                accessibilityLabel="コート較正を開く"
                label="コート較正を開く"
                onPress={() => {
                  router.push(
                    `/session/${session.id}/calibration` as Parameters<typeof router.push>[0]
                  );
                }}
                variant="secondary"
              />
            </View>
          ) : null}

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
            </View>
          </View>

          <View>
            <SectionHeader title="採点条件" />
            <View
              style={[
                styles.card,
                styles.optionsCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.optionGroup}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>プレイヤー位置</Text>
                <SegmentedControl
                  accessibilityLabel="プレイヤー位置"
                  onSelect={setPlayerSide}
                  options={PLAYER_SIDE_OPTIONS}
                  selected={playerSide}
                />
              </View>

              <View style={styles.optionGroup}>
                <Text style={[styles.optionLabel, { color: colors.text }]}>サーブ</Text>
                <SegmentedControl
                  accessibilityLabel="サーブかどうか"
                  onSelect={setServeMode}
                  options={SERVE_MODE_OPTIONS}
                  selected={serveMode}
                />
              </View>

              {serveMode === 'yes' ? (
                <View style={styles.optionGroup}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>サーブ試行</Text>
                  <SegmentedControl
                    accessibilityLabel="サーブ試行"
                    onSelect={setServeAttempt}
                    options={SERVE_ATTEMPT_OPTIONS}
                    selected={serveAttempt}
                  />
                </View>
              ) : null}

              <Button
                accessibilityLabel="自動ラリー検出から一括採点"
                disabled={isAnalyzing || isAutoDetecting || !session.courtCalibration}
                label="自動ラリー検出 → 一括採点"
                loading={isAutoDetecting}
                onPress={() => void handleAutoDetectBatch()}
                size="l"
                variant="secondary"
              />

              <Button
                accessibilityLabel="解析して採点候補を生成"
                disabled={
                  isAnalyzing || isAutoDetecting || !session.courtCalibration || endSec <= startSec
                }
                label="解析して採点候補を生成"
                loading={isAnalyzing}
                onPress={() => void handleAnalyze()}
                size="l"
              />
            </View>
          </View>

          {isAnalyzing || isAutoDetecting ? (
            <View
              style={[
                styles.card,
                styles.progressCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.progressLabel, { color: colors.text }]}>
                {isAutoDetecting ? '自動検出と一括採点中...' : '解析中...'}
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

          {hasAnalyzed && candidates.length === 0 && !isAnalyzing && !isAutoDetecting ? (
            <View
              style={[
                styles.card,
                styles.emptyCandidateCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.emptyCandidateText, { color: colors.textMuted }]}>
                採点候補がありません。バウンドが検出できませんでした。
              </Text>
            </View>
          ) : null}

          {candidates.length > 0 ? (
            <View>
              <SectionHeader title="採点候補" />
              <View style={styles.candidateList}>
                {candidates.map((candidate) => (
                  <AutoPointCard
                    candidate={candidate}
                    key={candidate.id}
                    onAccept={(point) => handleAcceptCandidate(candidate.id, point)}
                    onReject={() => removeCandidate(candidate.id)}
                    sessionId={sessionId}
                  />
                ))}
              </View>
            </View>
          ) : null}
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
  disclaimerCard: {
    padding: 14,
  },
  disclaimerText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
  },
  calibrationCard: {
    gap: 10,
  },
  calibrationTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  calibrationText: {
    fontSize: 13,
    lineHeight: 20,
  },
  rangeCard: {
    gap: 16,
  },
  optionsCard: {
    gap: 18,
  },
  optionGroup: {
    gap: 8,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '700',
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
  emptyCandidateCard: {
    alignItems: 'center',
  },
  emptyCandidateText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  candidateList: {
    gap: 10,
    paddingHorizontal: 20,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
