import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { type ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Line, Rect, Svg } from 'react-native-svg';

import { spacing, useTheme } from '@/theme';

interface TipItem {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
}

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

export default function RecordingGuideScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '撮影のコツ',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.surface} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.diagramWrap}>
          <Svg height={140} viewBox="0 0 220 140" width={220}>
            <Rect
              fill={colors.primaryLo}
              height={100}
              stroke={colors.primary}
              strokeWidth={2}
              width={200}
              x={10}
              y={20}
            />
            <Line stroke={colors.primary} strokeWidth={2} x1={10} x2={210} y1={70} y2={70} />
            <Line stroke={colors.primary} strokeWidth={1} x1={85} x2={85} y1={20} y2={120} />
            <Line stroke={colors.primary} strokeWidth={1} x1={135} x2={135} y1={20} y2={120} />
            <Rect fill={colors.primary} height={12} rx={3} width={30} x={95} y={128} />
          </Svg>
          <Text style={[styles.diagramLabel, { color: colors.textMuted }]}>カメラ位置</Text>
        </View>

        <Text style={[styles.groupLabel, { color: colors.textMuted }]}>基本撮影条件</Text>
        <View
          style={[
            styles.tipGroup,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {TIPS.map((tip, index) => (
            <View
              key={tip.title}
              style={[
                styles.tipRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: index === TIPS.length - 1 ? 0 : StyleSheet.hairlineWidth,
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

        <Text style={[styles.groupLabel, { color: colors.textMuted }]}>
          CV 機能（コート較正・ボール追跡・速度推定）
        </Text>
        <View
          style={[
            styles.tipGroup,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {CV_TIPS.map((tip, index) => (
            <View
              key={tip.title}
              style={[
                styles.tipRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: index === CV_TIPS.length - 1 ? 0 : StyleSheet.hairlineWidth,
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

        <View style={[styles.noteBox, { backgroundColor: colors.primaryLo }]}>
          <Text style={[styles.noteText, { color: colors.primary }]}>
            これらの撮影条件は、自動ボール追跡・コート較正・速度推定・自動採点の分析精度に直結します。初回セッションは較正から始めてください。
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
  },
  diagramWrap: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingTop: spacing.xl,
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
    borderWidth: StyleSheet.hairlineWidth,
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
});
