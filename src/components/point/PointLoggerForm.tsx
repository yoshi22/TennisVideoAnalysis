import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, SectionHeader, SegmentedControl } from '@/components/common';
import { CourtChart } from '@/components/court';
import { colors, spacing } from '@/theme';
import {
  type PointOutcome,
  type PointRecord,
  type ResultReason,
  type ServeResult,
  type ShotLocation,
  type ShotType,
  type SportType,
} from '@/types';
import { generateId } from '@/utils/id';

import { RallyCountStepper } from './RallyCountStepper';
import { ResultReasonPicker } from './ResultReasonPicker';
import { ServeResultPicker } from './ServeResultPicker';
import { ShotTypePicker } from './ShotTypePicker';
import { type PartialPointRecord } from './types';

interface PointLoggerFormProps {
  sessionId: string;
  sport: SportType;
  onSave: (point: PointRecord) => void;
  onCancel?: () => void;
}

const OUTCOME_OPTIONS: { label: string; value: PointOutcome }[] = [
  { label: '得点', value: 'won' },
  { label: '失点', value: 'lost' },
];

export function PointLoggerForm({ sessionId, sport, onSave, onCancel }: PointLoggerFormProps) {
  const [point, setPoint] = useState<PartialPointRecord>({
    outcome: 'won',
    rallyCount: 0,
  });

  const canSave = Boolean(point.shotType && point.resultReason);

  const updatePoint = (update: Partial<PartialPointRecord>) => {
    setPoint((current) => ({ ...current, ...update }));
  };

  const handleSave = () => {
    if (!point.shotType || !point.resultReason) {
      return;
    }

    const record: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      outcome: point.outcome ?? 'won',
      serveResult: point.serveResult,
      shotType: point.shotType,
      resultReason: point.resultReason,
      rallyCount: point.rallyCount,
      shotLocation: point.shotLocation,
    };

    onSave(record);
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <SectionHeader title="ポイント結果" />
        <SegmentedControl
          accessibilityLabel="得点または失点"
          onSelect={(outcome: PointOutcome) => updatePoint({ outcome })}
          options={OUTCOME_OPTIONS}
          selected={point.outcome ?? 'won'}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="サーブ結果" />
        <ServeResultPicker
          onSelect={(serveResult: ServeResult) => updatePoint({ serveResult })}
          selected={point.serveResult}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="主なショット" />
        <ShotTypePicker
          onSelect={(shotType: ShotType) => updatePoint({ shotType })}
          selected={point.shotType}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="結果理由" />
        <ResultReasonPicker
          onSelect={(resultReason: ResultReason) => updatePoint({ resultReason })}
          selected={point.resultReason}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="ラリー数" />
        <RallyCountStepper
          onChange={(rallyCount) => updatePoint({ rallyCount })}
          value={point.rallyCount}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="ショット位置" />
        <View style={styles.courtWrapper}>
          <CourtChart
            onTap={(shotLocation: ShotLocation) => updatePoint({ shotLocation })}
            selectedLocation={point.shotLocation}
            sport={sport}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          accessibilityLabel="ポイントを保存"
          disabled={!canSave}
          label="保存"
          onPress={handleSave}
        />
        {onCancel ? (
          <Button
            accessibilityLabel="ポイント入力をキャンセル"
            label="キャンセル"
            onPress={onCancel}
            variant="secondary"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxl,
  },
  section: {
    gap: spacing.sm,
  },
  courtWrapper: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.lg,
  },
  actions: {
    gap: spacing.md,
  },
});
