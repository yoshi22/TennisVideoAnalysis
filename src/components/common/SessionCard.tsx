import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/theme';
import { type TennisSession } from '@/types/session';

import { Tag } from './Tag';

interface SessionCardProps {
  session: TennisSession;
  onPress?: () => void;
  compact?: boolean;
}

export function SessionCard({ session: s, onPress, compact = false }: SessionCardProps) {
  const { colors } = useTheme();
  const sportLabel = s.sport === 'tennis' ? '硬式' : 'ソフト';
  const sportTone = s.sport === 'softTennis' ? colors.accent : colors.primary;

  const wonCount = s.points.filter((p) => p.outcome === 'won').length;
  const lostCount = s.points.filter((p) => p.outcome === 'lost').length;
  const score = s.points.length > 0 ? `${wonCount}–${lostCount}` : '—';

  const date = new Date(s.startedAt);
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

  const typeLabel: Record<string, string> = {
    match: 'マッチ',
    serveTraining: 'サーブ練習',
    strokeTraining: 'ストローク練習',
    volleyTraining: 'ボレー練習',
    freeTraining: '練習',
  };

  const pad = compact ? 12 : 14;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          padding: pad,
        },
      ]}
    >
      <View style={styles.tagRow}>
        <Tag color={sportTone} bg={`${sportTone}1A`}>
          {sportLabel}
        </Tag>
        <Tag color={colors.textSub} bg={colors.surfaceAlt}>
          {s.matchFormat === 'singles' ? 'シングルス' : 'ダブルス'}
        </Tag>
        <Tag color={colors.textSub} bg={colors.surfaceAlt}>
          {typeLabel[s.sessionType] ?? '練習'}
        </Tag>
        <View style={styles.spacer} />
        <Text style={[styles.dateText, { color: colors.textMuted }]}>{dateStr}</Text>
      </View>
      <View style={styles.bottom}>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {s.title}
          </Text>
          <Text style={[styles.sub, { color: colors.textSub }]}>{s.points.length} ポイント</Text>
        </View>
        <Text style={[styles.score, { color: colors.text }]}>{score}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 10,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  spacer: {
    flex: 1,
  },
  dateText: {
    fontSize: 11,
    fontWeight: '400',
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  sub: {
    fontSize: 12,
  },
  score: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
