import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';

import { EmptyState } from '@/components/common';
import { useSession } from '@/hooks';
import { useSessionStore } from '@/stores';
import { fontFamily, useTheme } from '@/theme';
import { type RallyOutcome, type RallyRecord, type ShotLocation, type StrokeKind } from '@/types';

const NUM = fontFamily.numeric;

function strokeLabel(stroke: StrokeKind): string {
  switch (stroke) {
    case 'forehand':
      return 'フォア';
    case 'backhand':
      return 'バック';
    case 'serve':
      return 'サーブ';
    default:
      // Not "ショット": the stroke arrives as 'unknown' when pose estimation
      // could not tell the side, which is common in wide fixed-camera footage.
      // Labelling it neutrally hid the fact that nothing was determined.
      return '不明';
  }
}

function describeZone(label: string | undefined): string {
  if (!label) return 'コース不明';
  const [half, side, depth] = label.split('_');
  const jHalf = half === 'near' ? '手前' : half === 'far' ? '奥' : '';
  const jSide = side === 'ad' ? 'アド' : side === 'deuce' ? 'デュース' : '';
  const jDepth = depth === 'short' ? '浅い' : depth === 'deep' ? '深い' : '';
  return [jHalf, jSide, jDepth].filter(Boolean).join('・') || 'コース不明';
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSpeed(kmh: number | null | undefined): string {
  return kmh !== null && kmh !== undefined ? `${Math.round(kmh)}km/h` : '';
}

function countRalliesByOutcome(rallies: RallyRecord[], outcome: RallyOutcome): number {
  return rallies.filter((rally) => rally.outcome === outcome).length;
}

export default function RallyHistoryScreen() {
  const { colors, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, sessionId } = useSession();
  const confirmRallyOutcome = useSessionStore((s) => s.confirmRallyOutcome);

  const analyses = session?.rallyAnalyses ?? [];
  const analysis = analyses.length > 0 ? analyses[analyses.length - 1] : null;
  const rallies = useMemo(() => analysis?.rallies ?? [], [analysis]);

  const [expanded, setExpanded] = useState(0);

  const strokeColor = (stroke: StrokeKind): string => {
    switch (stroke) {
      case 'serve':
        return colors.warning;
      case 'forehand':
        return colors.primary;
      case 'backhand':
        return colors.accent;
      default:
        return colors.textMuted;
    }
  };

  const won = countRalliesByOutcome(rallies, 'won');
  const lost = countRalliesByOutcome(rallies, 'lost');
  const unconfirmed = rallies.filter((r) => r.outcomeSource === 'auto');
  const avgShots = rallies.length
    ? rallies.reduce((sum, r) => sum + r.shotCount, 0) / rallies.length
    : 0;

  // Rally-length histogram buckets.
  const histogram = useMemo(() => {
    const buckets = [
      { label: '1-2', min: 1, max: 2 },
      { label: '3-4', min: 3, max: 4 },
      { label: '5-6', min: 5, max: 6 },
      { label: '7-8', min: 7, max: 8 },
      { label: '9+', min: 9, max: Infinity },
    ];
    const counts = buckets.map(
      (b) => rallies.filter((r) => r.shotCount >= b.min && r.shotCount <= b.max).length
    );
    const max = Math.max(...counts, 1);
    return buckets.map((b, i) => ({ label: b.label, h: Math.round((counts[i] / max) * 30) }));
  }, [rallies]);

  const bulkConfirm = () => {
    if (!analysis) return;
    for (const r of unconfirmed) {
      if (r.outcome !== 'unknown') {
        confirmRallyOutcome(sessionId, analysis.id, r.rally, r.outcome);
      }
    }
  };

  const renderLadder = (rally: RallyRecord) => (
    <View style={styles.ladderWrap}>
      <View style={styles.sideLabels}>
        <Text style={[styles.sideLabel, styles.sideLabelL, { color: colors.textMuted }]}>自陣</Text>
        <View style={{ width: 26 }} />
        <Text style={[styles.sideLabel, styles.sideLabelR, { color: colors.textMuted }]}>
          相手コート
        </Text>
      </View>
      <View style={styles.ladder}>
        <View style={[styles.ladderRail, { backgroundColor: colors.surfaceAlt }]} />
        {rally.shots.map((shot) => {
          const own = shot.index % 2 === 1;
          const label = `${strokeLabel(shot.stroke)}`;
          const sub = [describeZone(shot.zoneLabel), fmtSpeed(shot.speedKmh)]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={`${shot.index}-${shot.frameIdx}`} style={styles.ladderRow}>
              <View style={styles.ladderCellL}>
                {own ? (
                  <>
                    <Text style={[styles.ladderTitle, { color: colors.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={[styles.ladderSub, { color: colors.textSub }]} numberOfLines={1}>
                      {sub}
                    </Text>
                  </>
                ) : null}
              </View>
              <View style={styles.ladderNodeWrap}>
                <View
                  style={[
                    styles.ladderNode,
                    { backgroundColor: own ? strokeColor(shot.stroke) : colors.textMuted },
                  ]}
                >
                  <Text style={[styles.ladderNodeText, { fontFamily: NUM }]}>{shot.index}</Text>
                </View>
              </View>
              <View style={styles.ladderCellR}>
                {!own ? (
                  <>
                    <Text style={[styles.ladderTitle, { color: colors.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={[styles.ladderSub, { color: colors.textSub }]} numberOfLines={1}>
                      {sub}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );

  const renderCourt = (rally: RallyRecord) => {
    const pts: ShotLocation[] = rally.bounces
      .map((b) => b.location)
      .filter((l): l is ShotLocation => Boolean(l));
    // Horizontal court: length axis (near→far = self→opponent) left→right.
    const toXY = (l: ShotLocation) => ({ px: 8 + l.y * 84, py: 12 + l.x * 76 });
    const polyPoints = pts.map((l) => {
      const { px, py } = toXY(l);
      return `${px},${py}`;
    });
    return (
      <View
        style={[styles.court, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        <View style={[styles.courtInner, { borderColor: withAlpha(colors.text, 0.14) }]} />
        <View style={[styles.courtNet, { backgroundColor: withAlpha(colors.text, 0.28) }]} />
        {pts.length >= 2 ? (
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFill}
          >
            <Polyline
              points={polyPoints.join(' ')}
              fill="none"
              stroke={colors.primary}
              strokeOpacity={0.35}
              strokeWidth={1.2}
              strokeDasharray="3 3"
            />
          </Svg>
        ) : null}
        {pts.map((l, i) => {
          const { px, py } = toXY(l);
          const isLast = i === pts.length - 1;
          return (
            <View
              key={i}
              style={[
                styles.courtDot,
                {
                  left: `${px}%`,
                  top: `${py}%`,
                  backgroundColor: isLast ? colors.success : colors.primary,
                },
              ]}
            >
              <Text style={[styles.courtDotText, { fontFamily: NUM }]}>{i + 1}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  const renderExpanded = (rally: RallyRecord, index: number) => {
    const outColor =
      rally.outcome === 'won'
        ? colors.primary
        : rally.outcome === 'lost'
          ? colors.danger
          : colors.textMuted;
    const outBg =
      rally.outcome === 'won'
        ? colors.primaryLo
        : rally.outcome === 'lost'
          ? withAlpha(colors.danger, 0.14)
          : colors.surfaceAlt;
    return (
      <View
        key={rally.rally}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setExpanded(-1)}
          style={styles.cardHead}
        >
          <Text style={[styles.cardNum, { color: colors.text, fontFamily: NUM }]}>
            #{rally.rally}
          </Text>
          <View style={[styles.outBadge, { backgroundColor: outBg }]}>
            <Text style={[styles.outBadgeText, { color: outColor }]}>
              {rally.outcome === 'won' ? '勝ち' : rally.outcome === 'lost' ? '負け' : '未確定'}
            </Text>
          </View>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            {rally.shotCount}ショット · {fmtDur(rally.endSec - rally.startSec)}
          </Text>
          {rally.outcomeSource === 'auto' ? (
            <View style={[styles.autoDot, { backgroundColor: colors.warning }]} />
          ) : null}
        </TouchableOpacity>

        {renderLadder(rally)}
        {renderCourt(rally)}
        <Text style={[styles.courtCaption, { color: colors.textMuted }]}>
          バウンド位置と軌跡（推定）
        </Text>

        {/* Correction toggle */}
        <View style={styles.confirmRow}>
          {(['won', 'lost', 'unknown'] as RallyOutcome[]).map((o) => {
            const active = rally.outcome === o;
            return (
              <TouchableOpacity
                key={o}
                activeOpacity={0.85}
                onPress={() =>
                  analysis && confirmRallyOutcome(sessionId, analysis.id, rally.rally, o)
                }
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor: active ? colors.primary : colors.surfaceAlt,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.confirmBtnText,
                    { color: active ? colors.onHero : colors.textSub },
                  ]}
                >
                  {o === 'won' ? '勝ち' : o === 'lost' ? '負け' : '未定'}
                </Text>
              </TouchableOpacity>
            );
          })}
          {index >= 0 ? (
            <Text style={[styles.confirmHint, { color: colors.textMuted }]}>
              {rally.outcomeSource === 'auto' ? '自動推定' : '確認済'}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  const renderCollapsed = (rally: RallyRecord, index: number) => {
    const dot =
      rally.outcome === 'won'
        ? colors.primary
        : rally.outcome === 'lost'
          ? colors.danger
          : colors.textMuted;
    return (
      <TouchableOpacity
        key={rally.rally}
        activeOpacity={0.85}
        onPress={() => setExpanded(index)}
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.rowNum, { color: colors.textSub, fontFamily: NUM }]}>
          #{rally.rally}
        </Text>
        <View style={[styles.rowDot, { backgroundColor: dot }]} />
        <Text style={[styles.rowOut, { color: colors.text }]}>
          {rally.outcome === 'won' ? '勝ち' : rally.outcome === 'lost' ? '負け' : '未確定'}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
          {rally.shotCount}球 · {fmtDur(rally.endSec - rally.startSec)}
        </Text>
        {rally.outcomeSource === 'auto' ? (
          <View style={[styles.autoDot, { backgroundColor: colors.warning, marginLeft: 6 }]} />
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colors.textMuted}
          style={{ marginLeft: 'auto' }}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Dark-green hero header */}
      <View style={[styles.hero, { backgroundColor: colors.hero, paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.heroBack}
          accessibilityLabel="戻る"
          testID="rally-history-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.heroAccent} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroEyebrow, { color: colors.heroAccent }]}>ラリー履歴</Text>
          <Text style={[styles.heroTitle, { color: colors.onHero }]} numberOfLines={1}>
            {session?.opponentName ? `vs ${session.opponentName}` : session?.title} ·{' '}
            {rallies.length}
            ラリー
          </Text>
        </View>
        <View style={styles.heroScore}>
          <Text style={[styles.heroScoreNum, { color: colors.onHero, fontFamily: NUM }]}>
            {won}
          </Text>
          <Text style={[styles.heroScoreDash, { color: withAlpha(colors.onHero, 0.5) }]}>-</Text>
          <Text
            style={[styles.heroScoreNum, { color: withAlpha(colors.onHero, 0.6), fontFamily: NUM }]}
          >
            {lost}
          </Text>
        </View>
      </View>

      {!analysis || rallies.length === 0 ? (
        <SafeAreaView edges={['bottom']} style={styles.emptyWrap}>
          <EmptyState
            title="ラリー履歴がありません"
            description="動画をクラウド解析するとラリー履歴が表示されます。"
          />
        </SafeAreaView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Histogram */}
          <View
            style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelLabel, { color: colors.textSub }]}>ラリー長の分布</Text>
              <Text style={[styles.panelMeta, { color: colors.textMuted }]}>
                平均{' '}
                <Text style={{ fontFamily: NUM, color: colors.text, fontSize: 13 }}>
                  {avgShots.toFixed(1)}
                </Text>{' '}
                球
              </Text>
            </View>
            <View style={styles.hist}>
              {histogram.map((h) => (
                <View key={h.label} style={styles.histCol}>
                  <View
                    style={[
                      styles.histBar,
                      { height: Math.max(3, h.h), backgroundColor: colors.primary },
                    ]}
                  />
                  <Text style={[styles.histLabel, { color: colors.textMuted, fontFamily: NUM }]}>
                    {h.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Unconfirmed bulk confirm */}
          {unconfirmed.length > 0 ? (
            <View
              style={[styles.unconfirmed, { backgroundColor: withAlpha(colors.warning, 0.14) }]}
            >
              <View style={[styles.autoDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.unconfirmedText, { color: colors.warning }]}>
                未確定のラリーが {unconfirmed.length}件
              </Text>
              <TouchableOpacity
                onPress={bulkConfirm}
                activeOpacity={0.85}
                style={[styles.bulkBtn, { backgroundColor: colors.warning }]}
                testID="rally-bulk-confirm"
              >
                <Text style={styles.bulkBtnText}>まとめて確認</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Rally list */}
          <View style={styles.list}>
            {rallies.map((rally, i) =>
              i === expanded ? renderExpanded(rally, i) : renderCollapsed(rally, i)
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroBack: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  heroEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  heroTitle: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  heroScore: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  heroScoreNum: { fontSize: 22, fontWeight: '700' },
  heroScoreDash: { fontSize: 11 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  scroll: { padding: 16, gap: 10, paddingBottom: 40 },

  panel: { borderWidth: 1, borderRadius: 12, padding: 12 },
  panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  panelLabel: { fontSize: 10, fontWeight: '500' },
  panelMeta: { fontSize: 10 },
  hist: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 42, marginTop: 9 },
  histCol: { flex: 1, alignItems: 'stretch', gap: 4 },
  histBar: { borderRadius: 2 },
  histLabel: { fontSize: 8, textAlign: 'center' },

  unconfirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 10,
  },
  unconfirmedText: { flex: 1, fontSize: 11, fontWeight: '600' },
  bulkBtn: {
    height: 34,
    borderRadius: 9,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },

  list: { gap: 9 },
  card: { borderWidth: 1, borderRadius: 14, padding: 13 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardNum: { fontSize: 19, fontWeight: '700' },
  outBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  outBadgeText: { fontSize: 10, fontWeight: '700' },
  cardMeta: { fontSize: 10 },
  autoDot: { width: 7, height: 7, borderRadius: 4 },

  ladderWrap: { marginTop: 11 },
  sideLabels: { flexDirection: 'row', alignItems: 'center' },
  sideLabel: { flex: 1, fontSize: 9, fontWeight: '500' },
  sideLabelL: { textAlign: 'right', paddingRight: 12 },
  sideLabelR: { textAlign: 'left', paddingLeft: 12 },
  ladder: { position: 'relative', marginTop: 4 },
  ladderRail: { position: 'absolute', left: '50%', top: 10, bottom: 10, width: 2, marginLeft: -1 },
  ladderRow: { flexDirection: 'row', alignItems: 'center', height: 38 },
  ladderCellL: { flex: 1, alignItems: 'flex-end', paddingRight: 12, minWidth: 0 },
  ladderCellR: { flex: 1, alignItems: 'flex-start', paddingLeft: 12, minWidth: 0 },
  ladderNodeWrap: { width: 26, alignItems: 'center' },
  ladderNode: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ladderNodeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  ladderTitle: { fontSize: 12, fontWeight: '500' },
  ladderSub: { fontSize: 9, marginTop: 1 },

  court: {
    position: 'relative',
    height: 104,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  courtInner: { position: 'absolute', left: 7, right: 7, top: 7, bottom: 7, borderWidth: 1 },
  courtNet: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, marginLeft: -1 },
  courtDot: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: 8,
    marginLeft: -7.5,
    marginTop: -7.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courtDotText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },
  courtCaption: { fontSize: 9, marginTop: 5 },

  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 },
  confirmBtn: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 12, fontWeight: '600' },
  confirmHint: { marginLeft: 'auto', fontSize: 10 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 14,
  },
  rowNum: { fontSize: 15, fontWeight: '700' },
  rowDot: { width: 6, height: 6, borderRadius: 3 },
  rowOut: { fontSize: 11, fontWeight: '500' },
  rowMeta: { fontSize: 10 },
});
