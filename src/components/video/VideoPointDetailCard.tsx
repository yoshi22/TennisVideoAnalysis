import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CourtChart } from '@/components/court';
import { OUTCOME_LABELS, RESULT_REASON_LABELS } from '@/constants/labels';
import { SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPE_META } from '@/constants/shotTypes';
import { fontFamily, spacing, useTheme } from '@/theme';
import { type PointOutcome, type PointRecord, type TennisSession } from '@/types';

const NUM = fontFamily.numeric;

interface VideoPointDetailCardProps {
  point: PointRecord;
  sport: TennisSession['sport'];
  cumulative?: { w: number; l: number };
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetOutcome: (outcome: PointOutcome) => void;
}

export function VideoPointDetailCard({
  point,
  sport,
  cumulative,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onSetOutcome,
}: VideoPointDetailCardProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.detailHeader}>
        <View>
          <Text style={[styles.detailScoreLabel, { color: colors.textMuted }]}>動画内スコア</Text>
          <Text style={[styles.detailScore, { color: colors.text, fontFamily: NUM }]}>
            {cumulative ? `${cumulative.w}–${cumulative.l}` : '–'}
          </Text>
        </View>
        <View style={styles.detailMeta}>
          <View style={styles.detailOutcomeRow}>
            <View
              style={[
                styles.detailOutcomeChip,
                {
                  backgroundColor: point.outcome === 'won' ? colors.primary : colors.danger,
                },
              ]}
            >
              <Text style={[styles.detailOutcomeText, { color: colors.onHero }]}>
                {OUTCOME_LABELS[point.outcome]}
              </Text>
            </View>
            {point.reviewStatus === 'draft' ? (
              <View style={[styles.detailDraftChip, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.detailDraftText, { color: colors.textMuted }]}>draft</Text>
              </View>
            ) : null}
          </View>
          {/* Outcome toggle for auto-drafted points — lets user correct the placeholder 'won' */}
          {point.source === 'auto' && point.reviewStatus === 'draft' ? (
            <View style={styles.draftOutcomeToggleRow}>
              <TouchableOpacity
                accessibilityLabel="得点に変更"
                accessibilityRole="button"
                activeOpacity={0.82}
                onPress={() => onSetOutcome('won')}
                style={[
                  styles.draftOutcomeToggleBtn,
                  {
                    backgroundColor: point.outcome === 'won' ? colors.primary : colors.surfaceAlt,
                    borderColor: point.outcome === 'won' ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.draftOutcomeToggleText,
                    {
                      color: point.outcome === 'won' ? colors.onHero : colors.textSub,
                    },
                  ]}
                >
                  得点
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="失点に変更"
                accessibilityRole="button"
                activeOpacity={0.82}
                onPress={() => onSetOutcome('lost')}
                style={[
                  styles.draftOutcomeToggleBtn,
                  {
                    backgroundColor: point.outcome === 'lost' ? colors.danger : colors.surfaceAlt,
                    borderColor: point.outcome === 'lost' ? colors.danger : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.draftOutcomeToggleText,
                    {
                      color: point.outcome === 'lost' ? colors.onHero : colors.textSub,
                    },
                  ]}
                >
                  失点
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={[styles.detailMetaText, { color: colors.text }]} numberOfLines={1}>
            {point.shotType ? SHOT_TYPE_META[point.shotType].label : '詳細未入力'}
          </Text>
          {point.resultReason ? (
            <Text style={[styles.detailMetaSub, { color: colors.textSub }]}>
              {RESULT_REASON_LABELS[point.resultReason]}
            </Text>
          ) : null}
          {point.serveResult ? (
            <Text style={[styles.detailMetaSub, { color: colors.textSub }]}>
              {SERVE_RESULT_META[point.serveResult].label}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          accessibilityLabel="詳細を閉じる"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.detailClose}
        >
          <Ionicons color={colors.textMuted} name="close" size={20} />
        </TouchableOpacity>
      </View>

      <View style={styles.detailBody}>
        {point.shotLocation ? (
          <CourtChart height={160} shotLocations={[point.shotLocation]} sport={sport} width={100} />
        ) : (
          <View style={[styles.detailNoShot, { backgroundColor: colors.bg }]}>
            <Text style={[styles.detailNoShotText, { color: colors.textMuted }]}>配球なし</Text>
          </View>
        )}
        <View style={styles.detailNav}>
          <TouchableOpacity
            accessibilityLabel="前のラリーへ"
            accessibilityRole="button"
            disabled={index <= 0}
            onPress={onPrev}
            style={[
              styles.navButton,
              {
                backgroundColor: index > 0 ? colors.surfaceAlt : colors.bg,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              color={index > 0 ? colors.text : colors.textMuted}
              name="chevron-back"
              size={20}
            />
          </TouchableOpacity>
          <Text style={[styles.detailNavLabel, { color: colors.textMuted, fontFamily: NUM }]}>
            {index + 1} / {total}
          </Text>
          <TouchableOpacity
            accessibilityLabel="次のラリーへ"
            accessibilityRole="button"
            disabled={index >= total - 1}
            onPress={onNext}
            style={[
              styles.navButton,
              {
                backgroundColor: index < total - 1 ? colors.surfaceAlt : colors.bg,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              color={index < total - 1 ? colors.text : colors.textMuted}
              name="chevron-forward"
              size={20}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: fontFamily.numeric,
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
    fontFamily: fontFamily.numeric,
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
  draftOutcomeToggleRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  draftOutcomeToggleBtn: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  draftOutcomeToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
