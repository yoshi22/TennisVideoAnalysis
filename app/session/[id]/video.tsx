import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common';
import {
  VideoPlayer,
  VideoPointDetailCard,
  VideoPointRow,
  VideoQuickDock,
  VideoTimeline,
} from '@/components/video';
import { useSession, useSessionVideo } from '@/hooks';
import { useTheme } from '@/theme';

export default function SessionVideoScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (path: string) => router.push(path as any);
  const { session, sessionId } = useSession();
  const v = useSessionVideo(session, sessionId);

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
        initialTimeSec={v.initialSeekSec ?? 0}
        onDurationLoaded={v.handleDurationLoaded}
        onTimeUpdate={v.setCurrentTimeSec}
        ref={v.playerRef}
        style={styles.player}
        uri={session.videoUri}
      />

      <VideoQuickDock
        currentTimeSec={v.currentTimeSec}
        latestUndoEntry={v.latestUndoEntry}
        onMarkRallyStart={v.handleMarkRallyStart}
        onQuickLog={v.handleQuickLog}
        onUndo={v.handleUndoLast}
        rallyStartMark={v.rallyStartMark}
        score={v.score}
        undoDisabled={v.undoStack.length === 0}
      />

      {v.selectedPoint ? (
        <VideoPointDetailCard
          cumulative={v.cumulativeScores.get(v.selectedPoint.id)}
          index={v.selectedPointIndex}
          onClose={() => v.setSelectedPointId(null)}
          onNext={v.handleNextPoint}
          onPrev={v.handlePrevPoint}
          onSetOutcome={(outcome) => v.updateDraftOutcome(v.selectedPoint!.id, outcome)}
          point={v.selectedPoint}
          sport={session.sport}
          total={v.timestampedPoints.length}
        />
      ) : null}

      {v.durationSec > 0 ? (
        <View style={styles.timelineSection}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            ポイントタイムライン
          </Text>
          <VideoTimeline
            durationSec={v.durationSec}
            onSelect={v.handleSelectPoint}
            points={v.timestampedPoints}
          />
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
          <View style={styles.listHeaderRow}>
            <Text style={[styles.listLabel, { color: colors.textMuted }]}>マーカー一覧</Text>
            <TouchableOpacity
              accessibilityLabel="自動ラリー検出で下書きを生成"
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={() => push(`/session/${sessionId}/auto-score`)}
              style={[
                styles.autoDetectButton,
                { backgroundColor: colors.primaryLo, borderColor: colors.primary },
              ]}
            >
              <Ionicons color={colors.primary} name="sparkles-outline" size={14} />
              <Text style={[styles.autoDetectText, { color: colors.primary }]}>自動ラリー検出</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={styles.listContent}
        data={v.timestampedPoints}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <VideoPointRow
            index={index}
            isSelected={item.id === v.selectedPointId}
            item={item}
            onSelect={v.handleSelectPoint}
            total={v.timestampedPoints.length}
          />
        )}
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
  listContent: {
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  listHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  listLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  autoDetectButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  autoDetectText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyPoints: {
    minHeight: 220,
    justifyContent: 'center',
  },
});
