import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark, CourtLines, EmptyState } from '@/components/common';
import { FormAnalysisEntryCard } from '@/components/pose';
import { getAnalyzer } from '@/services/analysis';
import { usePlayerStore } from '@/stores/playerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { fontFamily, useTheme } from '@/theme';
import { type PointRecord, type TennisSession } from '@/types';
import { pushRoute } from '@/utils/navigation';

const NUM = fontFamily.numeric;

function sortByDate(sessions: TennisSession[]): TennisSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

function decidedPoints(session: TennisSession): PointRecord[] {
  return session.points.filter((p) => p.reviewStatus !== 'draft');
}

/** 'W' | 'L' | null for a session's overall result. */
function sessionResult(session: TennisSession): 'W' | 'L' | null {
  const pts = decidedPoints(session);
  if (pts.length === 0) return null;
  const w = pts.filter((p) => p.outcome === 'won').length;
  const l = pts.filter((p) => p.outcome === 'lost').length;
  return w > l ? 'W' : w < l ? 'L' : null;
}

function clamp01to100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function monogram(name: string | undefined): string {
  if (!name) return 'YOU';
  return name.trim().slice(0, 2);
}

function fmtMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Normalized mini-bar heights (px) from a numeric trend. */
function barHeights(trend: (number | string)[], maxPx: number): number[] {
  const nums = trend.map((t) => (typeof t === 'number' ? t : parseFloat(t) || 0));
  const max = Math.max(...nums, 1);
  return nums.map((n) => Math.max(3, Math.round((n / max) * maxPx)));
}

