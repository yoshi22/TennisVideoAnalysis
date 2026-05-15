import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, EmptyState, SessionCard } from '@/components/common';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type SessionType, type TennisSession } from '@/types';

type HistoryFilter = 'all' | 'win' | 'loss' | 'practice';

interface SessionGroup {
  key: string;
  label: string;
  sessions: TennisSession[];
}

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'win', label: '勝ち' },
  { key: 'loss', label: '負け' },
  { key: 'practice', label: '練習' },
];

const PRACTICE_SESSION_TYPES = new Set<SessionType>([
  'serveTraining',
  'strokeTraining',
  'volleyTraining',
  'freeTraining',
]);

function getSessionTime(session: TennisSession): number {
  const time = new Date(session.startedAt).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function sortSessionsByDate(sessions: TennisSession[]): TennisSession[] {
  return [...sessions].sort((a, b) => getSessionTime(b) - getSessionTime(a));
}

function getOutcomeCounts(session: TennisSession): { won: number; lost: number } {
  return session.points.reduce(
    (counts, point) => {
      if (point.outcome === 'won') {
        counts.won += 1;
      } else {
        counts.lost += 1;
      }

      return counts;
    },
    { won: 0, lost: 0 }
  );
}

function matchesFilter(session: TennisSession, filter: HistoryFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'practice') {
    return PRACTICE_SESSION_TYPES.has(session.sessionType);
  }

  const { won, lost } = getOutcomeCounts(session);

  if (filter === 'win') {
    return won > lost;
  }

  return session.points.length > 0 && won <= lost;
}

function formatMonthKey(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}/${month}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('/');

  return `${year}年${month}月`;
}

function groupSessionsByMonth(sessions: TennisSession[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const groupMap = new Map<string, SessionGroup>();

  sessions.forEach((session) => {
    const key = formatMonthKey(session.startedAt);
    const existingGroup = groupMap.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      return;
    }

    const group = {
      key,
      label: formatMonthLabel(key),
      sessions: [session],
    };

    groupMap.set(key, group);
    groups.push(group);
  });

  return groups;
}

export default function HistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const sessions = useSessionStore((state) => state.sessions);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const longPressSessionIdRef = useRef<string | null>(null);
  const longPressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (longPressResetTimerRef.current) {
        clearTimeout(longPressResetTimerRef.current);
      }
    };
  }, []);

  const sortedSessions = useMemo(() => sortSessionsByDate(sessions), [sessions]);
  const filteredSessions = useMemo(
    () => sortedSessions.filter((session) => matchesFilter(session, filter)),
    [filter, sortedSessions]
  );
  const groupedSessions = useMemo(() => groupSessionsByMonth(filteredSessions), [filteredSessions]);

  const confirmDelete = (session: TennisSession) => {
    Alert.alert('セッションを削除', `「${session.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => deleteSession(session.id),
      },
    ]);
  };

  const scheduleLongPressReset = (session: TennisSession, delay: number) => {
    if (longPressResetTimerRef.current) {
      clearTimeout(longPressResetTimerRef.current);
    }

    longPressResetTimerRef.current = setTimeout(() => {
      if (longPressSessionIdRef.current === session.id) {
        longPressSessionIdRef.current = null;
      }
    }, delay);
  };

  const handleLongPress = (session: TennisSession) => {
    longPressSessionIdRef.current = session.id;
    scheduleLongPressReset(session, 10000);

    confirmDelete(session);
  };

  const handlePressOut = (session: TennisSession) => {
    if (longPressSessionIdRef.current === session.id) {
      scheduleLongPressReset(session, 0);
    }
  };

  const openSession = (session: TennisSession) => {
    if (longPressSessionIdRef.current === session.id) {
      longPressSessionIdRef.current = null;
      if (longPressResetTimerRef.current) {
        clearTimeout(longPressResetTimerRef.current);
      }
      return;
    }

    router.push(`../session/${session.id}/log`);
  };

  const emptyTitle = sessions.length === 0 ? '履歴がありません' : '該当する履歴がありません';
  const emptyDescription =
    sessions.length === 0
      ? 'ホームから新しいセッションを作成できます'
      : '別のフィルターを選択してください';

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>履歴</Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>
            {sessions.length} 件のセッション
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.filterContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          {FILTERS.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              onPress={() => setFilter(item.key)}
              selected={filter === item.key}
              size="sm"
            />
          ))}
        </ScrollView>

        {groupedSessions.length === 0 ? (
          <View style={styles.emptyWrapper}>
            <EmptyState description={emptyDescription} title={emptyTitle} />
          </View>
        ) : (
          groupedSessions.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={[styles.monthLabel, { color: colors.textMuted }]}>{group.label}</Text>
              <View style={styles.sessionList}>
                {group.sessions.map((session) => (
                  <Pressable
                    accessibilityLabel={`${session.title}を開く`}
                    accessibilityRole="button"
                    key={session.id}
                    onLongPress={() => handleLongPress(session)}
                    onPress={() => openSession(session)}
                    onPressOut={() => handlePressOut(session)}
                  >
                    <View pointerEvents="none">
                      <SessionCard compact session={session} />
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterContent: {
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 14,
  },
  group: {
    marginBottom: 18,
  },
  monthLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    paddingHorizontal: 20,
    paddingBottom: 8,
    textTransform: 'uppercase',
  },
  sessionList: {
    gap: 10,
    paddingHorizontal: 20,
  },
  emptyWrapper: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 360,
  },
});
