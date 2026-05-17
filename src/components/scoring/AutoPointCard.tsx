import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Button } from '@/components/common';
import { useTheme } from '@/theme';
import {
  type AutoPointCandidate,
  type PointOutcome,
  type PointRecord,
  type ResultReason,
  type ServeResult,
  type ShotType,
} from '@/types';
import { generateId } from '@/utils/id';

interface AutoPointCardProps {
  sessionId: string;
  candidate: AutoPointCandidate;
  onAccept: (point: Partial<PointRecord>) => void;
  onReject: () => void;
}

const OUTCOME_LABELS: Record<PointOutcome, string> = {
  won: '得点',
  lost: '失点',
};

const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  serve: 'サーブ',
  forehand: 'フォアハンド',
  backhand: 'バックハンド',
  volley: 'ボレー',
  smash: 'スマッシュ',
  lob: 'ロブ',
  drop: 'ドロップ',
};

const RESULT_REASON_LABELS: Record<ResultReason, string> = {
  winner: 'ウィナー',
  forcedError: '誘ったミス',
  unforcedError: '凡ミス',
  net: 'ネット',
  out: 'アウト',
};

const SERVE_RESULT_LABELS: Record<ServeResult, string> = {
  firstIn: '1stイン',
  secondIn: '2ndイン',
  doubleFault: 'ダブルフォルト',
  ace: 'エース',
  returnError: 'リターンエラー',
};

function formatVideoTime(seconds: number): string {
  return `${seconds.toFixed(1)}秒`;
}

export function AutoPointCard({ sessionId, candidate, onAccept, onReject }: AutoPointCardProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isWon = candidate.suggestedOutcome === 'won';

  const handleAccept = () => {
    const point: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      outcome: candidate.suggestedOutcome,
      serveResult: candidate.suggestedServeResult,
      shotType: candidate.suggestedShotType,
      resultReason: candidate.suggestedResultReason,
      rallyCount: candidate.suggestedRallyCount,
      shotLocation: candidate.suggestedShotLocation,
      videoTimestamp: candidate.videoTimestamp,
    };

    onAccept(point);
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View
          style={[styles.outcomeChip, { backgroundColor: isWon ? colors.success : colors.danger }]}
        >
          <Text style={[styles.outcomeText, { color: colors.surface }]}>
            {OUTCOME_LABELS[candidate.suggestedOutcome]}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>
            {SHOT_TYPE_LABELS[candidate.suggestedShotType]}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            ラリー {candidate.suggestedRallyCount} 球
          </Text>
        </View>
      </View>

      <View style={[styles.metaBox, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.metaText, { color: colors.text }]}>
          {RESULT_REASON_LABELS[candidate.suggestedResultReason]} ・{' '}
          {formatVideoTime(candidate.videoTimestamp)}
        </Text>
        {candidate.suggestedServeResult ? (
          <Text style={[styles.metaSubText, { color: colors.textMuted }]}>
            {SERVE_RESULT_LABELS[candidate.suggestedServeResult]}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        accessibilityLabel="解析理由を表示"
        accessibilityRole="button"
        activeOpacity={0.78}
        onPress={() => setExpanded((current) => !current)}
        style={styles.diagnosticsHeader}
      >
        <Text style={[styles.diagnosticsTitle, { color: colors.text }]}>解析理由</Text>
        <Ionicons
          color={colors.textMuted}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.diagnosticsList}>
          {candidate.diagnostics.length > 0 ? (
            candidate.diagnostics.map((diagnostic, index) => (
              <View key={`${candidate.id}-diagnostic-${index}`} style={styles.diagnosticRow}>
                <Text style={[styles.bullet, { color: colors.primary }]}>•</Text>
                <Text style={[styles.diagnosticText, { color: colors.textMuted }]}>
                  {diagnostic}
                </Text>
              </View>
            ))
          ) : (
            <Text style={[styles.diagnosticText, { color: colors.textMuted }]}>
              解析理由はありません。
            </Text>
          )}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          accessibilityLabel="採用して保存"
          label="採用して保存"
          onPress={handleAccept}
          style={styles.actionButton}
        />
        <Button
          accessibilityLabel="候補を棄却"
          label="棄却"
          onPress={onReject}
          style={styles.actionButton}
          tone="danger"
          variant="ghost"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    elevation: 1,
    gap: 14,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  outcomeChip: {
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  outcomeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  metaBox: {
    borderRadius: 10,
    gap: 2,
    padding: 10,
  },
  metaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  metaSubText: {
    fontSize: 12,
  },
  diagnosticsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  diagnosticsTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  diagnosticsList: {
    gap: 8,
  },
  diagnosticRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bullet: {
    fontSize: 14,
    lineHeight: 20,
  },
  diagnosticText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
