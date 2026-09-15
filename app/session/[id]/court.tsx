import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, CourtLines, EmptyState } from '@/components/common';
import { CourtChart } from '@/components/court';
import { useSession } from '@/hooks';
import { fontFamily, useTheme } from '@/theme';
import { type ShotLocation } from '@/types';

type OutcomeFilter = 'all' | 'won' | 'lost';
const NUM = fontFamily.numeric;

const FILTERS: { key: OutcomeFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'won', label: '得点 ●' },
  { key: 'lost', label: '失点 ○' },
];

function hasLocation(location: ShotLocation | undefined): location is ShotLocation {
  return location !== undefined;
}

export default function CourtScreen() {
  const { colors, withAlpha } = useTheme();
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
        <View style={[styles.hero, { backgroundColor: colors.hero }]}>
          <View style={styles.heroMotif} pointerEvents="none">
            <CourtLines stroke={colors.onHero} strokeOpacity={0.12} strokeWidth={1.4} />
          </View>
          <Text style={[styles.heroEyebrow, { color: colors.heroAccent }]}>COURT MAP</Text>
          <Text style={[styles.heroTitle, { color: colors.onHero }]}>コート分布</Text>
          <View style={styles.heroStats}>
            <Text style={[styles.heroStat, { color: colors.onHero, fontFamily: NUM }]}>
              {shotLocations.length}
              <Text style={[styles.heroStatUnit, { color: withAlpha(colors.onHero, 0.68) }]}>
                {' '}
                ショット
              </Text>
            </Text>
            <Text style={[styles.heroMeta, { color: withAlpha(colors.onHero, 0.68) }]}>
              得点 <Text style={{ fontFamily: NUM }}>{wonCount}</Text> ・ 失点{' '}
              <Text style={{ fontFamily: NUM }}>{lostCount}</Text>
            </Text>
          </View>
        </View>

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
          <View
            style={[
              styles.emptyLocations,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyText, { color: colors.textSub }]}>
              表示できるショット位置がありません
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.courtWrapper,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
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
  hero: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 16,
    position: 'relative',
  },
  heroMotif: {
    height: 120,
    position: 'absolute',
    right: -20,
    top: -16,
    width: 240,
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginTop: 8,
  },
  heroStats: {
    marginTop: 10,
  },
  heroStat: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  heroStatUnit: {
    fontSize: 13,
    fontWeight: '700',
  },
  heroMeta: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  filters: {
    gap: 8,
    paddingRight: 20,
  },
  courtWrapper: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 20,
  },
  emptyLocations: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
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
    borderWidth: 1.5,
    opacity: 0.7,
  },
  legendText: {
    fontFamily: fontFamily.numeric,
    fontSize: 12,
  },
});
