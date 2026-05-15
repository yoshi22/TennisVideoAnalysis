import { Circle } from 'react-native-svg';

import { colors } from '@/theme';
import { type ShotLocation, type SportType } from '@/types';
import { toCanvas } from '@/utils/court-geometry';

import { CourtCanvas } from './CourtCanvas';

interface CourtHeatmapProps {
  sport: SportType;
  locations: ShotLocation[];
  width?: number;
  height?: number;
}

export function CourtHeatmap({ sport, locations, width = 320, height = 520 }: CourtHeatmapProps) {
  return (
    <CourtCanvas height={height} sport={sport} width={width}>
      {locations.map((location, index) => {
        const point = toCanvas(location, width, height);

        return (
          <Circle
            cx={point.x}
            cy={point.y}
            fill={colors.accent}
            key={`${location.x}-${location.y}-${index}`}
            opacity={0.4}
            r={8}
          />
        );
      })}
    </CourtCanvas>
  );
}
