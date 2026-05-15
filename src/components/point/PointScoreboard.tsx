import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface PointScoreboardProps {
  ourScore: number;
  oppScore: number;
  label?: string;
}

export function PointScoreboard({ ourScore, oppScore, label = 'SET 1' }: PointScoreboardProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.side}>
        <Text style={[styles.team, { color: colors.textSub }]}>あなた</Text>
        <Text style={[styles.score, { color: colors.text }]}>{ourScore}</Text>
      </View>
      <View style={styles.center}>
        <Text style={[styles.setLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text style={[styles.dash, { color: colors.textSub }]}>—</Text>
      </View>
      <View style={[styles.side, styles.sideRight]}>
        <Text style={[styles.team, { color: colors.textSub }]}>相手</Text>
        <Text style={[styles.score, { color: colors.text }]}>{oppScore}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    paddingVertical: 16,
    paddingHorizontal: 18,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  side: {
    flex: 1,
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
  },
  team: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.05,
    marginBottom: 2,
  },
  score: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 48,
    letterSpacing: -1,
  },
  setLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  dash: {
    fontSize: 13,
    fontWeight: '700',
  },
});
