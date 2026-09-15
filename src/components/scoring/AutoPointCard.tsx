import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Button } from '@/components/common';
import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { OUTCOME_LABELS, RESULT_REASON_LABELS } from '@/constants/labels';
import { buildDraftPointFromCandidate } from '@/services/scoring';
import { fontFamily, useTheme } from '@/theme';
import { type AutoPointCandidate, type PointRecord } from '@/types';

interface AutoPointCardProps {
  sessionId: string;
  candidate: AutoPointCandidate;
  onSaveDraft: (point: PointRecord) => void;
  onConfirm: () => void;
  onReject: () => void;
}

function formatVideoTime(seconds: number): string {
  return `${seconds.toFixed(1)}秒`;
}

export function AutoPointCard({
  sessionId,
  candidate,
  onSaveDraft,
  onConfirm,
  onReject,
}: AutoPointCardProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isWon = candidate.suggestedOutcome === 'won';

  const handleSaveDraft = () => {
    onSaveDraft(buildDraftPointFromCandidate(sessionId, candidate));
  };

  const confidenceColor =
    candidate.confidence === undefined
      ? undefined
      : candidate.confidence >= 0.7
        ? colors.success
        : candidate.confidence >= 0.4
          ? colors.warning
          : colors.danger;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View
          style={[styles.outcomeChip, { backgroundColor: isWon ? colors.success : colors.danger }]}
        >
          <Text style={[styles.outcomeText, { color: colors.onHero }]}>
            {OUTCOME_LABELS[candidate.suggestedOutcome]}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>
            {SHOT_TYPE_META[candidate.suggestedShotType].label}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            ラリー {candidate.suggestedRallyCount} 球
          </Text>
        </View>
        {confidenceColor !== undefined && candidate.confidence !== undefined ? (
          <View style={styles.confidenceColumn}>
            <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor }]}>
              <Text style={[styles.confidenceText, { color: colors.onHero }]}>
                {`信頼度 ${Math.round(candidate.confidence * 100)}%`}
              </Text>
            </View>
            {candidate.confidence < 0.5 ? (
              <Text style={[styles.requiresCheckText, { color: colors.warning }]}>要確認</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[styles.metaBox, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.metaText, { color: colors.text }]}>
          {RESULT_REASON_LABELS[candidate.suggestedResultReason]} ・{' '}
          {formatVideoTime(candidate.videoTimestamp)}
        </Text>
        {candidate.suggestedServeResult ? (
          <Text style={[styles.metaSubText, { color: colors.textMuted }]}>
            {SERVE_RESULT_META[candidate.suggestedServeResult].label}
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
          accessibilityLabel="下書きとして保存"
          label="下書き保存"
          onPress={handleSaveDraft}
          style={styles.actionButton}
        />
        <Button
          accessibilityLabel="内容を確認して確定"
          label="確認して確定"
          onPress={onConfirm}
          style={styles.actionButton}
          variant="secondary"
        />
      </View>
      <View style={styles.rejectRow}>
        <Button
          accessibilityLabel="候補を棄却"
          label="棄却"
          onPress={onReject}
          style={styles.rejectButton}
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
    borderWidth: 1,
    gap: 14,
    padding: 14,
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
    fontFamily: fontFamily.numeric,
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
    fontFamily: fontFamily.numeric,
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
    fontFamily: fontFamily.numeric,
    fontSize: 13,
    lineHeight: 20,
  },
  confidenceColumn: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  confidenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidenceText: {
    fontFamily: fontFamily.numeric,
    fontSize: 11,
    fontWeight: '700',
  },
  requiresCheckText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  rejectRow: {
    alignItems: 'center',
  },
  rejectButton: {
    alignSelf: 'center',
  },
});
