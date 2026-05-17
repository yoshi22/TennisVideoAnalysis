import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/theme';

interface FormAnalysisEntryCardProps {
  onPress: () => void;
}

export function FormAnalysisEntryCard({ onPress }: FormAnalysisEntryCardProps) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      accessibilityLabel="フォーム分析を開く"
      accessibilityRole="button"
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryLo }]}>
        <Ionicons color={colors.primary} name="camera-outline" size={22} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.text }]}>フォーム分析</Text>
        <Text style={[styles.subtitle, { color: colors.textSub }]}>スイングを撮影・解析</Text>
      </View>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    elevation: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
});
