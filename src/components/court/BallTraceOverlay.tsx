import Svg, { Circle, Image as SvgImage, Line } from 'react-native-svg';

import { useTheme } from '@/theme';
import { type BallTrajectory, type Bounce } from '@/types';

interface BallTraceOverlayProps {
  imageUri: string;
  trajectory: BallTrajectory;
  bounces: Bounce[];
  width: number;
  height: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function BallTraceOverlay({
  imageUri,
  trajectory,
  bounces,
  width,
  height,
}: BallTraceOverlayProps) {
  const { colors } = useTheme();
  const dangerColor = colors.danger || '#EF4444';
  const detections = trajectory.detections;

  return (
    <Svg
      accessibilityLabel="ボール軌跡"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <SvgImage
        height={height}
        href={{ uri: imageUri }}
        preserveAspectRatio="none"
        width={width}
        x={0}
        y={0}
      />

      {detections.slice(0, -1).map((detection, index) => {
        const next = detections[index + 1];
        return (
          <Line
            key={`trace-${detection.timeSec}-${next.timeSec}`}
            opacity={0.7}
            stroke={colors.primary}
            strokeWidth={2}
            x1={clamp01(detection.imageX) * width}
            x2={clamp01(next.imageX) * width}
            y1={clamp01(detection.imageY) * height}
            y2={clamp01(next.imageY) * height}
          />
        );
      })}

      {detections.map((detection) => (
        <Circle
          cx={clamp01(detection.imageX) * width}
          cy={clamp01(detection.imageY) * height}
          fill={colors.primary}
          key={`detection-${detection.timeSec}`}
          r={3}
        />
      ))}

      {bounces.map((bounce) => (
        <Circle
          cx={clamp01(bounce.imagePoint.x) * width}
          cy={clamp01(bounce.imagePoint.y) * height}
          fill={bounce.inBounds ? colors.primary : dangerColor}
          key={`bounce-${bounce.timeSec}`}
          r={8}
        />
      ))}
    </Svg>
  );
}
