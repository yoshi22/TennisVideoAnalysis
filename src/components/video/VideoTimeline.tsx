import { Fragment } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { type TimestampedPoint } from '@/hooks/useSessionVideo';
import { useTheme } from '@/theme';
import { formatSeconds } from '@/utils/formatTime';

interface VideoTimelineProps {
  points: TimestampedPoint[];
  durationSec: number;
  onSelect: (point: TimestampedPoint) => void;
}

export function VideoTimeline({ points, durationSec, onSelect }: VideoTimelineProps) {
  const { colors, withAlpha } = useTheme();

  return (
    <View style={styles.timelineWrap}>
      <View style={[styles.timelineTrack, { backgroundColor: colors.surfaceAlt }]} />
      {points.map((point) => {
        const ratio = Math.max(0, Math.min(1, point.videoTimestamp / durationSec));
        const isWon = point.outcome === 'won';
        const isDraft = point.reviewStatus === 'draft';
        const hasInterval = point.rallyStartSec !== undefined && point.rallyEndSec !== undefined;
        const startRatio = hasInterval
          ? Math.max(0, Math.min(1, point.rallyStartSec! / durationSec))
          : ratio;
        const endRatio = hasInterval
          ? Math.max(0, Math.min(1, point.rallyEndSec! / durationSec))
          : ratio;
        return (
          <Fragment key={point.id}>
            <TouchableOpacity
              accessibilityLabel={`${formatSeconds(point.videoTimestamp)}へ移動`}
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={() => onSelect(point)}
              style={[styles.markerTouch, { left: `${ratio * 100}%`, opacity: isDraft ? 0.4 : 1 }]}
            >
              <View
                style={[
                  styles.marker,
                  {
                    borderBottomColor: isWon ? colors.primary : colors.danger,
                    borderLeftColor: withAlpha(colors.bg, 0),
                    borderRightColor: withAlpha(colors.bg, 0),
                  },
                ]}
              />
            </TouchableOpacity>
            {hasInterval ? (
              <TouchableOpacity
                accessibilityLabel={`${formatSeconds(point.rallyStartSec!)}から${formatSeconds(
                  point.rallyEndSec!
                )}へ移動`}
                accessibilityRole="button"
                activeOpacity={0.82}
                onPress={() => onSelect(point)}
                style={[
                  styles.intervalBar,
                  {
                    backgroundColor: isWon ? colors.primary : colors.danger,
                    left: `${startRatio * 100}%`,
                    width: `${Math.max(0.5, (endRatio - startRatio) * 100)}%`,
                  },
                ]}
              />
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  timelineWrap: {
    height: 34,
    justifyContent: 'center',
    position: 'relative',
  },
  timelineTrack: {
    borderRadius: 999,
    height: 6,
    width: '100%',
  },
  markerTouch: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: -22,
    position: 'absolute',
    top: -5,
    width: 44,
  },
  intervalBar: {
    borderRadius: 2,
    height: 6,
    opacity: 0.45,
    position: 'absolute',
    top: 14,
  },
  marker: {
    borderBottomWidth: 12,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    height: 0,
    width: 0,
  },
});
