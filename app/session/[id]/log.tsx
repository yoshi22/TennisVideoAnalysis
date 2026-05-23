import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common';
import { PointLogSheet, PointScoreboard } from '@/components/point';
import { MatchScoreboard } from '@/components/scoring';
import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { useSession } from '@/hooks';
import { computeMatchScore } from '@/services/scoring';
import { setPendingSeek } from '@/services/video';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type PointOutcome, type PointRecord } from '@/types';
import { formatSeconds } from '@/utils/formatTime';
import { generateId } from '@/utils/id';
import { getPointDetailStatus } from '@/utils/pointDetails';

const RESULT_REASON_LABELS: Record<string, string> = {
  winner: 'ウィナー',
  forcedError: '誘ったミス',
  unforcedError: '凡ミス',
  net: 'ネット',
  out: 'アウト',
};

type LogFilter = 'all' | 'quick';

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SessionLogScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (path: string) => router.push(path as any);
  const { session, sessionId } = useSession();
  const addPoint = useSessionStore((state) => state.addPoint);
  const updatePoint = useSessionStore((state) => state.updatePoint);
  const deletePoint = useSessionStore((state) => state.deletePoint);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState<PointOutcome>('won');
  const [editingPoint, setEditingPoint] = useState<PointRecord | undefined>(undefined);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState<LogFilter>('all');

  const chronologicalPoints = useMemo(
    () =>
      session
        ? [...session.points].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )
        : [],
    [session]
  );
  const points = useMemo(() => [...chronologicalPoints].reverse(), [chronologicalPoints]);
  const quickPoints = useMemo(
    () => points.filter((point) => getPointDetailStatus(point) === 'quick'),
    [points]
  );
  const visiblePoints = filter === 'quick' ? quickPoints : points;

  const ourScore = useMemo(() => points.filter((p) => p.outcome === 'won').length, [points]);
  const oppScore = useMemo(() => points.filter((p) => p.outcome === 'lost').length, [points]);
  const matchScore = useMemo(() => {
    if (!session || session.sessionType !== 'match') {
      return null;
    }

    return computeMatchScore(chronologicalPoints, session.sport);
  }, [chronologicalPoints, session]);

  // Cumulative score per point (chronological)
  const cumulativeScores = useMemo(() => {
    let w = 0;
    let l = 0;
    return new Map(
      chronologicalPoints.map((p) => {
        if (p.outcome === 'won') w++;
        else l++;
        return [p.id, { w, l }];
      })
    );
  }, [chronologicalPoints]);

  const openSheet = (outcome: PointOutcome) => {
    setEditingPoint(undefined);
    setEditingIndex(null);
    setPendingOutcome(outcome);
    setSheetOpen(true);
  };

  const openEditSheet = (point: PointRecord, index: number) => {
    if (index < 0) return;

    setEditingPoint(point);
    setEditingIndex(index);
    setPendingOutcome(point.outcome);
    setSheetOpen(true);
  };

  const moveEditSheet = (delta: -1 | 1) => {
    if (editingIndex === null) return;

    const nextIndex = editingIndex + delta;
    const nextPoint = points[nextIndex];
    if (!nextPoint) return;

    setEditingPoint(nextPoint);
    setEditingIndex(nextIndex);
    setPendingOutcome(nextPoint.outcome);
  };

  const handleGoToVideo = () => {
    if (!editingPoint || typeof editingPoint.videoTimestamp !== 'number') return;

    setPendingSeek(sessionId, editingPoint.videoTimestamp);
    push(`/session/${sessionId}/video`);
  };

  const handleCommit = (data: Omit<PointRecord, 'id' | 'sessionId' | 'timestamp'>) => {
    if (editingPoint) {
      updatePoint(sessionId, editingPoint.id, data);
      setEditingPoint(undefined);
      setEditingIndex(null);
      setSheetOpen(false);
      return;
    }

    const record: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      ...data,
    };
    addPoint(sessionId, record);
    setSheetOpen(false);
  };

  const confirmDelete = (point: PointRecord) => {
    Alert.alert('ポイントを削除', 'このポイントを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => deletePoint(sessionId, point.id) },
    ]);
  };

  const hasPrev = editingIndex !== null && editingIndex > 0;
  const hasNext = editingIndex !== null && editingIndex < points.length - 1;

  if (!session) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState icon="alert-circle-outline" title="セッションが見つかりません" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Scoreboard */}
        {matchScore ? <MatchScoreboard matchScore={matchScore} /> : null}
        <PointScoreboard ourScore={ourScore} oppScore={oppScore} />

        {/* Win / Loss buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.winBtn, { backgroundColor: colors.success }]}
            onPress={() => openSheet('won')}
            activeOpacity={0.85}
          >
            <Text style={[styles.actionBtnText, { color: colors.surface }]}>↑ 得点</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.loseBtn, { backgroundColor: colors.danger }]}
            onPress={() => openSheet('lost')}
            activeOpacity={0.85}
          >
            <Text style={[styles.actionBtnText, { color: colors.surface }]}>↓ 失点</Text>
          </TouchableOpacity>
        </View>

        {/* Point list */}
        {points.length === 0 ? (
          <View style={styles.emptyPoints}>
            <EmptyState
              description="上のボタンでポイントを記録しましょう"
              title="ポイントがありません"
            />
          </View>
        ) : (
          <View>
            <View
              style={[
                styles.filterPanel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.filterSummary, { color: colors.text }]}>
                詳細入力済み {points.length - quickPoints.length} / {points.length}
              </Text>
              <View style={styles.filterRow}>
                {[
                  { label: `すべて ${points.length}`, value: 'all' as const },
                  { label: `未補完 ${quickPoints.length}`, value: 'quick' as const },
                ].map((option) => {
                  const active = filter === option.value;
                  return (
                    <TouchableOpacity
                      accessibilityLabel={`${option.label}を表示`}
                      accessibilityRole="button"
                      activeOpacity={0.82}
                      key={option.value}
                      onPress={() => setFilter(option.value)}
                      style={[
                        styles.filterButton,
                        {
                          backgroundColor: active ? colors.primaryLo : colors.surfaceAlt,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterButtonText,
                          { color: active ? colors.primary : colors.textSub },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <Text style={[styles.listLabel, { color: colors.textMuted }]}>
              ポイント履歴 ({visiblePoints.length})
            </Text>
            {visiblePoints.length === 0 ? (
              <View
                style={[
                  styles.filteredEmpty,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <EmptyState
                  description="すべてのポイントに詳細が入力されています"
                  title="未補完はありません"
                />
              </View>
            ) : (
              <View
                style={[
                  styles.listCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                {visiblePoints.map((point, idx) => {
                  const cum = cumulativeScores.get(point.id);
                  const isWon = point.outcome === 'won';
                  const isLast = idx === visiblePoints.length - 1;
                  const allIndex = points.findIndex((candidate) => candidate.id === point.id);
                  return (
                    <TouchableOpacity
                      key={point.id}
                      onPress={() => openEditSheet(point, allIndex)}
                      onLongPress={() => confirmDelete(point)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="ポイント詳細を編集"
                    >
                      <View
                        style={[
                          styles.listItem,
                          !isLast && { borderBottomWidth: 0.5, borderBottomColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.sidebar,
                            { backgroundColor: isWon ? colors.success : colors.danger },
                          ]}
                        />
                        <View style={styles.itemScore}>
                          <Text style={[styles.cumScore, { color: colors.textSub }]}>
                            {cum ? `${cum.w}–${cum.l}` : '—'}
                          </Text>
                        </View>
                        <View style={styles.itemBody}>
                          <Text style={[styles.itemTitle, { color: colors.text }]}>
                            {point.shotType ? SHOT_TYPE_META[point.shotType].label : '詳細未入力'}
                            {point.resultReason ? (
                              <Text style={{ color: colors.textMuted, fontWeight: '500' }}>
                                {'  '}·{' '}
                                {RESULT_REASON_LABELS[point.resultReason] ?? point.resultReason}
                              </Text>
                            ) : null}
                          </Text>
                          <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                            {point.serveResult
                              ? `${SERVE_RESULT_META[point.serveResult].label} ・ `
                              : ''}
                            {typeof point.rallyCount === 'number'
                              ? `${point.rallyCount} 球 ・ `
                              : ''}
                            {point.videoTimestamp !== undefined
                              ? `${formatSeconds(point.videoTimestamp)} ・ `
                              : ''}
                            {formatDateTime(point.timestamp)}
                          </Text>
                          {getPointDetailStatus(point) === 'quick' ? (
                            <Text style={[styles.quickDetailText, { color: colors.warning }]}>
                              タップして詳細を入力
                            </Text>
                          ) : null}
                          {point.videoTimestamp !== undefined ? (
                            <TouchableOpacity
                              accessibilityLabel="動画で確認"
                              accessibilityRole="button"
                              onPress={() => {
                                setPendingSeek(sessionId, point.videoTimestamp!);
                                push(`/session/${sessionId}/video`);
                              }}
                              style={styles.videoJumpButton}
                            >
                              <Text style={[styles.videoJumpText, { color: colors.primary }]}>
                                ▶ 動画で確認
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        <Text style={[styles.itemIndex, { color: colors.textMuted }]}>
                          #{allIndex >= 0 ? points.length - allIndex : points.length - idx}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      <PointLogSheet
        initialPoint={editingPoint}
        open={sheetOpen}
        outcome={pendingOutcome}
        sessionId={sessionId}
        sport={session.sport}
        onCommit={handleCommit}
        onClose={() => {
          setEditingPoint(undefined);
          setEditingIndex(null);
          setSheetOpen(false);
        }}
        onGoToVideo={handleGoToVideo}
        onPrev={() => moveEditSheet(-1)}
        onNext={() => moveEditSheet(1)}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  winBtn: {
    shadowColor: '#1A9B5C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  loseBtn: {
    shadowColor: '#D94848',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyPoints: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.06,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  filterPanel: {
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 10,
    marginBottom: 12,
    padding: 12,
  },
  filterSummary: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 0.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filteredEmpty: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    minHeight: 180,
    justifyContent: 'center',
    padding: 16,
  },
  listCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingRight: 14,
  },
  sidebar: {
    width: 4,
    height: 28,
    borderRadius: 2,
    marginLeft: 0,
    flexShrink: 0,
  },
  itemScore: {
    width: 38,
  },
  cumScore: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: 11,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  quickDetailText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  videoJumpButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    minHeight: 28,
    justifyContent: 'center',
  },
  videoJumpText: {
    fontSize: 12,
    fontWeight: '700',
  },
  itemIndex: {
    fontSize: 11,
    fontWeight: '600',
  },
});
