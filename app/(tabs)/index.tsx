import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BrandMark,
  CourtLines,
  EmptyState,
  SectionHeader,
  SessionCard,
  StatCard,
  ToolEntryCard,
} from '@/components/common';
import { FormAnalysisEntryCard } from '@/components/pose';
import { getAnalyzer } from '@/services/analysis';
import { usePlayerStore } from '@/stores/playerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type TennisSession } from '@/types';

function IcUser({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <Path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </Svg>
  );
}

function IcChevR({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

function IcChart({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M4 19V5" />
      <Path d="M4 19h16" />
      <Path d="M7 15l4-5 3 3 5-7" />
    </Svg>
  );
}

function sortByDate(sessions: TennisSession[]): TennisSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export default function HomeScreen() {
  const { colors } = useTheme();
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
  const wins = recent5.filter((s) => {
    const won = s.points.filter((p) => p.outcome === 'won').length;
    const lost = s.points.filter((p) => p.outcome === 'lost').length;
    return won > lost;
  }).length;
  const losses = recent5.length - wins;

  const greeting = profile?.name ? `こんにちは、${profile.name}さん` : 'こんにちは';

  // expo-router push() is typed strictly; cast once here rather than per-callsite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (path: string) => router.push(path as any);

  const openSessionPicker = (
    title: string,
    pickerSessions: TennisSession[],
    buildPath: (session: TennisSession) => string
  ) => {
    if (pickerSessions.length === 1) {
      push(buildPath(pickerSessions[0]));
      return;
    }

    Alert.alert(
      title,
      'セッションを選択してください。',
      [
        ...pickerSessions.map((session) => ({
          text: session.title,
          onPress: () => push(buildPath(session)),
        })),
        { text: 'キャンセル', style: 'cancel' as const },
      ],
      { cancelable: true }
    );
  };

  const openCourtCalibration = () => {
    if (videoSessions.length === 0) {
      Alert.alert('セッションに動画がありません');
      return;
    }

    openSessionPicker(
      'コート較正',
      videoSessions,
      (session) => `/session/${session.id}/calibration`
    );
  };

  const openAutoScore = () => {
    if (videoSessions.length === 0) {
      Alert.alert('セッションに動画がありません');
      return;
    }

    if (calibratedVideoSessions.length === 0) {
      Alert.alert('コート較正が必要です', '自動採点にはコート較正が必要です。', [
        {
          text: 'コート較正を開く',
          onPress: () => push(`/session/${videoSessions[0].id}/calibration`),
        },
        { text: 'キャンセル', style: 'cancel' },
      ]);
      return;
    }

    openSessionPicker(
      '自動採点（実験的）',
      calibratedVideoSessions,
      (session) => `/session/${session.id}/auto-score`
    );
  };

  const topStats = [
    {
      stat: {
        label: '勝率',
        value: latestAnalysis ? Math.round(latestAnalysis.winRate * 100) : 0,
        unit: '%',
        delta: latestAnalysis ? Math.round((latestAnalysis.winRate - 0.55) * 100) : undefined,
        trend: [
          40,
          48,
          52,
          55,
          58,
          60,
          latestAnalysis ? Math.round(latestAnalysis.winRate * 100) : 62,
        ],
      },
    },
    {
      stat: {
        label: 'ファースト確率',
        value: latestAnalysis ? Math.round(latestAnalysis.firstServeInRate * 100) : 0,
        unit: '%',
        delta: latestAnalysis
          ? Math.round((latestAnalysis.firstServeInRate - 0.56) * 100)
          : undefined,
        trend: [
          51,
          55,
          58,
          56,
          60,
          62,
          latestAnalysis ? Math.round(latestAnalysis.firstServeInRate * 100) : 64,
        ],
      },
    },
    {
      stat: {
        label: 'エース数',
        value: latestAnalysis?.aceCount ?? 0,
        unit: '本',
        trend: [2, 4, 3, 5, 4, 5, latestAnalysis?.aceCount ?? 6],
      },
    },
    {
      stat: {
        label: '平均ラリー',
        value: latestAnalysis ? latestAnalysis.averageRallyCount.toFixed(1) : '0.0',
        unit: '球',
        trend: [5.1, 5.0, 4.8, 4.6, 4.5, 4.3, latestAnalysis?.averageRallyCount ?? 4.2],
      },
    },
  ];

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
            action={{
              label: '新規セッションを開始',
              onPress: () => push('/session/new'),
            }}
          />
          <View style={styles.emptyToolCard}>
            <FormAnalysisEntryCard onPress={() => push('/form-analysis/new')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero header */}
        <View style={styles.heroPad}>
          <View style={styles.courtMotif} pointerEvents="none">
            <CourtLines stroke={colors.text} strokeOpacity={0.08} strokeWidth={1} />
          </View>
          <View style={styles.heroTop}>
            <BrandMark size={26} />
            <TouchableOpacity
              style={[
                styles.avatarBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              activeOpacity={0.8}
            >
              <IcUser color={colors.text} size={18} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.greetingSub, { color: colors.textSub }]}>{greeting}</Text>
          <Text style={[styles.greetingMain, { color: colors.text }]}>
            直近の調子は{'\n'}
            <Text style={{ color: colors.success }}>
              {wins > losses ? '上向き ↗' : wins < losses ? '要注意 ↘' : '安定中 →'}
            </Text>
          </Text>
          <Text style={[styles.greetingMeta, { color: colors.textMuted }]}>
            直近 {recent5.length} 試合 · {wins}勝{losses}敗
          </Text>
        </View>

        {/* Stat cards — horizontal scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsScroll}
        >
          {topStats.map(({ stat }) => (
            <StatCard key={stat.label} stat={stat} variant="spark" width={148} />
          ))}
          <View style={{ width: 4 }} />
        </ScrollView>

        {/* Latest report banner */}
        {latest && (
          <View style={styles.bannerPad}>
            <TouchableOpacity
              activeOpacity={0.88}
              style={[styles.banner, { backgroundColor: colors.primary }]}
              onPress={() => push('/(tabs)/report')}
            >
              <View style={styles.bannerMotif} pointerEvents="none">
                <CourtLines stroke={colors.surface} strokeOpacity={0.18} strokeWidth={1.4} />
              </View>
              <View style={[styles.bannerIcon, { backgroundColor: `${colors.surface}26` }]}>
                <IcChart color={colors.surface} size={20} />
              </View>
              <View style={styles.bannerText}>
                <Text style={[styles.bannerHint, { color: colors.surface }]}>最新のレポート</Text>
                <Text style={[styles.bannerTitle, { color: colors.surface }]} numberOfLines={1}>
                  {latest.title}
                </Text>
              </View>
              <IcChevR color={colors.surface} size={18} />
            </TouchableOpacity>
          </View>
        )}

        {/* Tools */}
        <View style={styles.toolsSection}>
          <SectionHeader title="ツール" />
          <View style={styles.toolCardPad}>
            <FormAnalysisEntryCard onPress={() => push('/form-analysis/new')} />
            <ToolEntryCard
              accessibilityLabel="コート較正を開く"
              iconName="analytics-outline"
              onPress={openCourtCalibration}
              subtitle="動画からコートの座標を設定"
              title="コート較正"
            />
            <ToolEntryCard
              accessibilityLabel="自動採点を開く"
              iconName="trophy-outline"
              onPress={openAutoScore}
              subtitle="動画からポイントを自動検出"
              title="自動採点（実験的）"
            />
          </View>
        </View>

        {/* Recent sessions */}
        <SectionHeader
          title="最近のセッション"
          action={{ label: 'すべて見る', onPress: () => push('/(tabs)/history') }}
        />
        <View style={styles.sessionList}>
          {sorted.slice(0, 3).map((s) => (
            <SessionCard key={s.id} session={s} onPress={() => push(`/session/${s.id}/log`)} />
          ))}
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyToolCard: {
    alignSelf: 'stretch',
    paddingHorizontal: 20,
  },
  heroPad: {
    padding: 20,
    paddingBottom: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  courtMotif: {
    position: 'absolute',
    right: -20,
    top: -10,
    width: 240,
    height: 120,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  greetingSub: {
    fontSize: 13,
    marginBottom: 4,
  },
  greetingMain: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  greetingMeta: {
    fontSize: 12,
    marginTop: 8,
  },
  statsScroll: {
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  bannerPad: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  banner: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  bannerMotif: {
    position: 'absolute',
    right: -30,
    top: -10,
    width: 200,
    height: 100,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  bannerHint: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.8,
    marginBottom: 2,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  toolsSection: {
    paddingTop: 12,
  },
  toolCardPad: {
    gap: 10,
    paddingHorizontal: 20,
  },
  sessionList: {
    paddingHorizontal: 20,
    gap: 10,
  },
});
