import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourtLines, Donut, EmptyState, SectionHeader, Tag } from '@/components/common';
import { CourtHeatmap } from '@/components/court';
import { SHOT_TYPE_META, SHOT_TYPES } from '@/constants/shotTypes';
import { getAnalyzer } from '@/services/analysis';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import {
  type ShotLocation,
  type ShotType,
  type TennisSession,
  type WeaknessPattern,
} from '@/types';
import { formatPercent } from '@/utils/format';

const WEAKNESS_LABELS: Record<WeaknessPattern, string> = {
  highDoubleFault: 'ダブルフォルトが多い',
  lowFirstServeIn: 'ファーストサーブ成功率が低い',
  shortRally: 'ラリーが短く終わりやすい',
  weakBackhand: 'バックハンドで失点が多い',
  weakVolley: 'ボレーで失点が多い',
  frequentUnforcedError: '凡ミスの割合が高い',
  poorNetApproach: 'ネットプレーの展開が少ない',
};

interface ShotBreakdownItem {
  shotType: ShotType;
  label: string;
  total: number;
  wonCount: number;
  lostCount: number;
}

function hasLocation(loc: ShotLocation | undefined): loc is ShotLocation {
  return loc !== undefined;
}

function calculateShotBreakdown(session: TennisSession): ShotBreakdownItem[] {
  return SHOT_TYPES.map((shotType) => {
    const pts = session.points.filter((p) => p.shotType === shotType);
    return {
      shotType,
      label: SHOT_TYPE_META[shotType].label,
      total: pts.length,
      wonCount: pts.filter((p) => p.outcome === 'won').length,
      lostCount: pts.filter((p) => p.outcome === 'lost').length,
    };
  }).filter((it) => it.total > 0);
}

const CHART_COLORS = ['#1F6F4A', '#0F2B5B', '#C97A12', '#1F8A5B', '#C4453E', '#94A097'];

