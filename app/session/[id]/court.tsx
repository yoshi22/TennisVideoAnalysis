import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, EmptyState } from '@/components/common';
import { CourtChart } from '@/components/court';
import { useSession } from '@/hooks';
import { useTheme } from '@/theme';
import { type ShotLocation } from '@/types';

type OutcomeFilter = 'all' | 'won' | 'lost';

const FILTERS: { key: OutcomeFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'won', label: '得点 ●' },
  { key: 'lost', label: '失点 ○' },
];

function hasLocation(location: ShotLocation | undefined): location is ShotLocation {
  return location !== undefined;
}

export default function CourtScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const [filter, setFilter] = useState<OutcomeFilter>('all');

  const shotLocations = useMemo(() => {
    if (!session) return [];
    return session.points
      .filter((p) => filter === 'all' || p.outcome === filter)
      .map((p) => p.shotLocation)
      .filter(hasLocation);
  }, [filter, session]);

  const wonCount = useMemo(
    () => (session ? session.points.filter((p) => p.outcome === 'won').length : 0),
    [session]
  );
  const lostCount = useMemo(
    () => (session ? session.points.filter((p) => p.outcome === 'lost').length : 0),
    [session]
  );

  if (!session) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState icon="alert-circle-outline" title="セッションが見つかりません" />
        </View>
      </SafeAreaView>
    );
  }

  if (session.points.length === 0) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.emptyWrapper}>
          <EmptyState
            description="ポイントを記録するとショット位置を確認できます"
            icon="map-outline"
            title="ポイントがありません"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              onPress={() => setFilter(f.key)}
              selected={filter === f.key}
            />
          ))}
        </ScrollView>

        {/* Court */}
        {shotLocations.length === 0 ? (
          <View style={[styles.emptyLocations, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.textSub }]}>
              表示できるショット位置がありません
            </Text>
          </View>
        ) : (
          <View style={[styles.courtWrapper, { backgroundColor: colors.surface }]}>
            <CourtChart shotLocations={shotLocations} sport={session.sport} />
          </View>
        )}

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.courtLine }]} />
            <Text style={[styles.legendText, { color: colors.textSub }]}>得点 ({wonCount})</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.legendDot, styles.legendDotOutline, { borderColor: colors.courtLine }]}
            />
            <Text style={[styles.legendText, { color: colors.textSub }]}>失点 ({lostCount})</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  filters: {
    gap: 8,
    paddingRight: 20,
  },
  courtWrapper: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 20,
  },
  emptyLocations: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    padding: 20,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.9,
  },
  legendDotOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    opacity: 0.7,
  },
  legendText: {
    fontSize: 12,
  },
});
