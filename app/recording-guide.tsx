import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Line, Rect, Svg } from 'react-native-svg';

import { ScreenHero } from '@/components/common';
import { fontFamily, spacing, useTheme } from '@/theme';

interface TipItem {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
}

type CategoryKey = 'match' | 'serve';

const CATEGORY_OPTIONS: { key: CategoryKey; label: string }[] = [
  { key: 'match', label: '試合（固定カメラ）' },
  { key: 'serve', label: 'サーブ練習' },
];

const SERVE_TIPS: TipItem[] = [
  {
    icon: 'person-outline',
    title: 'サーバーの後方やや高め',
    desc: 'フォーム全体（頭上のトス〜インパクト〜フォロースルー）と着地点（サービスコート）が両方画角に収まる位置から撮影します。',
  },
  {
    icon: 'arrow-up-circle-outline',
    title: '高さを確保する',
    desc: '三脚 2〜3m 程度の高さが目安。サービスコート全体とボールの軌跡が見えるようにしてください。',
  },
  {
    icon: 'timer-outline',
    title: '1 本ごとに間を空ける',
    desc: '各サーブの動作が分離して録画されるよう、次のサーブまで 2〜3 秒の間隔を空けてください。',
  },
  {
    icon: 'flag-outline',
    title: '的・ターゲットを明示',
    desc: '左右や奥手前の狙いを区別するため、コーン・マーカーなどで目標を置くとラベル品質が向上します。',
  },
  {
    icon: 'phone-landscape-outline',
    title: '横向きで撮影',
    desc: '縦向きはコート幅が収まりにくいため推奨しません。',
  },
  {
    icon: 'speedometer-outline',
    title: '60fps・1080p 以上推奨',
    desc: 'ボールの追跡精度が向上します。',
  },
];

const TIPS: TipItem[] = [
  {
    icon: 'locate',
    title: 'ベースライン後方・中央に設置',
    desc: 'コート全体が見える位置から撮影します',
  },
  {
    icon: 'arrow-up-circle-outline',
    title: 'できるだけ高い位置に',
    desc: 'フェンス上端以上。三脚で固定してください',
  },
  {
    icon: 'scan-outline',
    title: 'コート全体を画角に',
    desc: '両ベースライン・サイドラインが映るように（目安: 120° 広角）',
  },
  {
    icon: 'phone-landscape-outline',
    title: '横向きで撮影',
    desc: '縦向きは分析精度が下がります',
  },
  {
    icon: 'speedometer-outline',
    title: '60fps・1080p 以上推奨',
    desc: 'ボールの追跡精度が向上します',
  },
  {
    icon: 'sunny-outline',
    title: '均一な明るさを確保',
    desc: '逆光・強い影はコート検出の誤差につながります',
  },
];

const CV_TIPS: TipItem[] = [
  {
    icon: 'grid-outline',
    title: 'コート較正は最初に必ず実施',
    desc: 'セッション開始前に較正画面でコート 4 隅をタップしてください。ボール追跡・速度推定・自動採点の精度に直結します',
  },
  {
    icon: 'tennisball-outline',
    title: 'ボールが視認できる解像度',
    desc: 'Full HD (1920×1080) 以上が必須。ボールが 5px 以上写るように調整してください',
  },
  {
    icon: 'contrast-outline',
    title: 'コートとボールのコントラスト',
    desc: '黄色ボール・赤クレー・青ハードなど、ボールと背景の色差が大きい条件が最適です',
  },
  {
    icon: 'videocam-off-outline',
    title: 'カメラを固定してください',
    desc: 'フレーム差分アルゴリズムを使用しているため、手持ち撮影は誤検出の原因になります',
  },
  {
    icon: 'analytics-outline',
    title: '速度推定の注意事項',
    desc: '速度はコート較正の精度に依存します。4 隅を正確に指定するほど測定値が安定します',
  },
];