export default function ReportTabScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const sessions = useSessionStore((s) => s.sessions);
  const latestSession =
    sessions.length > 0
      ? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : null;

  const analysis = useMemo(
    () => (latestSession ? getAnalyzer().analyze(latestSession) : null),
    [latestSession]
  );
  const shotBreakdown = useMemo(
    () => (latestSession ? calculateShotBreakdown(latestSession) : []),
    [latestSession]
  );
  const locations = useMemo(
    () =>
      latestSession ? latestSession.points.map((p) => p.shotLocation).filter(hasLocation) : [],
    [latestSession]
  );

  if (!latestSession || !analysis) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyCenter}>
          <EmptyState
            title="まだセッションがありません"
            description="新規ボタンからセッションを作成してレポートを確認しましょう"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            action={{
              label: '新規セッションを開始',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onPress: () => router.push('/session/new' as any),
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const s = latestSession;
  const wonCount = s.points.filter((p) => p.outcome === 'won').length;
  const lostCount = s.points.filter((p) => p.outcome === 'lost').length;
  const date = new Date(s.startedAt);
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

  const donutItems = shotBreakdown.map((it, i) => ({
    value: it.total,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const keyStats = [
    { l: 'ポイント', v: `${s.points.length}`, c: colors.text },
    { l: '得点率', v: formatPercent(analysis.winRate), c: colors.success },
    { l: '1st%', v: formatPercent(analysis.firstServeInRate), c: colors.text },
    { l: 'エース', v: `${analysis.aceCount}`, c: colors.text },
  ];

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* hero card */}
        <View style={styles.heroPad}>
          <View style={[styles.hero, { backgroundColor: colors.primary }]}>
            <View style={styles.courtMotif} pointerEvents="none">
              <CourtLines stroke={colors.surface} strokeOpacity={0.18} strokeWidth={1.4} />
            </View>
            <View style={styles.heroTagRow}>
              <Tag color={colors.surface} bg="rgba(255,255,255,0.18)">
                {s.sport === 'tennis' ? '硬式' : 'ソフト'}
              </Tag>
              <Tag color={colors.surface} bg="rgba(255,255,255,0.18)">
                {s.matchFormat === 'singles' ? 'シングルス' : 'ダブルス'}
              </Tag>
              <View style={{ flex: 1 }} />
              <Text style={[styles.heroDate, { color: colors.surface }]}>{dateStr}</Text>
            </View>
            <Text style={[styles.heroTitle, { color: colors.surface }]}>{s.title}</Text>
            <Text style={[styles.heroScore, { color: colors.surface }]}>
              {wonCount}–{lostCount}
            </Text>
          </View>
        </View>

        {/* key stats */}
        <View style={styles.statsGridWrap}>
          <View
            style={[
              styles.statsGrid,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {keyStats.map((it, i) => (
              <View
                key={it.l}
                style={[
                  styles.statCell,
                  { borderRightColor: colors.border, borderRightWidth: i < 3 ? 0.5 : 0 },
                ]}
              >
                <Text style={[styles.statValue, { color: it.c }]}>{it.v}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>{it.l}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* shot breakdown */}
        <SectionHeader title="ショット内訳" />
        <View style={styles.padH}>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.donutRow}>
              <Donut items={donutItems} size={108} stroke={14} />
              <View style={styles.donutLegend}>
                {shotBreakdown.map((it, i) => (
                  <View key={it.shotType} style={styles.legendItem}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] },
                      ]}
                    />
                    <Text style={[styles.legendLabel, { color: colors.text }]}>{it.label}</Text>
                    <Text style={[styles.legendVal, { color: colors.textSub }]}>{it.total}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* heatmap */}
        <SectionHeader title="ヒートマップ" />
        <View style={styles.padH}>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.heatmapHint, { color: colors.textMuted }]}>
              相手コートへのボール着地分布
            </Text>
            {locations.length > 0 ? (
              <CourtHeatmap locations={locations} sport={s.sport} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                ショット位置が記録されていません
              </Text>
            )}
          </View>
        </View>

        {/* strengths */}
        <SectionHeader title="強み" />
        <View style={[styles.padH, styles.cardGap]}>
          {analysis.strengths.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              まだ強みを判定できません
            </Text>
          ) : (
            analysis.strengths.map((str) => (
              <View
                key={str}
                style={[
                  styles.insightCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.insightBar, { backgroundColor: colors.success }]} />
                <View style={[styles.insightBadge, { backgroundColor: `${colors.success}1A` }]}>
                  <Text style={{ fontSize: 16, color: colors.success }}>↑</Text>
                </View>
                <Text style={[styles.insightText, { color: colors.text }]}>{str}</Text>
              </View>
            ))
          )}
        </View>

        {/* weaknesses */}
        <SectionHeader title="改善ポイント" />
        <View style={[styles.padH, styles.cardGap]}>
          {analysis.weaknesses.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              目立った弱点はまだありません
            </Text>
          ) : (
            analysis.weaknesses.map((w) => (
              <View
                key={w}
                style={[
                  styles.insightCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.insightBar, { backgroundColor: colors.danger }]} />
                <View style={[styles.insightBadge, { backgroundColor: `${colors.danger}1A` }]}>
                  <Text style={{ fontSize: 16, color: colors.danger }}>↓</Text>
                </View>
                <Text style={[styles.insightText, { color: colors.text }]}>
                  {WEAKNESS_LABELS[w]}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* coaching tips */}
        <SectionHeader title="改善コメント" />
        <View style={[styles.padH, styles.cardGap]}>
          {analysis.tips.map((tip) => {
            const tone =
              tip.priority === 'high'
                ? colors.danger
                : tip.priority === 'medium'
                  ? colors.warning
                  : colors.textSub;
            const label =
              tip.priority === 'high'
                ? '優先 高'
                : tip.priority === 'medium'
                  ? '優先 中'
                  : '優先 低';
            return (
              <View
                key={tip.id}
                style={[
                  styles.commentCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.commentHeader}>
                  <Tag color={tone} bg={`${tone}1A`}>
                    ● {label}
                  </Tag>
                  <Text style={[styles.commentTitle, { color: colors.text }]}>{tip.title}</Text>
                </View>
                <Text style={[styles.commentBody, { color: colors.textSub }]}>
                  {tip.description}
                </Text>
              </View>
            );
          })}
        </View>

        {/* drills */}
        <SectionHeader title="練習メニュー" />
        <View style={[styles.padH, { gap: 8, paddingBottom: 80 }]}>
          {analysis.drills.map((drill) => (
            <TouchableOpacity
              key={drill.id}
              activeOpacity={0.88}
              style={[
                styles.drillCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.drillBadge, { backgroundColor: colors.primaryLo }]}>
                <Text style={[styles.drillMin, { color: colors.primary }]}>
                  {drill.durationMin}
                </Text>
                <Text style={[styles.drillMinLabel, { color: colors.primary }]}>分</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drillName, { color: colors.text }]}>{drill.name}</Text>
                <Text style={[styles.drillDesc, { color: colors.textSub }]} numberOfLines={2}>
                  {drill.description}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {},
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroPad: { padding: 20, paddingBottom: 0 },
  hero: {
    borderRadius: 16,
    padding: 18,
    paddingBottom: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  courtMotif: {
    position: 'absolute',
    right: -10,
    top: -10,
    width: 220,
    height: 110,
    pointerEvents: 'none',
  },
  heroTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  heroDate: {
    fontSize: 11,
    opacity: 0.8,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  heroScore: {
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.3,
  },
  statsGridWrap: {
    padding: 20,
    paddingBottom: 22,
  },
  statsGrid: {
    borderRadius: 14,
    borderWidth: 0.5,
    flexDirection: 'row',
    padding: 14,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    letterSpacing: 0.04,
  },
  padH: { paddingHorizontal: 20, marginBottom: 22 },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  donutLegend: { flex: 1, gap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1, fontSize: 12 },
  legendVal: { fontSize: 12, fontWeight: '600' },
  heatmapHint: { fontSize: 11, marginBottom: 8 },
  emptyText: { fontSize: 13, textAlign: 'center', padding: 12 },
  cardGap: { gap: 8 },
  insightCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  insightBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  insightBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightText: { flex: 1, fontSize: 13, fontWeight: '600' },
  commentCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  commentTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  commentBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  drillCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  drillBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drillMin: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
    letterSpacing: -0.3,
  },
  drillMinLabel: { fontSize: 8, fontWeight: '600' },
  drillName: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  drillDesc: { fontSize: 11, lineHeight: 16 },
});
