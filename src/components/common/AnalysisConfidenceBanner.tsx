import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface AnalysisConfidenceBannerProps {
  completeCount: number;
}

type AnalysisConfidence = 'low' | 'mid' | 'high';

function getAnalysisConfidence(completeCount: number): AnalysisConfidence {
  if (completeCount < 5) return 'low';
  if (completeCount < 10) return 'mid';
  return 'high';
}

export function AnalysisConfidenceBanner({ completeCount }: AnalysisConfidenceBannerProps) {
  const { colors } = useTheme();
  const confidence = getAnalysisConfidence(completeCount);

  if (confidence === 'high') return null;

  const isLow = confidence === 'low';

  return (
    <View style={[styles.banner, { backgroundColor: isLow ? colors.warning : colors.surfaceAlt }]}>
      <Text style={[styles.text, { color: isLow ? colors.surface : colors.textSub }]}>
        {isLow
          ? `分析には5件以上の詳細入力が必要です（現在 ${completeCount} 件）`
          : `分析対象: ${completeCount} 件（精度向上には10件以上推奨）`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
