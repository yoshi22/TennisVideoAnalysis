import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, useTheme } from '@/theme';

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
    q: '動画で特定ポイントを確認するには',
    a: 'Log タブのポイント一覧で「▶ 動画で確認」をタップすると動画タブが開きその時刻に移動します',
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
    a: 'Report タブ右上の共有アイコン → CSV または Markdown を選択',
  },
] as const;

export default function HelpScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '使い方ガイド',
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
    paddingBottom: 48,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  group: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
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
    fontSize: 13,
    lineHeight: 21,
    paddingBottom: 16,
  },
});
