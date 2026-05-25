import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';
import { type PracticeDrill } from '@/types/analysis';

interface Props {
  drills: PracticeDrill[];
  emptyText?: string;
}

export function ReportDrillList({ drills, emptyText = '練習メニューはまだありません' }: Props) {
  const { colors } = useTheme();

  if (drills.length === 0) {
    return <Text style={[styles.emptyText, { color: colors.textSub }]}>{emptyText}</Text>;
  }

  return (
    <View style={styles.list}>
      {drills.map((drill) => (
        <View
          key={drill.id}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.badge, { backgroundColor: colors.primaryLo }]}>
            <Text style={[styles.min, { color: colors.primary }]}>{drill.durationMin}</Text>
            <Text style={[styles.minLabel, { color: colors.primary }]}>分</Text>
          </View>
          <View style={styles.body}>
            <Text style={[styles.name, { color: colors.text }]}>{drill.name}</Text>
            <Text style={[styles.desc, { color: colors.textSub }]} numberOfLines={2}>
              {drill.description}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  min: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  minLabel: {
    fontSize: 8,
    fontWeight: '600',
    marginTop: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  name: {
    fontSize: 13,
    fontWeight: '700',
  },
  desc: {
    fontSize: 11,
    lineHeight: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
