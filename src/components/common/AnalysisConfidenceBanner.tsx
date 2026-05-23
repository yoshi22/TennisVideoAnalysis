import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface AnalysisConfidenceBannerProps {
  completeCount: number;
  draftCount?: number;
}

type AnalysisConfidence = 'low' | 'mid' | 'high';

function getAnalysisConfidence(completeCount: number): AnalysisConfidence {
  if (completeCount < 5) return 'low';
  if (completeCount < 10) return 'mid';
  return 'high';
}

export function AnalysisConfidenceBanner({
  completeCount,
  draftCount,
}: AnalysisConfidenceBannerProps) {
  const { colors } = useTheme();
  const confidence = getAnalysisConfidence(completeCount);
  const isLow = confidence === 'low';

  const confidenceBanner =
    confidence === 'high' ? null : (
      <View
        style={[styles.banner, { backgroundColor: isLow ? colors.warning : colors.surfaceAlt }]}
      >
        <Text style={[styles.text, { color: isLow ? colors.surface : colors.textSub }]}>
          {isLow
            ? `分析には5件以上の詳細入力が必要です（現在 ${completeCount} 件）`
            : `分析対象: ${completeCount} 件（精度向上には10件以上推奨）`}
        </Text>
      </View>
    );

  const draftBanner =
    draftCount && draftCount > 0 ? (
      <View style={[styles.banner, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.text, { color: colors.textSub }]}>
          {`下書き ${draftCount} 件が未確定です。ログ画面から確定してください。`}
        </Text>
      </View>
    ) : null;

  if (!confidenceBanner && !draftBanner) return null;

  return (
    <View style={styles.bannerGroup}>
      {confidenceBanner}
      {draftBanner}
    </View>
  );
}

const styles = StyleSheet.create({
  bannerGroup: {
    gap: 2,
  },
  banner: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
});
