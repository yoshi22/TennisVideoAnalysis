import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, CourtLines } from '@/components/common';
import { useBetaStore } from '@/stores/betaStore';
import { fontFamily, spacing, useTheme } from '@/theme';

interface CollectionItem {
  icon: 'videocam-outline' | 'analytics-outline' | 'location-outline' | 'phone-portrait-outline';
  title: string;
  desc: string;
}

const COLLECTION_ITEMS: CollectionItem[] = [
  {
    icon: 'videocam-outline',
    title: '動画ファイル',
    desc: 'セッションに紐づけた動画。ラリー区間の検出モデル改善に使用します。',
  },
  {
    icon: 'analytics-outline',
    title: 'スコア・ショットラベル',
    desc: '得失点・ショット種別・結果理由・ラリー本数など、入力したポイント情報。',
  },
  {
    icon: 'location-outline',
    title: '配球・着地位置',
    desc: 'コート上のショット位置（0〜1 正規化座標）。コート較正データ（ホモグラフィ）。',
  },
  {
    icon: 'phone-portrait-outline',
    title: '匿名 ID・アプリ情報',
    desc: 'ランダム生成された参加者 ID（端末識別不可）とアプリバージョン。氏名・連絡先は収集しません。',
  },
];

export default function BetaConsentScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const giveConsent = useBetaStore((s) => s.giveConsent);

  const handleAccept = () => {
    giveConsent();
    router.back();
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'クローズドベータへの参加',
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
          <Text style={[styles.heroBadgeText, { color: colors.heroAccent }]}>CLOSED BETA</Text>
          <Text style={[styles.heading, { color: colors.onHero }]}>データ収集の同意について</Text>
          <Text style={[styles.body, { color: withAlpha(colors.onHero, 0.72) }]}>
            このアプリは軟式テニスの解析モデル改善を目的として、参加者から動画と試合ラベルを任意で収集しています。
            収集するデータは以下の通りです。
          </Text>
        </View>

        <View
          style={[
            styles.itemGroup,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {COLLECTION_ITEMS.map((item, index) => (
            <View
              key={item.title}
              style={[
                styles.itemRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth:
                    index === COLLECTION_ITEMS.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Ionicons color={colors.primary} name={item.icon} size={22} style={styles.itemIcon} />
              <View style={styles.itemText}>
                <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.itemDesc, { color: colors.textSub }]}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.noteBox, { backgroundColor: colors.primaryLo }]}>
          <Text style={[styles.noteText, { color: colors.primary }]}>
            収集したデータは解析モデルの改善にのみ使用します。第三者への提供・販売は行いません。
            参加をやめると以降のデータ提供が停止されます。過去に提出したデータはモデル改善のため保持されます。
          </Text>
        </View>

        <Button full label="同意してベータに参加" onPress={handleAccept} />
        <TouchableOpacity
          accessibilityLabel="参加しない"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.cancelButton}
        >
          <Text style={[styles.cancelText, { color: colors.textSub }]}>参加しない</Text>
        </TouchableOpacity>
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
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginTop: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  itemGroup: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  itemRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  itemIcon: {
    marginTop: 1,
  },
  itemText: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  itemDesc: {
    fontFamily: fontFamily.numeric,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  noteBox: {
    borderRadius: 10,
    padding: spacing.lg,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 20,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