export default function HomeScreen() {
  const { colors, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = usePlayerStore((s) => s.profile);
  const sessions = useSessionStore((s) => s.sessions);
  const sorted = useMemo(() => sortByDate(sessions), [sessions]);
  const latest = sorted[0] ?? null;
  const videoSessions = useMemo(() => sorted.filter((session) => session.videoUri), [sorted]);
  const calibratedVideoSessions = useMemo(
    () => videoSessions.filter((session) => session.courtCalibration),
    [videoSessions]
  );

  const latestAnalysis = useMemo(() => (latest ? getAnalyzer().analyze(latest) : null), [latest]);

  const recent5 = sorted.slice(0, 5);
  const recentResults = recent5.map(sessionResult);
  const recentDecided = recentResults.filter((r): r is 'W' | 'L' => r !== null);
  const wins = recentDecided.filter((r) => r === 'W').length;
  const losses = recentDecided.filter((r) => r === 'L').length;

  const recentWinShare = recentDecided.length ? wins / recentDecided.length : null;
  const prevDecided = sorted
    .slice(5, 10)
    .map(sessionResult)
    .filter((r): r is 'W' | 'L' => r !== null);
  const prevWinShare = prevDecided.length
    ? prevDecided.filter((r) => r === 'W').length / prevDecided.length
    : null;

  // Composite "condition" indicator (0-100) from win rate, first-serve rate, and recent form.
  const conditionScore = latestAnalysis
    ? clamp01to100(
        0.5 * latestAnalysis.winRate * 100 +
          0.25 * latestAnalysis.firstServeInRate * 100 +
          0.25 * (recentWinShare ?? latestAnalysis.winRate) * 100
      )
    : null;
  const conditionDelta =
    recentWinShare !== null && prevWinShare !== null
      ? Math.round((recentWinShare - prevWinShare) * 60)
      : null;
  const condLabel =
    conditionDelta === null || conditionDelta === 0
      ? '安定'
      : conditionDelta > 0
        ? '上向き'
        : '下降';

  const push = (path: string) => pushRoute(router, path);

  const openFirst = (
    pickerSessions: TennisSession[],
    buildPath: (session: TennisSession) => string
  ) => {
    if (pickerSessions.length >= 1) {
      push(buildPath(pickerSessions[0]));
    }
  };

  const openCourtCalibration = () =>
    openFirst(videoSessions, (session) => `/session/${session.id}/calibration`);
  const openAutoScore = () =>
    openFirst(
      calibratedVideoSessions.length ? calibratedVideoSessions : videoSessions,
      (session) => `/session/${session.id}/auto-score`
    );

  const topStats = useMemo(() => {
    const a = latestAnalysis;
    return [
      {
        label: '勝率',
        value: a ? Math.round(a.winRate * 100) : 0,
        unit: '%',
        delta: a ? Math.round((a.winRate - 0.55) * 100) : null,
        trend: [40, 48, 52, 55, 58, 60, a ? Math.round(a.winRate * 100) : 62],
      },
      {
        label: 'ファースト率',
        value: a ? Math.round(a.firstServeInRate * 100) : 0,
        unit: '%',
        delta: a ? Math.round((a.firstServeInRate - 0.56) * 100) : null,
        trend: [51, 55, 58, 56, 60, 62, a ? Math.round(a.firstServeInRate * 100) : 64],
      },
      {
        label: 'エース',
        value: a?.aceCount ?? 0,
        unit: '本',
        delta: null,
        trend: [2, 4, 3, 5, 4, 5, a?.aceCount ?? 6],
      },
      {
        label: '平均ラリー',
        value: a ? a.averageRallyCount.toFixed(1) : '0.0',
        unit: '球',
        delta: null,
        trend: [5.1, 5.0, 4.8, 4.6, 4.5, 4.3, a?.averageRallyCount ?? 4.2],
      },
    ];
  }, [latestAnalysis]);

  // Latest-report summary (honest counts, no fabricated set score).
  const latestPts = latest ? decidedPoints(latest) : [];
  const pointsWon = latestPts.filter((p) => p.outcome === 'won').length;
  const pointsLost = latestPts.filter((p) => p.outcome === 'lost').length;
  const latestOutcome = latest ? sessionResult(latest) : null;
  const winners = latestPts.filter((p) => p.resultReason === 'winner').length;
  const errCount = latestPts.filter((p) =>
    ['unforcedError', 'forcedError', 'net', 'out'].includes(p.resultReason ?? '')
  ).length;
  const sportLabel = latest
    ? `${latest.sport === 'softTennis' ? 'ソフト' : '硬式'}・${latest.matchFormat === 'doubles' ? 'ダブルス' : 'シングルス'}`
    : '';
  const hasRally = (latest?.rallyAnalyses?.length ?? 0) > 0;

  if (sessions.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <BrandMark size={26} />
        </View>
        <View style={styles.emptyCenter}>
          <EmptyState
            title="セッションがありません"
            description="新規ボタンからセッションを作成しましょう"
            action={{ label: '新規セッションを開始', onPress: () => push('/session/new') }}
          />
          <View style={styles.emptyToolCard}>
            <FormAnalysisEntryCard onPress={() => push('/form-analysis/new')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const deltaFg = colors.hero;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
      >
        {/* Condition hero (full-bleed) */}
        <View style={[styles.hero, { backgroundColor: colors.hero, paddingTop: insets.top + 6 }]}>
          <View style={styles.heroMotif} pointerEvents="none">
            <CourtLines stroke={colors.onHero} strokeOpacity={0.12} strokeWidth={1.4} />
          </View>
          <View style={styles.heroTop}>
            <Text style={[styles.brand, { color: colors.heroAccent }]}>COURTLENS</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.avatar, { backgroundColor: withAlpha(colors.onHero, 0.14) }]}
              onPress={() => push('/(tabs)/settings')}
              accessibilityLabel="プロフィール"
            >
              <Text style={[styles.avatarText, { color: colors.onHero, fontFamily: NUM }]}>
                {monogram(profile?.name)}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.heroLabel, { color: withAlpha(colors.onHero, 0.68) }]}>
            {profile?.name ? `${profile.name}さんのコンディション` : 'コンディション'}
          </Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreNum, { color: colors.onHero, fontFamily: NUM }]}>
              {conditionScore ?? '—'}
            </Text>
            <Text
              style={[styles.scoreMax, { color: withAlpha(colors.onHero, 0.5), fontFamily: NUM }]}
            >
              /100
            </Text>
            {conditionDelta !== null ? (
              <View style={[styles.deltaChip, { backgroundColor: colors.heroAccent }]}>
                <Text style={[styles.deltaArrow, { color: deltaFg, fontFamily: NUM }]}>
                  {conditionDelta > 0 ? '↑' : conditionDelta < 0 ? '↓' : '→'}
                </Text>
                <Text style={[styles.deltaText, { color: deltaFg }]}>
                  {condLabel} {conditionDelta > 0 ? '+' : ''}
                  {conditionDelta}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.wlRow}>
            <View style={styles.wlChips}>
              {recentResults.map((r, i) => (
                <View
                  key={i}
                  style={[
                    styles.wlChip,
                    {
                      backgroundColor:
                        r === 'W' ? colors.heroAccent : withAlpha(colors.onHero, 0.16),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.wlChipText,
                      { color: r === 'W' ? colors.hero : withAlpha(colors.onHero, 0.8) },
                    ]}
                  >
                    {r === 'W' ? '勝' : r === 'L' ? '負' : '–'}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={[styles.wlMeta, { color: withAlpha(colors.onHero, 0.6) }]}>
              直近{recent5.length}試合 {wins}勝{losses}敗
            </Text>
          </View>
        </View>

        {/* 2×2 stat grid with hairlines */}
        <View style={[styles.statGrid, { borderTopColor: colors.border }]}>
          {[0, 2].map((rowStart) => (
            <View key={rowStart} style={styles.statRow}>
              {[topStats[rowStart], topStats[rowStart + 1]].map((s, ci) => (
                <View
                  key={s.label}
                  style={[
                    styles.statCell,
                    {
                      borderColor: colors.border,
                      borderRightWidth: ci === 0 ? 1 : 0,
                      borderBottomWidth: rowStart === 0 ? 1 : 0,
                    },
                  ]}
                >
                  <Text style={[styles.statLabel, { color: colors.textSub }]}>{s.label}</Text>
                  <View style={styles.statValueRow}>
                    <Text style={[styles.statValue, { color: colors.text, fontFamily: NUM }]}>
                      {s.value}
                    </Text>
                    <Text style={[styles.statUnit, { color: colors.textSub }]}>{s.unit}</Text>
                    {s.delta !== null ? (
                      <Text
                        style={[
                          styles.statDelta,
                          { color: s.delta >= 0 ? colors.success : colors.danger, fontFamily: NUM },
                        ]}
                      >
                        {s.delta >= 0 ? '+' : ''}
                        {s.delta}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.statBars}>
                    {barHeights(s.trend, 14).map((h, i) => (
                      <View
                        key={i}
                        style={[
                          styles.statBar,
                          { height: h, backgroundColor: withAlpha(colors.primary, 0.32) },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.body}>
          {/* Rally-analysis surfacing (experimental) */}
          {latest && hasRally ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => push(`/session/${latest.id}/rally-history`)}
              style={[
                styles.card,
                styles.rallyCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.rallyThumb, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="play" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rallyTitleRow}>
                  <Text style={[styles.rallyTitle, { color: colors.text }]}>ラリー履歴</Text>
                  <View
                    style={[styles.expBadge, { backgroundColor: withAlpha(colors.warning, 0.16) }]}
                  >
                    <Text style={[styles.expBadgeText, { color: colors.warning }]}>実験的</Text>
                  </View>
                </View>
                <Text style={[styles.rallyMeta, { color: colors.textMuted }]}>
                  {latest.title} · コース/速度を確認
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}

          {/* Latest report */}
          {latest ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => push(`/session/${latest.id}/report`)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.reportTop}>
                {latestOutcome ? (
                  <View
                    style={[
                      styles.resultBadge,
                      {
                        backgroundColor:
                          latestOutcome === 'W' ? colors.primaryLo : withAlpha(colors.danger, 0.14),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.resultBadgeText,
                        { color: latestOutcome === 'W' ? colors.primary : colors.danger },
                      ]}
                    >
                      {latestOutcome === 'W' ? '勝ち' : '負け'}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.reportVs, { color: colors.text }]} numberOfLines={1}>
                  {latest.opponentName ? `vs ${latest.opponentName}` : latest.title}
                </Text>
                <Text style={[styles.reportMeta, { color: colors.textMuted }]}>
                  {sportLabel} · {fmtMonthDay(latest.startedAt)}
                </Text>
                <Text style={[styles.reportLink, { color: colors.primary }]}>レポート ›</Text>
              </View>
              <View style={styles.reportBottom}>
                <Text style={[styles.reportScore, { color: colors.text, fontFamily: NUM }]}>
                  {pointsWon}
                  <Text style={{ color: colors.textMuted }}> - </Text>
                  {pointsLost}
                  <Text style={[styles.reportScoreUnit, { color: colors.textMuted }]}>
                    {' '}
                    ポイント
                  </Text>
                </Text>
                <View style={styles.reportKpis}>
                  <View style={styles.reportKpi}>
                    <Text style={[styles.reportKpiV, { color: colors.text, fontFamily: NUM }]}>
                      {winners}
                    </Text>
                    <Text style={[styles.reportKpiK, { color: colors.textMuted }]}>WIN</Text>
                  </View>
                  <View style={styles.reportKpi}>
                    <Text style={[styles.reportKpiV, { color: colors.danger, fontFamily: NUM }]}>
                      {errCount}
                    </Text>
                    <Text style={[styles.reportKpiK, { color: colors.textMuted }]}>ERR</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Tools: navy form-analysis tile + 2 small tiles */}
          <View style={styles.tileRow}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => push('/form-analysis/new')}
              style={[styles.navyTile, { backgroundColor: colors.tileNavy }]}
            >
              <View style={styles.navyTileMotif} pointerEvents="none">
                <CourtLines stroke={colors.onHero} strokeOpacity={0.14} strokeWidth={1.4} />
              </View>
              <View style={[styles.tileIcon, { backgroundColor: withAlpha('#FFFFFF', 0.16) }]}>
                <Ionicons name="body-outline" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.navyTileTitle}>フォーム分析</Text>
              <Text style={styles.navyTileSub}>姿勢推定で指標化</Text>
            </TouchableOpacity>

            <View style={styles.smallTiles}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={openCourtCalibration}
                style={[
                  styles.smallTile,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.tileIconSm, { backgroundColor: colors.primaryLo }]}>
                  <Ionicons name="grid-outline" size={14} color={colors.primary} />
                </View>
                <Text style={[styles.smallTileText, { color: colors.text }]}>コート較正</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={openAutoScore}
                style={[
                  styles.smallTile,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View
                  style={[styles.tileIconSm, { backgroundColor: withAlpha(colors.warning, 0.16) }]}
                >
                  <Ionicons name="flash-outline" size={14} color={colors.warning} />
                </View>
                <Text style={[styles.smallTileText, { color: colors.text }]}>自動採点</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyToolCard: { alignSelf: 'stretch', paddingHorizontal: 20 },

  hero: { paddingHorizontal: 20, paddingBottom: 18, position: 'relative', overflow: 'hidden' },
  heroMotif: { position: 'absolute', right: -30, top: 40, width: 170, height: 220 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  heroLabel: { fontSize: 11, fontWeight: '500', marginTop: 18 },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 2 },
  scoreNum: { fontSize: 76, lineHeight: 66, fontWeight: '700' },
  scoreMax: { fontSize: 16, fontWeight: '600', paddingBottom: 9 },
  deltaChip: {
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  deltaArrow: { fontSize: 11, fontWeight: '700' },
  deltaText: { fontSize: 11, fontWeight: '700' },
  wlRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  wlChips: { flexDirection: 'row', gap: 4 },
  wlChip: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wlChipText: { fontSize: 11, fontWeight: '700' },
  wlMeta: { fontSize: 10 },

  statGrid: { borderTopWidth: 1 },
  statRow: { flexDirection: 'row' },
  statCell: { flex: 1, paddingHorizontal: 20, paddingTop: 11, paddingBottom: 12 },
  statLabel: { fontSize: 10, fontWeight: '500' },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  statValue: { fontSize: 30, lineHeight: 30, fontWeight: '700' },
  statUnit: { fontSize: 10, fontWeight: '500' },
  statDelta: { marginLeft: 'auto', fontSize: 11, fontWeight: '600' },
  statBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14, marginTop: 7 },
  statBar: { flex: 1, borderRadius: 1 },

  body: { padding: 20, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 13 },
  rallyCard: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rallyThumb: {
    width: 46,
    height: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rallyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rallyTitle: { fontSize: 13, fontWeight: '700' },
  rallyMeta: { fontSize: 10, marginTop: 2 },
  expBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  expBadgeText: { fontSize: 9, fontWeight: '700' },

  reportTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  resultBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  resultBadgeText: { fontSize: 10, fontWeight: '700' },
  reportVs: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  reportMeta: { fontSize: 10 },
  reportLink: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  reportBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  reportScore: { fontSize: 30, lineHeight: 30, fontWeight: '700', letterSpacing: 0.5 },
  reportScoreUnit: { fontSize: 11, fontWeight: '400' },
  reportKpis: { flexDirection: 'row', gap: 14 },
  reportKpi: { alignItems: 'flex-end' },
  reportKpiV: { fontSize: 15, lineHeight: 15, fontWeight: '700' },
  reportKpiK: { fontSize: 9, marginTop: 2 },

  tileRow: { flexDirection: 'row', gap: 10 },
  navyTile: {
    flex: 1,
    borderRadius: 12,
    padding: 13,
    minHeight: 92,
    overflow: 'hidden',
    position: 'relative',
  },
  navyTileMotif: { position: 'absolute', right: -18, bottom: -24, width: 90, height: 110 },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navyTileTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginTop: 10 },
  navyTileSub: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 2 },
  smallTiles: { flex: 1, gap: 10 },
  smallTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  tileIconSm: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallTileText: { fontSize: 11, fontWeight: '500' },
});
