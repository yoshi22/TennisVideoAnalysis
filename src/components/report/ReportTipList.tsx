import { StyleSheet, Text, View } from 'react-native';

import { Tag } from '@/components/common';
import { useTheme } from '@/theme';
import { type CoachingTip } from '@/types/analysis';

const PRIORITY_LABELS = { high: '優先 高', medium: '優先 中', low: '優先 低' } as const;
const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'muted' } as const;

interface Props {
  tips: CoachingTip[];
  emptyText?: string;
}

export function ReportTipList({ tips, emptyText = '改善コメントはまだありません' }: Props) {
  const { colors } = useTheme();

  const toneColor = (t: 'danger' | 'warning' | 'muted') =>
    t === 'danger' ? colors.danger : t === 'warning' ? colors.warning : colors.textMuted;

  if (tips.length === 0) {
    return <Text style={[styles.emptyText, { color: colors.textSub }]}>{emptyText}</Text>;
  }

  return (
    <View style={styles.list}>
      {tips.map((tip) => {
        const tone = PRIORITY_TONE[tip.priority];
        const c = toneColor(tone);
        return (
          <View
            key={tip.id}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.header}>
              <Tag color={c} bg={`${c}1A`}>
                ● {PRIORITY_LABELS[tip.priority]}
              </Tag>
              <Text style={[styles.title, { color: colors.text }]}>{tip.title}</Text>
            </View>
            <Text style={[styles.body, { color: colors.textSub }]}>{tip.description}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 14,
    gap: 6,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
