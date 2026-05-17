import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, Tag } from '@/components/common';
import { FormScoreRing, getShotTypeLabel, SwingMetricCard } from '@/components/pose';
import { useFormAnalysisStore } from '@/stores';
import { useTheme } from '@/theme';
import { getParamId } from '@/utils/sessionParams';

export default function FormAnalysisResultScreen() {
  const { colors } = useTheme();
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
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
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

      {analysis ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FormScoreRing score={analysis.result.overallScore} shotType={analysis.result.shotType} />

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
    borderWidth: 0.5,
    gap: 12,
    padding: 16,
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
