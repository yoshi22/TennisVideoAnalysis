import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fontFamily, useTheme } from '@/theme';
import { type PointOutcome } from '@/types';
import { formatSeconds } from '@/utils/formatTime';

const NUM = fontFamily.numeric;

interface VideoQuickDockProps {
  currentTimeSec: number;
  score: { won: number; lost: number };
  undoDisabled: boolean;
  latestUndoEntry?: { outcome: PointOutcome; timeSec: number };
  rallyStartMark: number | null;
  onUndo: () => void;
  onMarkRallyStart: () => void;
  onQuickLog: (outcome: PointOutcome) => void;
}

export function VideoQuickDock({
  currentTimeSec,
  score,
  undoDisabled,
  latestUndoEntry,
  rallyStartMark,
  onUndo,
  onMarkRallyStart,
  onQuickLog,
}: VideoQuickDockProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.quickDock,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.quickMetaRow}>
        <View>
          <Text style={[styles.quickLabel, { color: colors.textMuted }]}>現在</Text>
          <Text style={[styles.quickTime, { color: colors.text, fontFamily: NUM }]}>
            {formatSeconds(currentTimeSec)}
          </Text>
        </View>
        <View style={styles.quickScoreBox}>
          <Text style={[styles.quickScore, { color: colors.text, fontFamily: NUM }]}>
            {score.won}–{score.lost}
          </Text>
          <Text style={[styles.quickLabel, { color: colors.textMuted }]}>スコア</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="直前の記録を取り消す"
          accessibilityRole="button"
          activeOpacity={0.82}
          disabled={undoDisabled}
          onPress={onUndo}
          style={[
            styles.undoButton,
            {
              backgroundColor: !undoDisabled ? colors.surfaceAlt : colors.bg,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[styles.undoText, { color: !undoDisabled ? colors.textSub : colors.textMuted }]}
          >
            取り消し
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        accessibilityLabel="ラリー開始時刻をマーク"
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={onMarkRallyStart}
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
            {
              color: rallyStartMark !== null ? colors.primary : colors.textSub,
              fontFamily: NUM,
            },
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
          onPress={() => onQuickLog('won')}
          style={[styles.quickActionButton, { backgroundColor: colors.success }]}
        >
          <Text style={[styles.quickActionText, { color: colors.onHero }]}>得点</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="現在時刻を失点として記録"
          accessibilityRole="button"
          activeOpacity={0.86}
          onPress={() => onQuickLog('lost')}
          style={[styles.quickActionButton, { backgroundColor: colors.danger }]}
        >
          <Text style={[styles.quickActionText, { color: colors.onHero }]}>失点</Text>
        </TouchableOpacity>
      </View>

      {latestUndoEntry ? (
        <Text style={[styles.quickFeedback, { color: colors.textSub, fontFamily: NUM }]}>
          {formatSeconds(latestUndoEntry.timeSec)} に
          {latestUndoEntry.outcome === 'won' ? '得点' : '失点'}を記録しました
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: fontFamily.numeric,
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
    fontFamily: fontFamily.numeric,
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
});
