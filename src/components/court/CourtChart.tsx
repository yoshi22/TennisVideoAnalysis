import { StyleSheet, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import { Circle } from 'react-native-svg';

import { colors } from '@/theme';
import { type ShotLocation, type SportType } from '@/types';
import { toCanvas, toNormalized } from '@/utils/court-geometry';

import { CourtCanvas } from './CourtCanvas';

interface CourtChartProps {
  sport: SportType;
  shotLocations?: ShotLocation[];
  onTap?: (location: ShotLocation) => void;
  selectedLocation?: ShotLocation;
  width?: number;
  height?: number;
}

export function CourtChart({
  sport,
  shotLocations = [],
  onTap,
  selectedLocation,
  width = 320,
  height = 520,
}: CourtChartProps) {
  const handlePress = (event: GestureResponderEvent) => {
    if (!onTap) {
      return;
    }

    const { locationX, locationY } = event.nativeEvent;
    onTap(toNormalized({ x: locationX, y: locationY }, width, height));
  };

  return (
    <View style={[styles.container, { width, height }]}>
      <CourtCanvas height={height} sport={sport} width={width}>
        {shotLocations.map((location, index) => {
          const point = toCanvas(location, width, height);

          return (
            <Circle
              cx={point.x}
              cy={point.y}
              fill={colors.accent}
              key={`${location.x}-${location.y}-${index}`}
              r={6}
            />
          );
        })}
        {selectedLocation ? (
          <Circle
            cx={toCanvas(selectedLocation, width, height).x}
            cy={toCanvas(selectedLocation, width, height).y}
            fill={colors.primary}
            r={10}
          />
        ) : null}
      </CourtCanvas>
      {onTap ? (
        <TouchableOpacity
          accessibilityLabel="ショット位置を選択"
          accessibilityRole="button"
          activeOpacity={1}
          onPress={handlePress}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
