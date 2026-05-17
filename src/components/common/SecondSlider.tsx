import { useMemo, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { useTheme } from '@/theme';

interface SecondSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function formatSecond(value: number): string {
  return Number.isInteger(value) ? `${value.toFixed(0)}秒` : `${value.toFixed(1)}秒`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function SecondSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 60,
  step = 0.5,
}: SecondSliderProps) {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const ratio = max > min ? (clamp(value, min, max) - min) / (max - min) : 0;

  const updateFromEvent = (event: GestureResponderEvent) => {
    if (trackWidth <= 0) {
      return;
    }

    const locationX = clamp(event.nativeEvent.locationX, 0, trackWidth);
    const raw = min + (locationX / trackWidth) * (max - min);
    const stepped = min + Math.round((raw - min) / step) * step;
    onChange(Number(clamp(stepped, min, max).toFixed(2)));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: updateFromEvent,
        onPanResponderMove: updateFromEvent,
      }),
    [max, min, onChange, step, trackWidth, updateFromEvent]
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <View style={[styles.valuePill, { backgroundColor: colors.primaryLo }]}>
          <Text style={[styles.valueText, { color: colors.primary }]}>{formatSecond(value)}</Text>
        </View>
      </View>

      <View
        accessibilityLabel={`${label}スライダー`}
        accessibilityRole="adjustable"
        onLayout={handleLayout}
        style={styles.trackHitArea}
        {...panResponder.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
          <View
            style={[
              styles.trackFill,
              {
                backgroundColor: colors.primary,
                width: `${Math.round(ratio * 100)}%`,
              },
            ]}
          />
          <View
            style={[
              styles.thumb,
              {
                backgroundColor: colors.primary,
                borderColor: colors.surface,
                left: `${Math.round(ratio * 100)}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  valuePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  valueText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  trackHitArea: {
    justifyContent: 'center',
    minHeight: 44,
  },
  track: {
    borderRadius: 999,
    height: 8,
    position: 'relative',
  },
  trackFill: {
    borderRadius: 999,
    height: '100%',
  },
  thumb: {
    borderRadius: 12,
    borderWidth: 3,
    height: 24,
    marginLeft: -12,
    marginTop: -16,
    position: 'absolute',
    top: '50%',
    width: 24,
  },
});
