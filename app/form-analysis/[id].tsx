import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ScreenHero, Tag } from '@/components/common';
import { getShotTypeLabel, SwingMetricCard } from '@/components/pose';
import { useFormAnalysisStore } from '@/stores';
import { fontFamily, useTheme } from '@/theme';
import { getParamId } from '@/utils/sessionParams';

const NUM = fontFamily.numeric;

export default function FormAnalysisResultScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const analysisId = getParamId(params.id);
  const analysis = useFormAnalysisStore((state) =>
    state.analyses.find((item) => item.id === analysisId)
  );
  const deleteAnalysis = useFormAnalysisStore((state) => state.deleteAnalysis);

  const handleDelete = () => {
    deleteAnalysis(analysisId);
    router.back();
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'フォーム分析結果',
          headerStyle: { backgroundColor: colors.hero },
          headerTintColor: colors.onHero,
          headerTitleStyle: { color: colors.onHero, fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
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

      {analysis ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHero eyebrow="FORM SCORE" topInset={false}>
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreValue, { color: colors.onHero, fontFamily: NUM }]}>
                {Math.round(Math.max(0, Math.min(100, analysis.result.overallScore)))}
              </Text>
              <Text
                style={[
                  styles.scoreMax,
                  { color: withAlpha(colors.onHero, 0.58), fontFamily: NUM },
                ]}
              >
                /100
              </Text>
            </View>
            <Text style={[styles.heroShot, { color: withAlpha(colors.onHero, 0.72) }]}>
              {getShotTypeLabel(analysis.result.shotType)}
            </Text>
          </ScreenHero>

          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.summaryText, { color: colors.text }]}>
              {analysis.result.summary}
            </Text>
            <Tag color={colors.primary} bg={colors.primaryLo}>
              {getShotTypeLabel(analysis.result.shotType)}
            </Tag>
          </View>

          <View style={styles.metricSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>指標カード</Text>
            <View style={styles.metricList}>
              {analysis.result.metrics.map((metric) => (
                <SwingMetricCard key={metric.id} metric={metric} />
              ))}
            </View>
          </View>

          <Text style={[styles.note, { color: colors.textMuted }]}>
            フォーム分析は参考値です。専門コーチの指導を組み合わせることをお勧めします。
          </Text>

          <Button
            accessibilityLabel="フォーム分析を削除"
            label="削除"
            onPress={handleDelete}
            tone="danger"
            variant="ghost"
          />
        </ScrollView>
      ) : (
        <View style={styles.emptyWrap}>
          <EmptyState title="分析結果が見つかりません" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: 20,
    padding: 20,
    paddingBottom: 48,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  scoreRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  scoreValue: {
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 60,
  },
  scoreMax: {
    fontSize: 20,
    fontWeight: '800',
  },
  heroShot: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 22,
  },
  metricSection: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  metricList: {
    gap: 10,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
