import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
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
  ScreenHero,
  SecondSlider,
  SectionHeader,
  SegmentedControl,
} from '@/components/common';
import { PointLogSheet } from '@/components/point';
import { AutoPointCard } from '@/components/scoring';
import { useSession } from '@/hooks';
import {
  isCloudAnalysisEnabled,
  runCloudAnalysis,
  type CourtCornersNormalized,
} from '@/services/analysis/cloudAnalyze';
import { cloudResultToRallyAnalysis } from '@/services/analysis/rallyHistory';
import { isVideoUploadConfigured, uploadVideoForAnalysis } from '@/services/analysis/videoUpload';
import { analyzeRally, analyzeRallyBatch, detectRallyWindows } from '@/services/ball';
import { proposeCandidates } from '@/services/scoring';
import { useSessionStore } from '@/stores';
import { fontFamily, useTheme } from '@/theme';
import { type AutoPointCandidate, type PointRecord } from '@/types';
import { generateId } from '@/utils/id';

const CLOUD_ANALYSIS_AVAILABLE = isCloudAnalysisEnabled() && isVideoUploadConfigured();

type PlayerSideValue = 'near' | 'far';
type ServeMode = 'yes' | 'no';
type ServeAttemptValue = '1' | '2';

const SLIDER_MIN = 0;
const SLIDER_STEP = 0.5;
const NUM = fontFamily.numeric;
/** Low-confidence threshold — windows below this are marked 要確認 in the draft summary */
const DRAFT_LOW_CONFIDENCE_THRESHOLD = 0.5;

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