function TipGroup({
  tips,
  colors,
}: {
  tips: TipItem[];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[styles.tipGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {tips.map((tip, index) => (
        <View
          key={tip.title}
          style={[
            styles.tipRow,
            {
              borderBottomColor: colors.border,
              borderBottomWidth: index === tips.length - 1 ? 0 : StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Ionicons color={colors.primary} name={tip.icon} size={22} style={styles.tipIcon} />
          <View style={styles.tipTextWrap}>
            <Text style={[styles.tipTitle, { color: colors.text }]}>{tip.title}</Text>
            <Text style={[styles.tipDesc, { color: colors.textSub }]}>{tip.desc}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function RecordingGuideScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const [category, setCategory] = useState<CategoryKey>('match');

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '撮影のコツ',
          headerStyle: { backgroundColor: colors.hero },
          headerTintColor: colors.onHero,
          headerTitleStyle: { color: colors.onHero, fontWeight: '700' },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.onHero} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHero eyebrow="RECORDING" style={styles.hero} title="撮影のコツ" topInset={false}>
          <Text style={[styles.heroSub, { color: withAlpha(colors.onHero, 0.68) }]}>
            {category === 'match' ? '試合（固定カメラ）' : 'サーブ練習'}
          </Text>
        </ScreenHero>

        {/* Category selector */}
        <View style={[styles.categoryRow, { borderColor: colors.border }]}>
          {CATEGORY_OPTIONS.map((opt) => {
            const active = category === opt.key;
            return (
              <TouchableOpacity
                accessibilityLabel={opt.label}
                accessibilityRole="button"
                activeOpacity={0.82}
                key={opt.key}
                onPress={() => setCategory(opt.key)}
                style={[
                  styles.categoryTab,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.categoryTabText,
                    { color: active ? colors.onHero : colors.textSub },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {category === 'match' ? (
          <>
            <View style={styles.diagramWrap}>
              <Svg height={140} viewBox="0 0 220 140" width={220}>
                <Rect
                  fill={colors.court}
                  height={100}
                  stroke={colors.courtLine}
                  strokeWidth={2}
                  width={200}
                  x={10}
                  y={20}
                />
                <Line stroke={colors.courtLine} strokeWidth={2} x1={10} x2={210} y1={70} y2={70} />
                <Line stroke={colors.courtLine} strokeWidth={1} x1={85} x2={85} y1={20} y2={120} />
                <Line
                  stroke={colors.courtLine}
                  strokeWidth={1}
                  x1={135}
                  x2={135}
                  y1={20}
                  y2={120}
                />
                <Rect fill={colors.tileNavy} height={12} rx={3} width={30} x={95} y={128} />
              </Svg>
              <Text style={[styles.diagramLabel, { color: colors.textMuted }]}>
                カメラ位置（ベースライン後方中央）
              </Text>
            </View>

            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>基本撮影条件</Text>
            <TipGroup colors={colors} tips={TIPS} />

            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>
              CV 機能（コート較正・ボール追跡・速度推定）
            </Text>
            <TipGroup colors={colors} tips={CV_TIPS} />
          </>
        ) : (
          <>
            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>
              サーブ練習の撮影条件
            </Text>
            <TipGroup colors={colors} tips={SERVE_TIPS} />
          </>
        )}

        <View style={[styles.noteBox, { backgroundColor: colors.primaryLo }]}>
          <Text style={[styles.noteText, { color: colors.primary }]}>
            {category === 'match'
              ? 'これらの撮影条件は、自動ボール追跡・コート較正・速度推定・自動採点の分析精度に直結します。初回セッションは較正から始めてください。'
              : 'サーブ練習の動画は、各サーブの区間を個別に記録することでラベル品質が向上します。得失点記録時に「動画時刻」を設定してください。'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    minHeight: 44,
    minWidth: 44,
  },
  content: {
    paddingBottom: 48,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  hero: {
    marginBottom: spacing.xl,
  },
  heroSub: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  diagramWrap: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  diagramLabel: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  tipGroup: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  tipRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  tipIcon: {
    marginTop: 1,
  },
  tipTextWrap: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  tipDesc: {
    fontFamily: fontFamily.numeric,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  noteBox: {
    borderRadius: 10,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 20,
  },
  categoryRow: {
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.md,
    padding: 4,
  },
  categoryTab: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  categoryTabText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
