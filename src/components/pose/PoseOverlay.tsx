import { Line, Circle, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';
import { type Keypoint, type KeypointName } from '@/types';

interface PoseOverlayProps {
  keypoints: Keypoint[];
  width: number;
  height: number;
}

const MIN_SCORE = 0.3;

const CONNECTIONS: [KeypointName, KeypointName][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

export function PoseOverlay({ keypoints, width, height }: PoseOverlayProps) {
  const { colors } = useTheme();
  const byName = new Map(keypoints.map((keypoint) => [keypoint.name, keypoint]));
  const visibleKeypoints = keypoints.filter((keypoint) => keypoint.score > MIN_SCORE);

  return (
    <Svg height={height} width={width}>
      {CONNECTIONS.map(([fromName, toName]) => {
        const from = byName.get(fromName);
        const to = byName.get(toName);

        if (!from || !to || from.score <= MIN_SCORE || to.score <= MIN_SCORE) {
          return null;
        }

        return (
          <Line
            key={`${fromName}-${toName}`}
            stroke={colors.primary}
            strokeLinecap="round"
            strokeOpacity={0.62}
            strokeWidth={3}
            x1={from.x * width}
            x2={to.x * width}
            y1={from.y * height}
            y2={to.y * height}
          />
        );
      })}
      {visibleKeypoints.map((keypoint) => (
        <Circle
          cx={keypoint.x * width}
          cy={keypoint.y * height}
          fill={colors.primary}
          key={keypoint.name}
          opacity={0.9}
          r={4}
        />
      ))}
    </Svg>
  );
}
