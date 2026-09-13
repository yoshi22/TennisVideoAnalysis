import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, EmptyState, SectionHeader, SegmentedControl } from '@/components/common';
import { CourtHeatmap } from '@/components/court';
import { useSession } from '@/hooks';
import { useSessionStore } from '@/stores';
import { useTheme } from '@/theme';
import {
  type RallyOutcome,
  type RallyRecord,
  type ShotLocation,
  type ShotRecord,
  type StrokeKind,
} from '@/types';

const OUTCOME_OPTIONS: { label: string; value: RallyOutcome }[] = [
  { label: '勝ち', value: 'won' },
  { label: '負け', value: 'lost' },
  { label: '未定', value: 'unknown' },
];

function strokeLabel(stroke: StrokeKind): string {
  switch (stroke) {
    case 'forehand':
      return 'フォア';
    case 'backhand':
      return 'バック';
    case 'serve':
      return 'サーブ';
    default:
      return '—';
  }
}

function describeZone(label: string | undefined): string {
  if (!label) return 'コース不明';
  const [half, side, depth] = label.split('_');
  const jHalf = half === 'near' ? '手前' : half === 'far' ? '奥' : half;
  const jSide = side === 'ad' ? 'アド' : side === 'deuce' ? 'デュース' : side;
  const jDepth = depth === 'short' ? '浅い' : depth === 'deep' ? '深い' : depth;
  return [jHalf, jSide, jDepth].filter(Boolean).join('・');
}

function fmtSpeed(kmh: number | null | undefined): string {
  return kmh !== null && kmh !== undefined ? `${Math.round(kmh)}km/h` : '—';
}

export default function RallyHistoryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, sessionId } = useSession();
  const confirmRallyOutcome = useSessionStore((s) => s.confirmRallyOutcome);

  const analyses = session?.rallyAnalyses ?? [];
  const analysis = analyses.length > 0 ? analyses[analyses.length - 1] : null;

  const allBounceLocations: ShotLocation[] =
    analysis?.rallies.flatMap((r) =>
      r.bounces.map((b) => b.location).filter((l): l is ShotLocation => Boolean(l))
    ) ?? [];
  const sport = session?.sport ?? 'tennis';

  const renderShot = (shot: ShotRecord) => (
    <View key={`${shot.index}-${shot.frameIdx}`} style={styles.shotRow}>
      <Text style={[styles.shotIndex, { color: colors.textMuted }]}>#{shot.index}</Text>
      <Text style={[styles.shotStroke, { color: colors.text }]}>{strokeLabel(shot.stroke)}</Text>
      <Text style={[styles.shotZone, { color: colors.textMuted }]} numberOfLines={1}>
        {describeZone(shot.zoneLabel)}
      </Text>
      <Text style={[styles.shotSpeed, { color: colors.textMuted }]}>{fmtSpeed(shot.speedKmh)}</Text>
    </View>
  );

  const renderRally = (rally: RallyRecord, analysisId: string) => (
    <Card key={rally.rally} style={styles.rallyCard}>
      <View style={styles.rallyHeader}>
        <Text style={[styles.rallyTitle, { color: colors.text }]}>ラリー {rally.rally}</Text>
        <Text style={[styles.rallyMeta, { color: colors.textMuted }]}>
          {rally.startSec.toFixed(1)}–{rally.endSec.toFixed(1)}秒 ・ {rally.shotCount}打
        </Text>
      </View>
      <Text style={[styles.rallyMeta, { color: colors.textMuted }]}>
        速度(目安) p95 {fmtSpeed(rally.p95Kmh)} / 中央値 {fmtSpeed(rally.medianKmh)}
      </Text>

      <View style={styles.outcomeRow}>
        <Text style={[styles.outcomeLabel, { color: colors.textMuted }]}>
          勝敗{rally.outcomeSource === 'auto' ? '(自動推定・要確認)' : '(確認済)'}
        </Text>
        <SegmentedControl
          options={OUTCOME_OPTIONS}
          selected={rally.outcome}
          onSelect={(value) => confirmRallyOutcome(sessionId, analysisId, rally.rally, value)}
        />
      </View>

      <View style={styles.shotList}>{rally.shots.map(renderShot)}</View>
    </Card>
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'ラリー履歴',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
              testID="rally-history-back"
            >
              <Ionicons color={colors.surface} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      {!analysis ? (
        <View style={styles.emptyWrapper}>
          <EmptyState
            description="動画をクラウド解析するとラリー履歴が表示されます。"
            title="ラリー履歴がありません"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card style={styles.summaryCard}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              {analysis.summary.rallies}ラリー ・ {analysis.summary.shots}ショット
            </Text>
            <Text style={[styles.rallyMeta, { color: colors.textMuted }]}>
              速度(目安) p95 {fmtSpeed(analysis.summary.p95Kmh)} / 中央値{' '}
              {fmtSpeed(analysis.summary.medianKmh)}
            </Text>
            <Text style={[styles.caveat, { color: colors.textMuted }]}>
              速度は近似の目安、勝敗は自動推定です。各ラリーで確認・修正してください。
            </Text>
          </Card>

          {allBounceLocations.length > 0 ? (
            <View>
              <SectionHeader title="バウンド位置(コース)" />
              <View style={styles.mapWrap}>
                <CourtHeatmap locations={allBounceLocations} sport={sport} />
              </View>
            </View>
          ) : null}

          <SectionHeader title="ラリー別" />
          {analysis.rallies.map((r) => renderRally(r, analysis.id))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  summaryCard: { gap: 6, padding: 14 },
  summaryTitle: { fontSize: 18, fontWeight: '800' },
  caveat: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  mapWrap: { alignItems: 'center', marginVertical: 8 },
  rallyCard: { gap: 8, padding: 14 },
  rallyHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  rallyTitle: { fontSize: 16, fontWeight: '700' },
  rallyMeta: { fontSize: 13 },
  outcomeRow: { gap: 6, marginTop: 4 },
  outcomeLabel: { fontSize: 12, fontWeight: '600' },
  shotList: { gap: 4, marginTop: 6 },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shotIndex: { width: 30, fontSize: 12, fontWeight: '700' },
  shotStroke: { width: 52, fontSize: 13, fontWeight: '600' },
  shotZone: { flex: 1, fontSize: 12 },
  shotSpeed: { width: 68, fontSize: 12, textAlign: 'right' },
  backButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
