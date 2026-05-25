import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AnalysisConfidenceBanner,
  Card,
  CourtLines,
  Donut,
  EmptyState,
  ExportMenu,
  SectionHeader,
  Tag,
  ToolEntryCard,
} from '@/components/common';
import { CourtHeatmap } from '@/components/court';
import { FormAnalysisEntryCard } from '@/components/pose';
import { ReportDrillList, ReportInsightList, ReportTipList } from '@/components/report';
import { WEAKNESS_LABELS } from '@/constants/labels';
import { useSession } from '@/hooks';
import { getAnalyzer } from '@/services/analysis';
import { computeMatchScore } from '@/services/scoring';
import { useTheme } from '@/theme';
import { formatDate } from '@/utils/date';
import { formatPercent } from '@/utils/format';
import { pushRoute } from '@/utils/navigation';
import { REPORT_CHART_COLORS, computeReportStats } from '@/utils/reportStats';

export default function ReportScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const analysis = useMemo(() => (session ? getAnalyzer().analyze(session) : null), [session]);
  const matchScore = useMemo(
    () =>
      session && session.sessionType === 'match'
        ? computeMatchScore(
            [...session.points].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            ),
            session.sport
          )
        : undefined,
    [session]
  );
  const stats = useMemo(() => (session ? computeReportStats(session) : null), [session]);

  if (!session || !analysis || !stats) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState icon="alert-circle-outline" title="セッションが見つかりません" />
        </View>
      </SafeAreaView>
    );
  }

  const {
    wonCount,
    lostCount,
    totalPoints,
    completePointCount,
    quickPointCount,
    draftCount,
    shotBreakdown,
    locations,
  } = stats;

  const sessionVideoUri = session.videoUri;

  const donutItems = shotBreakdown
    .filter((s) => s.total > 0)
    .map((s, i) => ({
      value: s.total,
      color: REPORT_CHART_COLORS[i % REPORT_CHART_COLORS.length],
    }));

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              accessibilityLabel="エクスポート"
              accessibilityRole="button"
              onPress={() => setExportMenuOpen(true)}
              style={styles.headerButton}
            >
              <Ionicons color={colors.surface} name="share-outline" size={23} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero card */}
        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <View style={styles.heroMotif} pointerEvents="none">
            <CourtLines stroke={colors.surface} strokeOpacity={0.18} strokeWidth={1.4} />
          </View>
          <View style={styles.heroMeta}>
            <Tag color={colors.surface} bg={`${colors.surface}2E`}>
              {session.sport === 'tennis' ? '硬式' : 'ソフト'}
            </Tag>
            <Tag color={colors.surface} bg={`${colors.surface}2E`}>
              {session.matchFormat === 'singles' ? 'シングルス' : 'ダブルス'}
            </Tag>
            {wonCount > lostCount && (
              <Tag color={colors.surface} bg={`${colors.surface}47`}>
                勝
              </Tag>
            )}
            <Text style={[styles.heroDate, { color: colors.surface }]}>
              {formatDate(session.createdAt)}
            </Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.surface }]} numberOfLines={1}>
            {session.title}
          </Text>
          <Text style={[styles.heroScore, { color: colors.surface }]}>
            {wonCount}–{lostCount}
          </Text>
          <Text style={[styles.heroSub, { color: colors.surface }]}>
            {totalPoints} ポイント
            {quickPointCount > 0 ? ` ・ 詳細未入力 ${quickPointCount}` : ''}
          </Text>
        </View>

        {/* Key stats row */}
        <View
          style={[styles.statsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {[
            { label: 'ポイント', value: String(totalPoints), color: colors.text },
            { label: '得点率', value: formatPercent(analysis.winRate), color: colors.success },
            { label: '1st%', value: formatPercent(analysis.firstServeInRate), color: colors.text },
            { label: '詳細', value: `${completePointCount}/${totalPoints}`, color: colors.text },
          ].map((stat, i, arr) => (
            <View
              key={stat.label}
              style={[
                styles.statCell,
                i < arr.length - 1 && { borderRightWidth: 0.5, borderRightColor: colors.border },
              ]}
            >
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{stat.label}</Text>
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
              詳細未入力 {quickPointCount} 件。ショット内訳、ヒートマップ、弱点分析は詳細入力済み
              {completePointCount} 件をもとに表示します。
            </Text>
          </View>
        ) : null}

        {/* Shot breakdown with donut */}
        <AnalysisConfidenceBanner completeCount={completePointCount} draftCount={draftCount} />
        <View>
          <SectionHeader title="ショット内訳" />
          <View
            style={[
              styles.donutCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Donut
              size={108}
              stroke={14}
              items={donutItems.length > 0 ? donutItems : [{ value: 1, color: colors.border }]}
            />
            <View style={styles.donutLegend}>
              {shotBreakdown
                .filter((s) => s.total > 0)
                .map((s, i) => (
                  <View key={s.shotType} style={styles.donutLegendRow}>
                    <View
                      style={[
                        styles.donutDot,
                        { backgroundColor: REPORT_CHART_COLORS[i % REPORT_CHART_COLORS.length] },
                      ]}
                    />
                    <Text style={[styles.donutLegendLabel, { color: colors.text }]}>{s.label}</Text>
                    <Text style={[styles.donutLegendVal, { color: colors.textSub }]}>
                      {s.total}
                    </Text>
                  </View>
                ))}
            </View>
          </View>
        </View>

        {/* Heatmap */}
        <View>
          <SectionHeader title="ヒートマップ" />
          <View
            style={[
              styles.heatmapCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.heatmapHint, { color: colors.textMuted }]}>
              相手コートへのボール着地分布
            </Text>
            {locations.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                ショット位置が記録されていません
              </Text>
            ) : (
              <>
                <CourtHeatmap locations={locations} sport={session.sport} />
                <View style={styles.heatmapScale}>
                  <Text style={[styles.heatmapScaleText, { color: colors.textMuted }]}>少 ←</Text>
                  <Text style={[styles.heatmapScaleText, { color: colors.textMuted }]}>→ 多</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Strengths */}
        <View>
          <SectionHeader title="強み" />
          {analysis.strengths.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                まだ強みを判定できません
              </Text>
            </Card>
          ) : (
            <ReportInsightList
              items={analysis.strengths}
              icon="↑"
              tone="success"
              emptyText="まだ強みを判定できません"
            />
          )}
        </View>

        {/* Weaknesses */}
        <View>
          <SectionHeader title="改善ポイント" />
          {analysis.weaknesses.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                目立った弱点はまだありません
              </Text>
            </Card>
          ) : (
            <ReportInsightList
              items={analysis.weaknesses.map((w) => WEAKNESS_LABELS[w])}
              icon="↓"
              tone="danger"
              emptyText="目立った弱点はまだありません"
            />
          )}
        </View>

        {/* Coach comments */}
        <View>
          <SectionHeader title="改善コメント" />
          {analysis.tips.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                改善コメントはまだありません
              </Text>
            </Card>
          ) : (
            <ReportTipList tips={analysis.tips} />
          )}
        </View>

        {/* Practice drills */}
        <View>
          <SectionHeader title="練習メニュー" />
          {analysis.drills.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                練習メニューはまだありません
              </Text>
            </Card>
          ) : (
            <ReportDrillList drills={analysis.drills} />
          )}
        </View>

        {sessionVideoUri ? (
          <View>
            <SectionHeader title="フォーム分析" />
            <FormAnalysisEntryCard
              onPress={() => {
                const href = {
                  pathname: '/form-analysis/select',
                  params: { videoUri: sessionVideoUri, shotType: 'forehand' },
                };
                pushRoute(router, href);
              }}
            />
          </View>
        ) : null}

        {sessionVideoUri ? (
          <View>
            <SectionHeader title="コート較正" />
            <ToolEntryCard
              accessibilityLabel="コート較正を開く"
              badgeLabel={session.courtCalibration ? '設定済み' : undefined}
              iconName="analytics-outline"
              onPress={() => {
                pushRoute(router, `/session/${session.id}/calibration`);
              }}
              subtitle="動画からコートの座標を設定"
              title="コート較正"
            />
          </View>
        ) : null}

        {sessionVideoUri && session.courtCalibration ? (
          <View>
            <SectionHeader title="自動採点" />
            <ToolEntryCard
              accessibilityLabel="自動採点を開く"
              iconName="trophy-outline"
              onPress={() => {
                pushRoute(router, `/session/${session.id}/auto-score`);
              }}
              subtitle="動画からポイントを自動検出"
              title="自動採点（実験的）"
            />
          </View>
        ) : null}

        {session.sport === 'softTennis' && session.matchFormat === 'doubles' ? (
          <View>
            <SectionHeader title="前衛コーチング" />
            <Card>
              <Text style={[styles.emptyText, { color: colors.textSub }]}>
                前衛コーチング（Phase 4 以降で実装予定）
              </Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>
      {exportMenuOpen ? (
        <ExportMenu
          analysis={analysis}
          matchScore={matchScore}
          onClose={() => setExportMenuOpen(false)}
          session={session}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  headerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    minHeight: 44,
    minWidth: 44,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 22,
  },
  hero: {
    borderRadius: 16,
    padding: 18,
    position: 'relative',
    overflow: 'hidden',
  },
  heroMotif: {
    position: 'absolute',
    right: -10,
    top: -10,
    width: 220,
    height: 110,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  heroDate: {
    marginLeft: 'auto',
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
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  heroSub: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 0.5,
    paddingVertical: 14,
    paddingHorizontal: 8,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
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
  donutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  donutLegend: {
    flex: 1,
    gap: 6,
  },
  donutLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  donutDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  donutLegendLabel: {
    flex: 1,
    fontSize: 12,
  },
  donutLegendVal: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  heatmapCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  heatmapHint: {
    fontSize: 11,
    alignSelf: 'flex-start',
    fontVariant: ['tabular-nums'],
  },
  heatmapScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  heatmapScaleText: {
    fontSize: 10,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
