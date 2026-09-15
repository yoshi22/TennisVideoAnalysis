import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourtLines } from '@/components/common';
import { fontFamily, spacing, useTheme } from '@/theme';

const HELP_ITEMS = [
  {
    q: '新規セッションを作成するには',
    a: 'ホーム画面下部の「+」または「セッション作成」ボタンをタップし、タイトルや競技を選んで開始します。',
  },
  {
    q: 'ポイントを記録するには',
    a: 'セッションの Log タブで「↑ 得点」または「↓ 失点」をタップし、ショットや結果理由を選んで保存します。',
  },
  {
    q: 'ラリー区間を記録するには',
    a: '動画タブで「▶ ラリー開始をマーク」をタップしてラリー開始を記録し、ラリー終了時に「得点」または「失点」をタップすると区間（rallyStartSec〜rallyEndSec）が保存されます。',
  },
  {
    q: '動画で特定ポイントを確認するには',
    a: 'Log タブのポイント一覧で区間が記録されたポイントは「00:42〜00:58」のように表示されます。「▶ ラリー区間を確認」をタップすると動画タブが開きその区間の開始時刻に移動します。',
  },
  {
    q: 'コート較正とは',
    a: 'Report タブ→「コート較正」でコートの四隅を指定。ボール追跡と自動採点に必要です',
  },
  {
    q: '自動採点を使うには',
    a: 'コート較正後、Report タブ→「自動採点」から時間範囲を指定して解析し、候補を確認して保存します。',
  },
  {
    q: 'ボール軌跡を確認するには',
    a: 'Report タブ→「ボール軌跡」で時間範囲を指定して解析し、検出された軌跡とバウンドを確認します。',
  },
  {
    q: '試合スコアの仕組み',
    a: '試合セッションではゲーム/セット/マッチスコアが自動集計されます。Log タブ上部に表示されます',
  },
  {
    q: 'データをエクスポートするには',
    a: 'Report タブ右上の共有アイコン → CSV・Markdown・「ラリーラベル (JSON)」・「動画を共有」から選択します。ラリー区間が記録されていると「ラリーラベル (JSON)」が表示されます。',
  },
  {
    q: 'ラリーラベル・動画を書き出す目的は',
    a: '記録したラリー区間のラベルと動画を任意で共有すると、自動検出モデルの精度向上に役立てることができます。自動送信はなく、すべてユーザーの任意操作です。',
  },
] as const;

export default function HelpScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '使い方ガイド',
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
        <View style={[styles.hero, { backgroundColor: colors.hero }]}>
          <View style={styles.heroMotif} pointerEvents="none">
            <CourtLines stroke={colors.onHero} strokeOpacity={0.12} strokeWidth={1.4} />
          </View>
          <Text style={[styles.heroEyebrow, { color: colors.heroAccent }]}>HELP</Text>
          <Text style={[styles.heroTitle, { color: colors.onHero }]}>使い方ガイド</Text>
          <Text style={[styles.heroCount, { color: withAlpha(colors.onHero, 0.68) }]}>
            <Text style={{ fontFamily: fontFamily.numeric }}>{HELP_ITEMS.length}</Text> 項目
          </Text>
        </View>

        <View
          style={[
            styles.group,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {HELP_ITEMS.map((item, index) => {
            const expanded = expandedIndex === index;
            return (
              <View
                key={item.q}
                style={[
                  styles.item,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth:
                      index === HELP_ITEMS.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <TouchableOpacity
                  accessibilityLabel={item.q}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  activeOpacity={0.82}
                  onPress={() => setExpandedIndex(expanded ? null : index)}
                  style={styles.questionRow}
                >
                  <Text style={[styles.question, { color: colors.text }]}>{item.q}</Text>
                  <Ionicons
                    color={colors.textMuted}
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                  />
                </TouchableOpacity>
                {expanded ? (
                  <Text style={[styles.answer, { color: colors.textSub }]}>{item.a}</Text>
                ) : null}
              </View>
            );
          })}
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
    gap: spacing.xl,
    paddingBottom: 48,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  hero: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: spacing.lg,
    position: 'relative',
  },
  heroMotif: {
    height: 120,
    position: 'absolute',
    right: -20,
    top: -16,
    width: 240,
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginTop: 8,
  },
  heroCount: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  group: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  item: {
    paddingHorizontal: spacing.lg,
  },
  questionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 58,
    paddingVertical: 14,
  },
  question: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  answer: {
    fontFamily: fontFamily.numeric,
    fontSize: 13,
    lineHeight: 21,
    paddingBottom: 16,
  },
});
