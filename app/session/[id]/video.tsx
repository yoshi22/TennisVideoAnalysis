import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { VideoPlayer, type VideoPlayerRef } from '@/components/video';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { consumePendingSeek } from '@/services/video';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type PointRecord } from '@/types';

type TimestampedPoint = PointRecord & { videoTimestamp: number };

const OUTCOME_LABELS: Record<PointRecord['outcome'], string> = {
  won: '得点',
  lost: '失点',
};

function getParamId(id: string | string[] | undefined): string {
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

function hasVideoTimestamp(point: PointRecord): point is TimestampedPoint {
  return point.videoTimestamp !== undefined;
}

function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export default function SessionVideoScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === sessionId));
  const playerRef = useRef<VideoPlayerRef>(null);
  const requestedSeekRef = useRef<number | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [initialSeekSec, setInitialSeekSec] = useState<number | null>(null);

  const timestampedPoints = useMemo(
    () =>
      session
        ? session.points
            .filter(hasVideoTimestamp)
            .sort((a, b) => a.videoTimestamp - b.videoTimestamp)
        : [],
    [session]
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
    if (requestedSeekRef.current !== null) {
      playerRef.current?.seekTo(requestedSeekRef.current);
    }
  };

  const renderPoint = ({ item, index }: ListRenderItemInfo<TimestampedPoint>) => {
    const isWon = item.outcome === 'won';
    return (
      <TouchableOpacity
        accessibilityLabel={`${formatVideoTime(item.videoTimestamp)}のポイントを動画で確認`}
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={() => seekTo(item.videoTimestamp)}
        style={[
          styles.pointRow,
          {
            backgroundColor: colors.surface,
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
          {formatVideoTime(item.videoTimestamp)}
        </Text>
        <View style={styles.pointBody}>
          <Text style={[styles.pointTitle, { color: colors.text }]} numberOfLines={1}>
            {SHOT_TYPE_META[item.shotType].label}
          </Text>
          <Text style={[styles.pointOutcome, { color: isWon ? colors.primary : colors.danger }]}>
            {OUTCOME_LABELS[item.outcome]}
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
        ref={playerRef}
        style={styles.player}
        uri={session.videoUri}
      />

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
              return (
                <TouchableOpacity
                  accessibilityLabel={`${formatVideoTime(point.videoTimestamp)}へ移動`}
                  accessibilityRole="button"
                  activeOpacity={0.82}
                  key={point.id}
                  onPress={() => seekTo(point.videoTimestamp)}
                  style={[styles.markerTouch, { left: `${ratio * 100}%` }]}
                >
                  <View
                    style={[
                      styles.marker,
                      { borderBottomColor: isWon ? colors.primary : colors.danger },
                    ]}
                  />
                </TouchableOpacity>
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
    height: 34,
    justifyContent: 'center',
    marginLeft: -14,
    position: 'absolute',
    top: 0,
    width: 28,
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
});