export default function AutoScoreScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const { session, sessionId } = useSession();
  const addPoint = useSessionStore((state) => state.addPoint);
  const addRallyAnalysis = useSessionStore((state) => state.addRallyAnalysis);
  const setVideoDuration = useSessionStore((state) => state.setVideoDuration);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(10);
  const [playerSide, setPlayerSide] = useState<PlayerSideValue>('near');
  const [serveMode, setServeMode] = useState<ServeMode>('no');
  const [serveAttempt, setServeAttempt] = useState<ServeAttemptValue>('1');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isCloudAnalyzing, setIsCloudAnalyzing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [candidates, setCandidates] = useState<AutoPointCandidate[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  /** Number of rally windows added as drafts when running without court calibration. null = not in draft-only mode */
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [confirmingCandidate, setConfirmingCandidate] = useState<AutoPointCandidate | null>(null);
  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);

  const videoPlayer = useVideoPlayer(session?.videoUri ?? null, (p) => {
    p.muted = true;
  });
  const { status: videoStatus } = useEvent(videoPlayer, 'statusChange', {
    status: videoPlayer.status,
  });
  const loadedVideoDurationSec = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : 0;
  const videoDurationSec =
    loadedVideoDurationSec > 0 ? loadedVideoDurationSec : (session?.videoDurationSec ?? 0);
  const canAutoDetect =
    videoStatus === 'readyToPlay' || (Number.isFinite(videoDurationSec) && videoDurationSec > 0);
  // Dynamic slider max: full video duration (floor to 0.5s grid), minimum 60s fallback
  const sliderMax = Math.max(60, Math.ceil(videoDurationSec / SLIDER_STEP) * SLIDER_STEP);

  useEffect(() => {
    if (session && loadedVideoDurationSec > 0) {
      setVideoDuration(session.id, loadedVideoDurationSec);
    }
  }, [loadedVideoDurationSec, session, setVideoDuration]);

  const resetCandidates = () => {
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);
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
      }).map((candidate) => ({
        ...candidate,
        rallyStartSec: startSec,
        rallyEndSec: endSec,
      }));

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
    if (
      !session?.videoUri ||
      isAnalyzing ||
      !Number.isFinite(videoDurationSec) ||
      videoDurationSec <= 0
    ) {
      return;
    }

    const controller = new AbortController();
    setIsAutoDetecting(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec,
        onProgress: (value) => setProgress(Math.max(0, Math.min(0.35, value * 0.35))),
        signal: controller.signal,
      });

      if (!session.courtCalibration) {
        // No calibration — add rally windows as draft PointRecords directly.
        // Outcome is a placeholder ('won'); user must correct each draft in the Video tab.
        for (const win of windows) {
          const midSec = Math.round(((win.startSec + win.endSec) / 2) * 10) / 10;
          const point: PointRecord = {
            id: generateId(),
            sessionId,
            timestamp: new Date().toISOString(),
            outcome: 'won',
            videoTimestamp: midSec,
            source: 'auto',
            confidence: win.confidence,
            reviewStatus: 'draft',
            detailStatus: 'quick',
            rallyStartSec: win.startSec,
            rallyEndSec: win.endSec,
          };
          addPoint(sessionId, point);
        }
        setProgress(1);
        setDraftCount(windows.length);
        setHasAnalyzed(true);
        return;
      }

      const results = await analyzeRallyBatch(windows, {
        videoUri: session.videoUri,
        calibration: session.courtCalibration,
        onProgress: (value) => setProgress(Math.max(0.35, Math.min(1, 0.35 + value * 0.65))),
        signal: controller.signal,
      });

      const allCandidates = results.flatMap(({ window: win, result }) =>
        proposeCandidates(result, {
          playerSide,
          isServe: serveMode === 'yes',
          serveAttempt: serveAttempt === '1' ? 1 : 2,
        }).map((c) => ({ ...c, rallyStartSec: win.startSec, rallyEndSec: win.endSec }))
      );

      setProgress(1);
      setCandidates(allCandidates);
      setHasAnalyzed(true);
    } catch {
      Alert.alert('一括採点に失敗しました', '動画、撮影範囲を確認して、もう一度お試しください。');
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleCloudAnalyze = async () => {
    if (
      !session?.videoUri ||
      !session.courtCalibration ||
      isAnalyzing ||
      isAutoDetecting ||
      isCloudAnalyzing ||
      !Number.isFinite(videoDurationSec) ||
      videoDurationSec <= 0
    ) {
      return;
    }

    const controller = new AbortController();
    setIsCloudAnalyzing(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);
    setCloudStatus('ラリー検出中...');

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec,
        onProgress: (value) => setProgress(Math.max(0, Math.min(0.2, value * 0.2))),
        signal: controller.signal,
      });
      if (windows.length === 0) {
        Alert.alert('ラリーが検出できませんでした', '撮影範囲や動画を確認してください。');
        return;
      }

      const corners = session.courtCalibration.imageCorners.map((p) => [
        p.x,
        p.y,
      ]) as unknown as CourtCornersNormalized;
      const clipId = generateId();

      setCloudStatus('動画をアップロード中...');
      const { videoUrl } = await uploadVideoForAnalysis({
        videoUri: session.videoUri,
        clipId,
        onProgress: (value) => setProgress(Math.max(0.2, Math.min(0.4, 0.2 + value * 0.2))),
      });

      setCloudStatus('クラウド解析中...(数分かかることがあります)');
      const result = await runCloudAnalysis(
        {
          clipId,
          videoUrl,
          courtCorners: corners,
          courtType: 'singles',
          rallies: windows.map((w) => ({ startSec: w.startSec, endSec: w.endSec })),
          handedness: 'right',
        },
        {
          onStatus: (status) =>
            setCloudStatus(
              status === 'running' || status === 'queued'
                ? 'クラウド解析中...(数分かかることがあります)'
                : `状態: ${status}`
            ),
          signal: controller.signal,
        }
      );

      const analysis = cloudResultToRallyAnalysis(result, { playerSide });
      addRallyAnalysis(sessionId, analysis);
      setProgress(1);
      setHasAnalyzed(true);
      if (analysis.rallies.length > 0) {
        router.push(`/session/${sessionId}/rally-history` as never);
      } else {
        Alert.alert('解析結果が空でした', 'ラリーが検出できませんでした。動画を確認してください。');
      }
    } catch (error) {
      Alert.alert(
        'クラウド解析に失敗しました',
        error instanceof Error ? error.message : '時間をおいて再試行してください。'
      );
    } finally {
      setIsCloudAnalyzing(false);
      setCloudStatus('');
    }
  };

  const handleDraftCandidate = (candidateId: string, point: PointRecord) => {
    addPoint(sessionId, point);
    setCandidates((current) => current.filter((c) => c.id !== candidateId));
  };

  const handleOpenConfirm = (candidate: AutoPointCandidate) => {
    setConfirmingCandidate(candidate);
    setConfirmSheetOpen(true);
  };

  const handleConfirmSheetClose = () => {
    setConfirmSheetOpen(false);
    setConfirmingCandidate(null);
  };

  const handleConfirmSheetCommit = (data: Omit<PointRecord, 'id' | 'sessionId' | 'timestamp'>) => {
    if (!confirmingCandidate) return;
    const point: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      ...data,
      source: 'auto',
      confidence: confirmingCandidate.confidence,
      reviewStatus: 'confirmed',
      videoTimestamp: confirmingCandidate.videoTimestamp,
      rallyStartSec: confirmingCandidate.rallyStartSec,
      rallyEndSec: confirmingCandidate.rallyEndSec,
    };
    addPoint(sessionId, point);
    setCandidates((current) => current.filter((c) => c.id !== confirmingCandidate.id));
    setConfirmingCandidate(null);
    setConfirmSheetOpen(false);
  };

  const removeCandidate = (candidateId: string) => {
    setCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
  };

  const confirmInitialPoint: PointRecord | undefined = confirmingCandidate
    ? {
        id: '',
        sessionId,
        timestamp: new Date().toISOString(),
        outcome: confirmingCandidate.suggestedOutcome,
        shotType: confirmingCandidate.suggestedShotType,
        resultReason: confirmingCandidate.suggestedResultReason,
        rallyCount: confirmingCandidate.suggestedRallyCount,
        serveResult: confirmingCandidate.suggestedServeResult,
        shotLocation: confirmingCandidate.suggestedShotLocation,
        videoTimestamp: confirmingCandidate.videoTimestamp,
        source: 'auto',
        confidence: confirmingCandidate.confidence,
        rallyStartSec: confirmingCandidate.rallyStartSec,
        rallyEndSec: confirmingCandidate.rallyEndSec,
      }
    : undefined;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '自動採点（実験的）',
          headerStyle: { backgroundColor: colors.hero },
          headerTintColor: colors.onHero,
          headerTitleStyle: { color: colors.onHero, fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.onHero} name="chevron-back" size={26} />
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
          <View style={styles.heroPad}>
            <ScreenHero eyebrow="AUTO SCORE" title="自動採点" topInset={false}>
              <Text style={[styles.heroRange, { color: colors.onHero, fontFamily: NUM }]}>
                {startSec.toFixed(1)}–{endSec.toFixed(1)} 秒
              </Text>
              <Text style={[styles.heroSub, { color: withAlpha(colors.onHero, 0.68) }]}>
                候補 <Text style={{ fontFamily: NUM }}>{candidates.length}</Text> 件
                {videoDurationSec > 0 ? (
                  <>
                    {' '}
                    / 動画 <Text style={{ fontFamily: NUM }}>{videoDurationSec.toFixed(1)}</Text> 秒
                  </>
                ) : null}
              </Text>
            </ScreenHero>
          </View>

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
                コート較正でさらに精度が上がります
              </Text>
              <Text style={[styles.calibrationText, { color: colors.textMuted }]}>
                較正なしでもラリー区間の下書き生成ができます。較正を設定するとバウンド位置・採点候補も生成されます。
              </Text>
              <Button
                accessibilityLabel="コート較正を開く"
                label="コート較正を設定する（任意）"
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
                max={sliderMax}
                min={SLIDER_MIN}
                onChange={handleStartChange}
                step={SLIDER_STEP}
                value={startSec}
              />
              <SecondSlider
                label="終了"
                max={sliderMax}
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
                testID="autoscore-detect-batch"
                accessibilityLabel="自動ラリー検出"
                disabled={
                  isAnalyzing ||
                  isAutoDetecting ||
                  isCloudAnalyzing ||
                  !canAutoDetect ||
                  videoDurationSec <= 0
                }
                label={
                  session.courtCalibration
                    ? '自動ラリー検出 → 採点候補を生成'
                    : '自動ラリー検出 → 下書きを追加'
                }
                loading={isAutoDetecting}
                onPress={() => void handleAutoDetectBatch()}
                size="l"
                variant="secondary"
              />

              <Button
                testID="autoscore-analyze-range"
                accessibilityLabel="解析して採点候補を生成（コート較正必須）"
                disabled={
                  isAnalyzing ||
                  isAutoDetecting ||
                  isCloudAnalyzing ||
                  !session.courtCalibration ||
                  endSec <= startSec
                }
                label="範囲を指定して採点候補を生成（較正必須）"
                loading={isAnalyzing}
                onPress={() => void handleAnalyze()}
                size="l"
              />

              {CLOUD_ANALYSIS_AVAILABLE ? (
                <Button
                  testID="autoscore-cloud-analyze"
                  accessibilityLabel="クラウドでショット解析（較正必須）"
                  disabled={
                    isAnalyzing ||
                    isAutoDetecting ||
                    isCloudAnalyzing ||
                    !session.courtCalibration ||
                    videoDurationSec <= 0
                  }
                  label="クラウドでショット解析（速度・コース・FH/BH）"
                  loading={isCloudAnalyzing}
                  onPress={() => void handleCloudAnalyze()}
                  size="l"
                />
              ) : null}
            </View>
          </View>

          {isAnalyzing || isAutoDetecting || isCloudAnalyzing ? (
            <View
              style={[
                styles.card,
                styles.progressCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.progressLabel, { color: colors.text }]}>
                {isCloudAnalyzing
                  ? cloudStatus || 'クラウド解析中...'
                  : isAutoDetecting
                    ? '自動検出と一括採点中...'
                    : '解析中...'}
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

          {hasAnalyzed &&
          candidates.length === 0 &&
          !isAnalyzing &&
          !isAutoDetecting &&
          !isCloudAnalyzing ? (
            draftCount !== null ? (
              <View
                style={[
                  styles.card,
                  styles.draftSuccessCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                {draftCount > 0 ? (
                  <>
                    <Text style={[styles.draftSuccessTitle, { color: colors.text }]}>
                      {draftCount} 件のラリー区間を下書きとして追加しました
                    </Text>
                    <Text style={[styles.draftSuccessText, { color: colors.textMuted }]}>
                      Video
                      タブのタイムラインに半透明マーカーで表示されます。各マーカーをタップして得点・失点を確定してください。
                      {draftCount > 0 &&
                      session.points.some(
                        (p) =>
                          p.source === 'auto' &&
                          p.reviewStatus === 'draft' &&
                          (p.confidence ?? 1) < DRAFT_LOW_CONFIDENCE_THRESHOLD
                      )
                        ? '\n\n要確認マーカーが含まれています。信頼度が低い区間は慎重に確認してください。'
                        : ''}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.emptyCandidateText, { color: colors.textMuted }]}>
                    ラリー区間が検出できませんでした。動画が固定カメラで撮影されているか確認してください。
                  </Text>
                )}
              </View>
            ) : (
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
            )
          ) : null}

          {candidates.length > 0 ? (
            <View>
              <SectionHeader title="採点候補" />
              <View style={styles.candidateList}>
                {candidates.map((candidate) => (
                  <AutoPointCard
                    candidate={candidate}
                    key={candidate.id}
                    onSaveDraft={(point) => handleDraftCandidate(candidate.id, point)}
                    onConfirm={() => handleOpenConfirm(candidate)}
                    onReject={() => removeCandidate(candidate.id)}
                    sessionId={sessionId}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
      {session ? (
        <PointLogSheet
          open={confirmSheetOpen}
          outcome={confirmingCandidate?.suggestedOutcome ?? 'won'}
          initialPoint={confirmInitialPoint}
          sport={session.sport}
          onCommit={handleConfirmSheetCommit}
          onClose={handleConfirmSheetClose}
        />
      ) : null}
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
    gap: 16,
    paddingBottom: 48,
    paddingTop: 20,
  },
  heroPad: {
    paddingHorizontal: 20,
  },
  heroRange: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
    marginTop: 8,
  },
  heroSub: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
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
    gap: 16,
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
    fontFamily: fontFamily.numeric,
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
  draftSuccessCard: {
    gap: 10,
  },
  draftSuccessTitle: {
    fontFamily: fontFamily.numeric,
    fontSize: 15,
    fontWeight: '700',
  },
  draftSuccessText: {
    fontSize: 13,
    lineHeight: 20,
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
