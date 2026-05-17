import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark, Button, SegmentedControl } from '@/components/common';
import { MockAutoScoreCard } from '@/components/onboarding/MockAutoScoreCard';
import { MockCalibrationCard } from '@/components/onboarding/MockCalibrationCard';
import { MockNewSessionCard } from '@/components/onboarding/MockNewSessionCard';
import { MockPointLogCard } from '@/components/onboarding/MockPointLogCard';
import { MockReportCard } from '@/components/onboarding/MockReportCard';
import { useOnboardingStore, usePlayerStore } from '@/stores';
import { radius, spacing, typography, useTheme } from '@/theme';
import { type SportType } from '@/types';
import { generateId } from '@/utils/id';

const { width } = Dimensions.get('window');
const LAST_STEP_INDEX = 6;

const SPORT_OPTIONS: { label: string; value: SportType }[] = [
  { label: '硬式テニス', value: 'tennis' },
  { label: 'ソフトテニス', value: 'softTennis' },
];

const STEPS = [
  {
    title: 'CourtLens へようこそ',
    body: 'テニスの試合や練習を記録して、あなたの強みと弱点を自動で分析するアプリです。',
  },
  {
    title: '① 試合・練習を記録',
    body: '試合や練習を「セッション」として登録。動画も一緒に残せます。',
  },
  {
    title: '② ポイントを入力',
    body: '得点・失点をタップして、サーブやショットの内容をかんたんに記録できます。',
  },
  {
    title: '③ レポートで分析',
    body: '勝率やショット傾向をグラフで確認。弱点に合わせた練習メニューも提案します。',
  },
  {
    title: '④ コート較正で精度アップ',
    body: 'コートの四隅を指定するだけで、ボール位置の自動検出精度が向上します。',
  },
  {
    title: '⑤ 自動採点（実験的）',
    body: '動画のラリーを解析して、採点候補を自動生成します。必ず確認してから保存してください。',
  },
  {
    title: '競技を選んでください',
    body: 'あとで設定からいつでも変更できます。',
  },
] as const;

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const profile = usePlayerStore((state) => state.profile);
  const setProfile = usePlayerStore((state) => state.setProfile);
  const updateProfile = usePlayerStore((state) => state.updateProfile);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
  const [page, setPage] = useState(0);
  const [selectedSport, setSelectedSport] = useState<SportType>(profile?.sport ?? 'tennis');
  const sportTouchedRef = useRef(false);
  const isReplay = replay === '1';

  // playerStore も非同期 hydration するため、未タッチの場合のみ hydration 後の sport を反映する
  useEffect(() => {
    if (!sportTouchedRef.current && profile?.sport) {
      setSelectedSport(profile.sport);
    }
  }, [profile?.sport]);

  const goToPage = (nextPage: number) => {
    const targetPage = Math.min(Math.max(nextPage, 0), LAST_STEP_INDEX);
    setPage(targetPage);
    scrollRef.current?.scrollTo({ x: width * targetPage, animated: true });
  };

  const complete = () => {
    const now = new Date().toISOString();

    if (profile === null) {
      setProfile({
        id: generateId(),
        name: 'プレイヤー',
        sport: selectedSport,
        dominantHand: 'right',
        playStyle: 'baseline',
        createdAt: now,
        updatedAt: now,
      });
    } else {
      updateProfile({ sport: selectedSport, updatedAt: now });
    }

    completeOnboarding();

    if (isReplay) {
      router.back();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace('/session/new' as any);
  };

  const renderVisual = (index: number) => {
    if (index === 0) {
      return (
        <View style={styles.brandWrap}>
          <BrandMark size={48} withText={true} />
        </View>
      );
    }

    if (index === 1) {
      return <MockNewSessionCard />;
    }

    if (index === 2) {
      return <MockPointLogCard />;
    }

    if (index === 3) {
      return <MockReportCard />;
    }

    if (index === 4) {
      return <MockCalibrationCard />;
    }

    if (index === 5) {
      return <MockAutoScoreCard />;
    }

    return (
      <View style={styles.segmentedWrap}>
        <SegmentedControl
          accessibilityLabel="競技を選択"
          onSelect={(sport) => {
            sportTouchedRef.current = true;
            setSelectedSport(sport);
          }}
          options={SPORT_OPTIONS}
          selected={selectedSport}
        />
      </View>
    );
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <View style={styles.topBar}>
        {page < LAST_STEP_INDEX ? (
          <Button
            label="スキップ"
            onPress={() => goToPage(LAST_STEP_INDEX)}
            size="s"
            style={styles.skipButton}
            variant="ghost"
          />
        ) : null}
      </View>

      <ScrollView
        horizontal
        onMomentumScrollEnd={(event) => {
          const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
          setPage(Math.min(Math.max(nextPage, 0), LAST_STEP_INDEX));
        }}
        pagingEnabled
        ref={scrollRef}
        showsHorizontalScrollIndicator={false}
        style={styles.carousel}
      >
        {STEPS.map((step, index) => (
          <View key={step.title} style={[styles.page, { width }]}>
            <View
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.visual}>{renderVisual(index)}</View>
              <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
              <Text style={[styles.body, { color: colors.textSub }]}>{step.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((step, index) => (
            <View
              key={step.title}
              style={[
                styles.dot,
                { backgroundColor: index === page ? colors.primary : colors.border },
              ]}
            />
          ))}
        </View>
        <Button
          full
          label={page === LAST_STEP_INDEX ? (isReplay ? '完了' : 'セッションを作成') : '次へ'}
          onPress={() => {
            if (page === LAST_STEP_INDEX) {
              complete();
              return;
            }

            goToPage(page + 1);
          }}
          size="l"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    alignItems: 'flex-end',
    minHeight: 56,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  skipButton: {
    minHeight: 36,
  },
  carousel: {
    flex: 1,
  },
  page: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  card: {
    alignItems: 'center',
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  visual: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 92,
  },
  brandWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.sm,
  },
  title: {
    ...typography.h1,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    marginTop: spacing.md,
    maxWidth: 320,
    textAlign: 'center',
  },
  footer: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  dot: {
    borderRadius: 4,
    height: 8,
    margin: 4,
    width: 8,
  },
});
