import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

interface Props {
  items: string[];
  icon: string;
  tone: 'success' | 'danger';
  emptyText: string;
}

export function ReportInsightList({ items, icon, tone, emptyText }: Props) {
  const { colors } = useTheme();
  const color = tone === 'success' ? colors.success : colors.danger;

  if (items.length === 0) {
    return <Text style={[styles.emptyText, { color: colors.textSub }]}>{emptyText}</Text>;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View
          key={item}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.bar, { backgroundColor: color }]} />
          <View style={[styles.icon, { backgroundColor: `${color}1A` }]}>
            <Text style={{ fontSize: 16, color }}>{icon}</Text>
          </View>
          <Text style={[styles.text, { color: colors.text }]}>{item}</Text>
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
    gap: 10,
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    paddingLeft: 0,
    overflow: 'hidden',
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  bar: {
    width: 4,
    alignSelf: 'stretch',
    flexShrink: 0,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
