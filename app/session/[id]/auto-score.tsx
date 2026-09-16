import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import {
  ActivityIndicator,
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
import { useAutoScore, useSession } from '@/hooks';
import {
  DRAFT_LOW_CONFIDENCE_THRESHOLD,
  SLIDER_MIN,
  SLIDER_STEP,
  type PlayerSideValue,
  type ServeAttemptValue,
  type ServeMode,
} from '@/hooks/useAutoScore';
import { isCloudAnalysisEnabled } from '@/services/analysis/cloudAnalyze';
import { isVideoUploadConfigured } from '@/services/analysis/videoUpload';
import { fontFamily, useTheme } from '@/theme';

const CLOUD_ANALYSIS_AVAILABLE = isCloudAnalysisEnabled() && isVideoUploadConfigured();

const NUM = fontFamily.numeric;

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
  const {
    startSec,
    endSec,
    playerSide,
    setPlayerSide,
    serveMode,
    setServeMode,
    serveAttempt,
    setServeAttempt,
    isAnalyzing,
    isAutoDetecting,
    isCloudAnalyzing,
    cloudStatus,
    progress,
    candidates,
    hasAnalyzed,
    draftCount,
    confirmingCandidate,
    confirmSheetOpen,
    videoDurationSec,
    canAutoDetect,
    sliderMax,
    confirmInitialPoint,
    handleStartChange,
    handleEndChange,
    handleAnalyze,
    handleAutoDetectBatch,
    handleCloudAnalyze,
    handleDraftCandidate,
    handleOpenConfirm,
    handleConfirmSheetClose,
    handleConfirmSheetCommit,
    removeCandidate,
  } = useAutoScore(session ?? null, sessionId, router);

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
