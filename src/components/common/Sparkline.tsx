import { Circle, Path, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

interface SparklineProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

export function Sparkline({
  data = [],
  width = 60,
  height = 22,
  color,
  fillOpacity = 0.18,
  strokeWidth = 1.6,
}: SparklineProps) {
  const { colors } = useTheme();
  const c = color ?? colors.primary;

  if (!data.length) return null;

  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const rng = hi - lo || 1;

  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - 2 - ((v - lo) / rng) * (height - 4),
  ]);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={area} fill={c} fillOpacity={fillOpacity} />
      <Path
        d={line}
        fill="none"
        stroke={c}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={last[0]} cy={last[1]} r={2.2} fill={c} />
    </Svg>
  );
}
