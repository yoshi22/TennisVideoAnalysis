import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common';
import { CourtChart } from '@/components/court';
import { VideoPlayer, type VideoPlayerRef } from '@/components/video';
import { OUTCOME_LABELS, RESULT_REASON_LABELS } from '@/constants/labels';
import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { useSession } from '@/hooks';
import { consumePendingSeek } from '@/services/video';
import { useSessionStore } from '@/stores/sessionStore';
import { spacing, useTheme } from '@/theme';
import { type PointOutcome, type PointRecord } from '@/types';
import { formatSeconds } from '@/utils/formatTime';
import { generateId } from '@/utils/id';
import { computeCumulativeScores } from '@/utils/cumulativeScore';
import { getPointDetailStatus, isConfirmed } from '@/utils/pointDetails';

type TimestampedPoint = PointRecord & { videoTimestamp: number };

function hasVideoTimestamp(point: PointRecord): point is TimestampedPoint {
  return point.videoTimestamp !== undefined;
}

export default function SessionVideoScreen() {
  const { colors } = useTheme();
  const { session, sessionId } = useSession();
  const addPoint = useSessionStore((state) => state.addPoint);
  const deletePoint = useSessionStore((state) => state.deletePoint);
  const setVideoDuration = useSessionStore((state) => state.setVideoDuration);
  const playerRef = useRef<VideoPlayerRef>(null);
  const requestedSeekRef = useRef<number | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [initialSeekSec, setInitialSeekSec] = useState<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [rallyStartMark, setRallyStartMark] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<
    { id: string; outcome: PointOutcome; timeSec: number }[]
  >([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  const timestampedPoints = useMemo(
    () =>
      session
        ? session.points
            .filter(hasVideoTimestamp)
            .sort((a, b) => a.videoTimestamp - b.videoTimestamp)
        : [],
    [session]
  );

  const score = useMemo(() => {
    const confirmed = (session?.points ?? []).filter(isConfirmed);
    return {
      won: confirmed.filter((p) => p.outcome === 'won').length,
      lost: confirmed.filter((p) => p.outcome === 'lost').length,
    };
  }, [session]);

  const cumulativeScores = useMemo(
    () => computeCumulativeScores(timestampedPoints.filter(isConfirmed)),
    [timestampedPoints]
  );

  const selectedPoint = useMemo(
    () =>
      selectedPointId ? (session?.points.find((p) => p.id === selectedPointId) ?? null) : null,
    [selectedPointId, session]
  );

  const selectedPointIndex = useMemo(
    () => (selectedPointId ? timestampedPoints.findIndex((p) => p.id === selectedPointId) : -1),
    [selectedPointId, timestampedPoints]
  );

  const seekTo = useCallback((seconds: number) => {
    requestedSeekRef.current = seconds;
    setInitialSeekSec(seconds);
    playerRef.current?.seekTo(seconds);
  }, []);

  const consumeSeek = useCallback(() => {
    const seconds = consumePendingSeek(sessionId);
    if (seconds !== null) {
      seekTo(seconds);
    }
  }, [seekTo, sessionId]);

  useEffect(() => {
    consumeSeek();
  }, [consumeSeek]);

  useFocusEffect(
    useCallback(() => {
      consumeSeek();
    }, [consumeSeek])
  );

  const handleDurationLoaded = (seconds: number) => {
    setDurationSec(seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      setVideoDuration(sessionId, seconds);
    }
    if (requestedSeekRef.current !== null) {
      playerRef.current?.seekTo(requestedSeekRef.current);
    }
  };

  const handleMarkRallyStart = () => {
    const t = Math.max(0, playerRef.current?.getCurrentTime() ?? currentTimeSec ?? 0);
    setRallyStartMark(t);
  };

  const handleQuickLog = (outcome: PointOutcome) => {
    const videoTimestamp = Math.max(0, playerRef.current?.getCurrentTime() ?? currentTimeSec ?? 0);
    const hasInterval = rallyStartMark !== null && rallyStartMark < videoTimestamp;
    const point: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      outcome,
      videoTimestamp,
      detailStatus: 'quick',
      ...(hasInterval && {
        rallyStartSec: rallyStartMark,
        rallyEndSec: videoTimestamp,
      }),
    };

    addPoint(sessionId, point);
    setUndoStack((prev) => [...prev, { id: point.id, outcome, timeSec: videoTimestamp }]);
    setRallyStartMark(null);
  };

  const handleUndoLast = () => {
    const lastEntry = undoStack[undoStack.length - 1];
    if (!lastEntry) return;
    deletePoint(sessionId, lastEntry.id);
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const handleSelectPoint = useCallback(
    (point: TimestampedPoint) => {
      setSelectedPointId(point.id);
      seekTo(point.rallyStartSec ?? point.videoTimestamp);
    },
    [seekTo]
  );

  const handlePrevPoint = useCallback(() => {
    if (selectedPointIndex > 0 && selectedPointIndex !== -1) {
      handleSelectPoint(timestampedPoints[selectedPointIndex - 1]);
    }
  }, [selectedPointIndex, timestampedPoints, handleSelectPoint]);

  const handleNextPoint = useCallback(() => {
    if (selectedPointIndex !== -1 && selectedPointIndex < timestampedPoints.length - 1) {
      handleSelectPoint(timestampedPoints[selectedPointIndex + 1]);
    }
  }, [selectedPointIndex, timestampedPoints, handleSelectPoint]);

  const latestUndoEntry = undoStack[undoStack.length - 1];

  const renderPoint = ({ item, index }: ListRenderItemInfo<TimestampedPoint>) => {
    const isWon = item.outcome === 'won';
    const isSelected = item.id === selectedPointId;
    return (
      <TouchableOpacity
        accessibilityLabel={`${formatSeconds(item.videoTimestamp)}のポイントを動画で確認`}
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={() => handleSelectPoint(item)}
        style={[
          styles.pointRow,
          {
            backgroundColor: isSelected ? colors.primaryLo : colors.surface,
            borderBottomColor: colors.border,
            borderBottomWidth:
              index === timestampedPoints.length - 1 ? 0 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View
          style={[styles.pointDot, { backgroundColor: isWon ? colors.primary : colors.danger }]}
        />
        <Text style={[styles.pointTime, { color: colors.text }]}>
          {formatSeconds(item.videoTimestamp)}
        </Text>
        <View style={styles.pointBody}>
          <Text style={[styles.pointTitle, { color: colors.text }]} numberOfLines={1}>
            {item.shotType ? SHOT_TYPE_META[item.shotType].label : '詳細未入力'}
          </Text>
          <Text
            style={[
              styles.pointOutcome,
              {
                color:
                  getPointDetailStatus(item) === 'quick'
                    ? colors.warning
                    : isWon
                      ? colors.primary
                      : colors.danger,
              },
            ]}
          >
            {getPointDetailStatus(item) === 'quick' ? '後で補完' : OUTCOME_LABELS[item.outcome]}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!session) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState icon="alert-circle-outline" title="セッションが見つかりません" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session.videoUri) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState
            description="このセッションには動画が登録されていません。"
            title="動画がありません"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <VideoPlayer
        initialTimeSec={initialSeekSec ?? 0}
        onDurationLoaded={handleDurationLoaded}
        onTimeUpdate={setCurrentTimeSec}
        ref={playerRef}
        style={styles.player}
        uri={session.videoUri}
      />

      <View
        style={[
          styles.quickDock,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.quickMetaRow}>
          <View>
            <Text style={[styles.quickLabel, { color: colors.textMuted }]}>現在</Text>
            <Text style={[styles.quickTime, { color: colors.text }]}>
              {formatSeconds(currentTimeSec)}
            </Text>
          </View>
          <View style={styles.quickScoreBox}>
            <Text style={[styles.quickScore, { color: colors.text }]}>
              {score.won}–{score.lost}
            </Text>
            <Text style={[styles.quickLabel, { color: colors.textMuted }]}>スコア</Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="直前の記録を取り消す"
            accessibilityRole="button"
            activeOpacity={0.82}
            disabled={undoStack.length === 0}
            onPress={handleUndoLast}
            style={[
              styles.undoButton,
              {
                backgroundColor: undoStack.length > 0 ? colors.surfaceAlt : colors.bg,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.undoText,
                { color: undoStack.length > 0 ? colors.textSub : colors.textMuted },
              ]}
            >
              取り消し
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityLabel="ラリー開始時刻をマーク"
          accessibilityRole="button"
          activeOpacity={0.82}
          onPress={handleMarkRallyStart}
          style={[
            styles.rallyStartButton,
            {
              backgroundColor: rallyStartMark !== null ? colors.primaryLo : colors.surfaceAlt,
              borderColor: rallyStartMark !== null ? colors.primary : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.rallyStartText,
              { color: rallyStartMark !== null ? colors.primary : colors.textSub },
            ]}
          >
            {rallyStartMark !== null
              ? `▶ ラリー開始 ${formatSeconds(rallyStartMark)}`
              : '▶ ラリー開始をマーク'}
          </Text>
        </TouchableOpacity>

        <View style={styles.quickActionRow}>
          <TouchableOpacity
            accessibilityLabel="現在時刻を得点として記録"
            accessibilityRole="button"
            activeOpacity={0.86}
            onPress={() => handleQuickLog('won')}
            style={[styles.quickActionButton, { backgroundColor: colors.success }]}
          >
            <Text style={[styles.quickActionText, { color: colors.surface }]}>得点</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="現在時刻を失点として記録"
            accessibilityRole="button"
            activeOpacity={0.86}
            onPress={() => handleQuickLog('lost')}
            style={[styles.quickActionButton, { backgroundColor: colors.danger }]}
          >
            <Text style={[styles.quickActionText, { color: colors.surface }]}>失点</Text>
          </TouchableOpacity>
        </View>

        {latestUndoEntry ? (
          <Text style={[styles.quickFeedback, { color: colors.textSub }]}>
            {formatSeconds(latestUndoEntry.timeSec)} に
            {latestUndoEntry.outcome === 'won' ? '得点' : '失点'}を記録しました
          </Text>
        ) : null}
      </View>

      {selectedPoint ? (
        <View
          style={[
            styles.detailCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.detailHeader}>
            <View>
              <Text style={[styles.detailScoreLabel, { color: colors.textMuted }]}>
                動画内スコア
              </Text>
              <Text style={[styles.detailScore, { color: colors.text }]}>
                {(() => {
                  const s = cumulativeScores.get(selectedPoint.id);
                  return s ? `${s.w}–${s.l}` : '–';
                })()}
              </Text>
            </View>
            <View style={styles.detailMeta}>
              <View style={styles.detailOutcomeRow}>
                <View
                  style={[
                    styles.detailOutcomeChip,
                    {
                      backgroundColor:
                        selectedPoint.outcome === 'won' ? colors.primary : colors.danger,
                    },
                  ]}
                >
                  <Text style={[styles.detailOutcomeText, { color: colors.surface }]}>
                    {OUTCOME_LABELS[selectedPoint.outcome]}
                  </Text>
                </View>
                {selectedPoint.reviewStatus === 'draft' ? (
                  <View style={[styles.detailDraftChip, { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[styles.detailDraftText, { color: colors.textMuted }]}>draft</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.detailMetaText, { color: colors.text }]} numberOfLines={1}>
                {selectedPoint.shotType
                  ? SHOT_TYPE_META[selectedPoint.shotType].label
                  : '詳細未入力'}
              </Text>
              {selectedPoint.resultReason ? (
                <Text style={[styles.detailMetaSub, { color: colors.textSub }]}>
                  {RESULT_REASON_LABELS[selectedPoint.resultReason]}
                </Text>
              ) : null}
              {selectedPoint.serveResult ? (
                <Text style={[styles.detailMetaSub, { color: colors.textSub }]}>
                  {SERVE_RESULT_META[selectedPoint.serveResult].label}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              accessibilityLabel="詳細を閉じる"
              accessibilityRole="button"
              onPress={() => setSelectedPointId(null)}
              style={styles.detailClose}
            >
              <Ionicons color={colors.textMuted} name="close" size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.detailBody}>
            {selectedPoint.shotLocation ? (
              <CourtChart
                height={160}
                shotLocations={[selectedPoint.shotLocation]}
                sport={session.sport}
                width={100}
              />
            ) : (
              <View style={[styles.detailNoShot, { backgroundColor: colors.bg }]}>
                <Text style={[styles.detailNoShotText, { color: colors.textMuted }]}>配球なし</Text>
              </View>
            )}
            <View style={styles.detailNav}>
              <TouchableOpacity
                accessibilityLabel="前のラリーへ"
                accessibilityRole="button"
                disabled={selectedPointIndex <= 0}
                onPress={handlePrevPoint}
                style={[
                  styles.navButton,
                  {
                    backgroundColor: selectedPointIndex > 0 ? colors.surfaceAlt : colors.bg,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  color={selectedPointIndex > 0 ? colors.text : colors.textMuted}
                  name="chevron-back"
                  size={20}
                />
              </TouchableOpacity>
              <Text style={[styles.detailNavLabel, { color: colors.textMuted }]}>
                {selectedPointIndex + 1} / {timestampedPoints.length}
              </Text>
              <TouchableOpacity
                accessibilityLabel="次のラリーへ"
                accessibilityRole="button"
                disabled={selectedPointIndex >= timestampedPoints.length - 1}
                onPress={handleNextPoint}
                style={[
                  styles.navButton,
                  {
                    backgroundColor:
                      selectedPointIndex < timestampedPoints.length - 1
                        ? colors.surfaceAlt
                        : colors.bg,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  color={
                    selectedPointIndex < timestampedPoints.length - 1
                      ? colors.text
                      : colors.textMuted
                  }
                  name="chevron-forward"
                  size={20}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {durationSec > 0 ? (
        <View style={styles.timelineSection}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            ポイントタイムライン
          </Text>
          <View style={styles.timelineWrap}>
            <View style={[styles.timelineTrack, { backgroundColor: colors.surfaceAlt }]} />
            {timestampedPoints.map((point) => {
              const ratio = Math.max(0, Math.min(1, point.videoTimestamp / durationSec));
              const isWon = point.outcome === 'won';
              const isDraft = point.reviewStatus === 'draft';
              const hasInterval =
                point.rallyStartSec !== undefined && point.rallyEndSec !== undefined;
              const startRatio = hasInterval
                ? Math.max(0, Math.min(1, point.rallyStartSec! / durationSec))
                : ratio;
              const endRatio = hasInterval
                ? Math.max(0, Math.min(1, point.rallyEndSec! / durationSec))
                : ratio;
              return (
                <Fragment key={point.id}>
                  <TouchableOpacity
                    accessibilityLabel={`${formatSeconds(point.videoTimestamp)}へ移動`}
                    accessibilityRole="button"
                    activeOpacity={0.82}
                    onPress={() => handleSelectPoint(point)}
                    style={[
                      styles.markerTouch,
                      { left: `${ratio * 100}%`, opacity: isDraft ? 0.4 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.marker,
                        { borderBottomColor: isWon ? colors.primary : colors.danger },
                      ]}
                    />
                  </TouchableOpacity>
                  {hasInterval ? (
                    <TouchableOpacity
                      accessibilityLabel={`${formatSeconds(point.rallyStartSec!)}から${formatSeconds(
                        point.rallyEndSec!
                      )}へ移動`}
                      accessibilityRole="button"
                      activeOpacity={0.82}
                      onPress={() => handleSelectPoint(point)}
                      style={[
                        styles.intervalBar,
                        {
                          backgroundColor: isWon ? colors.primary : colors.danger,
                          left: `${startRatio * 100}%`,
                          width: `${Math.max(0.5, (endRatio - startRatio) * 100)}%`,
                        },
                      ]}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </View>
        </View>
      ) : null}

      <FlatList
        ListEmptyComponent={
          <View style={styles.emptyPoints}>
            <EmptyState
              description="ポイントに動画時刻が記録されると、ここから動画へ移動できます。"
              title="動画マーカーがありません"
            />
          </View>
        }
        ListHeaderComponent={
          <Text style={[styles.listLabel, { color: colors.textMuted }]}>マーカー一覧</Text>
        }
        contentContainerStyle={styles.listContent}
        data={timestampedPoints}
        keyExtractor={(item) => item.id}
        renderItem={renderPoint}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWrapper: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  player: {
    width: '100%',
  },
  quickDock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  quickMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  quickTime: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 2,
  },
  quickScoreBox: {
    alignItems: 'center',
    flex: 1,
  },
  quickScore: {
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  undoButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: 12,
  },
  undoText: {
    fontSize: 13,
    fontWeight: '700',
  },
  rallyStartButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  rallyStartText: {
    fontSize: 13,
    fontWeight: '700',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
  },
  quickActionText: {
    fontSize: 18,
    fontWeight: '800',
  },
  quickFeedback: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  timelineSection: {
    paddingBottom: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  timelineWrap: {
    height: 34,
    justifyContent: 'center',
    position: 'relative',
  },
  timelineTrack: {
    borderRadius: 999,
    height: 6,
    width: '100%',
  },
  markerTouch: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: -22,
    position: 'absolute',
    top: -5,
    width: 44,
  },
  intervalBar: {
    borderRadius: 2,
    height: 6,
    opacity: 0.45,
    position: 'absolute',
    top: 14,
  },
  marker: {
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderLeftWidth: 6,
    borderRightColor: 'transparent',
    borderRightWidth: 6,
    height: 0,
    width: 0,
  },
  listContent: {
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  listLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  emptyPoints: {
    minHeight: 220,
    justifyContent: 'center',
  },
  pointRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pointDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  pointTime: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    width: 48,
  },
  pointBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  pointTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  pointOutcome: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  detailScoreLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailScore: {
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 2,
  },
  detailMeta: {
    flex: 1,
  },
  detailMetaText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailMetaSub: {
    fontSize: 12,
    marginTop: 2,
  },
  detailClose: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 36,
  },
  detailBody: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  detailNoShot: {
    alignItems: 'center',
    borderRadius: 8,
    height: 160,
    justifyContent: 'center',
    width: 100,
  },
  detailNoShotText: {
    fontSize: 11,
  },
  detailNav: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  navButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  detailNavLabel: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  detailOutcomeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  detailOutcomeChip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  detailOutcomeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailDraftChip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  detailDraftText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
