import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AnalysisConfidenceBanner,
  CourtLines,
  Donut,
  EmptyState,
  SectionHeader,
  Tag,
} from '@/components/common';
import { CourtHeatmap } from '@/components/court';
import { ReportDrillList, ReportInsightList, ReportTipList } from '@/components/report';
import { WEAKNESS_LABELS } from '@/constants/labels';
import { getAnalyzer } from '@/services/analysis';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { formatDate } from '@/utils/date';
import { formatPercent } from '@/utils/format';
import { pushRoute } from '@/utils/navigation';
import { isConfirmed, isPointComplete } from '@/utils/pointDetails';
import { REPORT_CHART_COLORS, computeReportStats } from '@/utils/reportStats';

export default function ReportTabScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const sessions = useSessionStore((s) => s.sessions);
  const latestSession =
    sessions.length > 0
      ? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : null;

  const allPoints = useMemo(() => sessions.flatMap((s) => s.points), [sessions]);
  const totalCompleteCount = useMemo(
    () => allPoints.filter((p) => isConfirmed(p) && isPointComplete(p)).length,
    [allPoints]
  );
  const totalDraftCount = useMemo(
    () => allPoints.filter((p) => !isConfirmed(p)).length,
    [allPoints]
  );

  const analysis = useMemo(
    () => (latestSession ? getAnalyzer().analyze(latestSession) : null),
    [latestSession]
  );
  const stats = useMemo(
    () => (latestSession ? computeReportStats(latestSession) : null),
    [latestSession]
  );

  if (!latestSession || !analysis || !stats) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyCenter}>
          <EmptyState
            title="まだセッションがありません"
            description="新規ボタンからセッションを作成してレポートを確認しましょう"
            action={{
              label: '新規セッションを開始',
              onPress: () => pushRoute(router, '/session/new'),
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const s = latestSession;
  const { wonCount, lostCount, completePointCount, quickPointCount, shotBreakdown, locations } =
    stats;

  const donutItems = shotBreakdown
    .filter((it) => it.total > 0)
    .map((it, i) => ({
      value: it.total,
      color: REPORT_CHART_COLORS[i % REPORT_CHART_COLORS.length],
    }));

  const keyStats = [
    { l: 'ポイント', v: `${s.points.length}`, c: colors.text },
    { l: '得点率', v: formatPercent(analysis.winRate), c: colors.success },
    { l: '1st%', v: formatPercent(analysis.firstServeInRate), c: colors.text },
    { l: '詳細', v: `${completePointCount}/${s.points.length}`, c: colors.text },
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
              <Text style={[styles.heroDate, { color: colors.surface }]}>
                {formatDate(s.startedAt)}
              </Text>
            </View>
            <Text style={[styles.heroTitle, { color: colors.surface }]}>{s.title}</Text>
            <Text style={[styles.heroScore, { color: colors.surface }]}>
              {wonCount}–{lostCount}
            </Text>
            {quickPointCount > 0 ? (
              <Text style={[styles.heroSub, { color: colors.surface }]}>
                詳細未入力 {quickPointCount}
              </Text>
            ) : null}
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
          {quickPointCount > 0 ? (
            <View
              style={[
                styles.detailNotice,
                { backgroundColor: colors.surface, borderColor: colors.warning },
              ]}
            >
              <Text style={[styles.detailNoticeText, { color: colors.text }]}>
                詳細未入力 {quickPointCount} 件。分析グラフは詳細入力済み {completePointCount}{' '}
                件をもとに表示します。
              </Text>
            </View>
          ) : null}
        </View>

        {/* shot breakdown */}
        <AnalysisConfidenceBanner completeCount={totalCompleteCount} draftCount={totalDraftCount} />
        <SectionHeader title="ショット内訳" />
        <View style={styles.padH}>
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.donutRow}>
              <Donut items={donutItems} size={108} stroke={14} />
              <View style={styles.donutLegend}>
                {shotBreakdown
                  .filter((it) => it.total > 0)
                  .map((it, i) => (
                    <View key={it.shotType} style={styles.legendItem}>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: REPORT_CHART_COLORS[i % REPORT_CHART_COLORS.length] },
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
        <View style={styles.padH}>
          <ReportInsightList
            items={analysis.strengths}
            icon="↑"
            tone="success"
            emptyText="まだ強みを判定できません"
          />
        </View>

        {/* weaknesses */}
        <SectionHeader title="改善ポイント" />
        <View style={styles.padH}>
          <ReportInsightList
            items={analysis.weaknesses.map((w) => WEAKNESS_LABELS[w])}
            icon="↓"
            tone="danger"
            emptyText="目立った弱点はまだありません"
          />
        </View>

        {/* coaching tips */}
        <SectionHeader title="改善コメント" />
        <View style={styles.padH}>
          <ReportTipList tips={analysis.tips} />
        </View>

        {/* drills */}
        <SectionHeader title="練習メニュー" />
        <View style={[styles.padH, { paddingBottom: 80 }]}>
          <ReportDrillList drills={analysis.drills} />
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
  heroSub: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    opacity: 0.86,
  },
  statsGridWrap: {
    padding: 20,
    paddingBottom: 22,
    gap: 10,
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
  detailNotice: {
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 12,
  },
  detailNoticeText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
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
});
