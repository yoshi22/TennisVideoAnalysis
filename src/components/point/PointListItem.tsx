import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { RESULT_REASON_LABELS } from '@/constants/labels';
import { setPendingSeek } from '@/services/video';
import { useTheme } from '@/theme';
import { type PointRecord } from '@/types';
import { formatDateTime } from '@/utils/date';
import { formatSeconds } from '@/utils/formatTime';
import { pushRoute } from '@/utils/navigation';
import { getPointDetailStatus } from '@/utils/pointDetails';

interface Props {
  point: PointRecord;
  allIndex: number;
  totalPoints: number;
  cumulativeScore: { w: number; l: number } | undefined;
  isLast: boolean;
  sessionId: string;
  onPress: () => void;
  onLongPress: () => void;
}

export function PointListItem({
  point,
  allIndex,
  totalPoints,
  cumulativeScore,
  isLast,
  sessionId,
  onPress,
  onLongPress,
}: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const isWon = point.outcome === 'won';

  const handleVideoJump = () => {
    const seekSec = point.rallyStartSec ?? point.videoTimestamp!;
    setPendingSeek(sessionId, seekSec);
    pushRoute(router, `/session/${sessionId}/video`);
  };

  return (
    <TouchableOpacity
      accessibilityLabel="ポイント詳細を編集"
      accessibilityRole="button"
      activeOpacity={0.8}
      key={point.id}
      onLongPress={onLongPress}
      onPress={onPress}
    >
      <View
        style={[
          styles.listItem,
          !isLast && { borderBottomWidth: 0.5, borderBottomColor: colors.border },
        ]}
      >
        <View
          style={[styles.sidebar, { backgroundColor: isWon ? colors.success : colors.danger }]}
        />
        <View style={styles.itemScore}>
          <Text style={[styles.cumScore, { color: colors.textSub }]}>
            {cumulativeScore ? `${cumulativeScore.w}–${cumulativeScore.l}` : '—'}
          </Text>
        </View>
        <View style={styles.itemBody}>
          <Text style={[styles.itemTitle, { color: colors.text }]}>
            {point.shotType ? SHOT_TYPE_META[point.shotType].label : '詳細未入力'}
            {point.resultReason ? (
              <Text style={{ color: colors.textMuted, fontWeight: '500' }}>
                {'  '}· {RESULT_REASON_LABELS[point.resultReason] ?? point.resultReason}
              </Text>
            ) : null}
          </Text>
          <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
            {point.serveResult ? `${SERVE_RESULT_META[point.serveResult].label} ・ ` : ''}
            {typeof point.rallyCount === 'number' ? `${point.rallyCount} 球 ・ ` : ''}
            {point.rallyStartSec !== undefined && point.rallyEndSec !== undefined
              ? `${formatSeconds(point.rallyStartSec)}〜${formatSeconds(point.rallyEndSec)} ・ `
              : point.videoTimestamp !== undefined
                ? `${formatSeconds(point.videoTimestamp)} ・ `
                : ''}
            {formatDateTime(point.timestamp)}
          </Text>
          {getPointDetailStatus(point) === 'quick' ? (
            <Text style={[styles.quickDetailText, { color: colors.warning }]}>
              タップして詳細を入力
            </Text>
          ) : null}
          {point.reviewStatus === 'draft' ? (
            <View style={[styles.draftBadge, { backgroundColor: colors.warning }]}>
              <Text style={[styles.draftBadgeText, { color: colors.surface }]}>下書き</Text>
            </View>
          ) : null}
          {point.videoTimestamp !== undefined || point.rallyStartSec !== undefined ? (
            <TouchableOpacity
              accessibilityLabel="動画で確認"
              accessibilityRole="button"
              onPress={handleVideoJump}
              style={styles.videoJumpButton}
            >
              <Text style={[styles.videoJumpText, { color: colors.primary }]}>
                {point.rallyStartSec !== undefined ? '▶ ラリー区間を確認' : '▶ 動画で確認'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[styles.itemIndex, { color: colors.textMuted }]}>
          #{allIndex >= 0 ? totalPoints - allIndex : totalPoints}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  draftBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  draftBadgeText: {
    fontSize: 10,
    fontWeight: '700',
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
