import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Path, Svg } from 'react-native-svg';

import { CourtChart } from '@/components/court';
import { SERVE_RESULTS, SERVE_RESULT_META } from '@/constants/serveResults';
import { SHOT_TYPES, SHOT_TYPE_META } from '@/constants/shotTypes';
import { useTheme } from '@/theme';
import {
  type PointOutcome,
  type PointRecord,
  type ResultReason,
  type ServeResult,
  type ShotLocation,
  type ShotType,
  type SportType,
} from '@/types';

function IcClose({ color, size }: { color: string; size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    >
      <Path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

type Draft = {
  serveResult?: ServeResult;
  shotType?: ShotType;
  resultReason?: ResultReason;
  rallyCount: number;
};

type ReasonOption = { value: ResultReason; label: string; color: 'success' | 'warning' | 'danger' };

const REASON_OPTIONS: ReasonOption[] = [
  { value: 'winner', label: 'ウィナー', color: 'success' },
  { value: 'forcedError', label: '誘ったミス', color: 'success' },
  { value: 'unforcedError', label: '凡ミス', color: 'warning' },
  { value: 'net', label: 'ネット', color: 'danger' },
  { value: 'out', label: 'アウト', color: 'danger' },
];

const RALLY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, '10+'] as const;
const STEP_NAMES = ['', 'サーブ', 'ショット', '理由', 'ラリー数', 'コース'];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export interface PointLogSheetProps {
  open: boolean;
  outcome: PointOutcome;
  sport: SportType;
  onCommit: (data: Omit<PointRecord, 'id' | 'sessionId' | 'timestamp'>) => void;
  onClose: () => void;
}

export function PointLogSheet({ open, outcome, sport, onCommit, onClose }: PointLogSheetProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({ rallyCount: 1 });

  useEffect(() => {
    if (open) {
      setStep(1);
      setDraft({ rallyCount: 1 });
    }
  }, [open, outcome]);

  const advance = (update: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...update }));
    setStep((s) => s + 1);
  };

  const commit = (loc?: ShotLocation) => {
    if (!draft.shotType || !draft.resultReason) return;
    onCommit({
      outcome,
      serveResult: draft.serveResult,
      shotType: draft.shotType,
      resultReason: draft.resultReason,
      rallyCount: draft.rallyCount,
      shotLocation: loc,
    });
  };

  const toneColor = (tone: 'success' | 'warning' | 'danger') =>
    tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.danger;

  const outcomeColor = outcome === 'won' ? colors.success : colors.danger;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.badge, { backgroundColor: `${outcomeColor}1A` }]}>
                <Text style={[styles.badgeText, { color: outcomeColor }]}>
                  {outcome === 'won' ? '得点' : '失点'}
                </Text>
              </View>
              <Text style={[styles.stepName, { color: colors.text }]}>
                {STEP_NAMES[step]}を選択
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={[styles.stepCount, { color: colors.textMuted }]}>{step} / 5</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <IcClose color={colors.textSub} size={20} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Step 1 — Serve */}
            {step === 1 && (
              <View style={styles.grid3}>
                {SERVE_RESULTS.map((sr) => (
                  <TouchableOpacity
                    key={sr}
                    style={[
                      styles.optBtn,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    onPress={() => advance({ serveResult: sr })}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.optText, { color: colors.text }]}>
                      {SERVE_RESULT_META[sr].label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.optBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => advance({ serveResult: undefined })}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optText, { color: colors.textMuted }]}>スキップ</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2 — Shot type */}
            {step === 2 &&
              chunk(SHOT_TYPES, 3).map((row, ri) => (
                <View key={ri} style={styles.row}>
                  {row.map((st) => (
                    <TouchableOpacity
                      key={st}
                      style={[
                        styles.optBtnFlex,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => advance({ shotType: st })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.optText, { color: colors.text }]}>
                        {SHOT_TYPE_META[st].label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {row.length < 3 &&
                    Array.from({ length: 3 - row.length }).map((_, i) => (
                      <View key={i} style={styles.optBtnFlex} />
                    ))}
                </View>
              ))}

            {/* Step 3 — Result reason */}
            {step === 3 &&
              chunk(REASON_OPTIONS, 2).map((row, ri) => (
                <View key={ri} style={styles.row}>
                  {row.map((r) => {
                    const c = toneColor(r.color);
                    return (
                      <TouchableOpacity
                        key={r.value}
                        style={[
                          styles.optBtnFlex,
                          { backgroundColor: `${c}1A`, borderColor: 'transparent' },
                        ]}
                        onPress={() => advance({ resultReason: r.value })}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.optText, { color: c }]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {row.length < 2 && <View style={styles.optBtnFlex} />}
                </View>
              ))}

            {/* Step 4 — Rally count */}
            {step === 4 &&
              chunk([...RALLY_OPTIONS], 5).map((row, ri) => (
                <View key={ri} style={styles.row}>
                  {row.map((n) => (
                    <TouchableOpacity
                      key={String(n)}
                      style={[
                        styles.optBtnFlex,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => advance({ rallyCount: n === '10+' ? 10 : (n as number) })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.optText, { color: colors.text }]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}

            {/* Step 5 — Court position */}
            {step === 5 && (
              <View style={styles.courtStep}>
                <Text style={[styles.courtHint, { color: colors.textSub }]}>
                  コース位置をタップしてください
                </Text>
                <View style={styles.courtWrapper}>
                  <CourtChart sport={sport} width={280} height={360} onTap={(loc) => commit(loc)} />
                </View>
                <TouchableOpacity
                  style={[
                    styles.skipBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() => commit(undefined)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.skipText, { color: colors.textMuted }]}>
                    コースなしで記録
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: 32,
    maxHeight: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepName: {
    fontSize: 14,
    fontWeight: '600',
  },
  stepCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  scrollContent: {
    gap: 8,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  grid3: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optBtn: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    width: '31%',
    flexGrow: 1,
  },
  optBtnFlex: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  courtStep: {
    alignItems: 'center',
    gap: 12,
  },
  courtHint: {
    fontSize: 12,
    textAlign: 'center',
  },
  courtWrapper: {
    alignItems: 'center',
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 0.5,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
