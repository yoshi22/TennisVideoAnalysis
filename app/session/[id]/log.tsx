import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common';
import { PointLogSheet, PointScoreboard } from '@/components/point';
import { MatchScoreboard } from '@/components/scoring';
import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { computeMatchScore } from '@/services/scoring';
import { setPendingSeek } from '@/services/video';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type PointOutcome, type PointRecord } from '@/types';
import { generateId } from '@/utils/id';

const RESULT_REASON_LABELS: Record<string, string> = {
  winner: 'ウィナー',
  forcedError: '誘ったミス',
  unforcedError: '凡ミス',
  net: 'ネット',
  out: 'アウト',
};

function getParamId(id: string | string[] | undefined): string {
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

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
  const { id } = useLocalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === sessionId));
  const addPoint = useSessionStore((state) => state.addPoint);
  const deletePoint = useSessionStore((state) => state.deletePoint);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState<PointOutcome>('won');

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
    setPendingOutcome(outcome);
    setSheetOpen(true);
  };

  const handleCommit = (data: Omit<PointRecord, 'id' | 'sessionId' | 'timestamp'>) => {
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
            <Text style={[styles.listLabel, { color: colors.textMuted }]}>
              ポイント履歴 ({points.length})
            </Text>
            <View
              style={[
                styles.listCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {points.map((point, idx) => {
                const cum = cumulativeScores.get(point.id);
                const isWon = point.outcome === 'won';
                const isLast = idx === points.length - 1;
                return (
                  <TouchableOpacity
                    key={point.id}
                    onLongPress={() => confirmDelete(point)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`${SHOT_TYPE_META[point.shotType].label}のポイント`}
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
                          {SHOT_TYPE_META[point.shotType].label}
                          {'  '}
                          <Text style={{ color: colors.textMuted, fontWeight: '500' }}>
                            · {RESULT_REASON_LABELS[point.resultReason] ?? point.resultReason}
                          </Text>
                        </Text>
                        <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                          {point.serveResult
                            ? `${SERVE_RESULT_META[point.serveResult].label} ・ `
                            : ''}
                          {point.rallyCount} 球 ・ {formatDateTime(point.timestamp)}
                        </Text>
                        {point.videoTimestamp !== undefined ? (
                          <TouchableOpacity
                            accessibilityLabel="動画で確認"
                            accessibilityRole="button"
                            onPress={() => {
                              setPendingSeek(sessionId, point.videoTimestamp!);
                              router.push(
                                `/session/${sessionId}/video` as Parameters<typeof router.push>[0]
                              );
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
                        #{points.length - idx}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      <PointLogSheet
        open={sheetOpen}
        outcome={pendingOutcome}
        sport={session.sport}
        onCommit={handleCommit}
        onClose={() => setSheetOpen(false)}
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
