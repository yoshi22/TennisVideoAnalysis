import { G, Line, Rect, Svg } from 'react-native-svg';

import { useTheme } from '@/theme';

interface CourtLinesProps {
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  width?: number | string;
  height?: number | string;
}

export function CourtLines({
  stroke,
  strokeOpacity = 0.5,
  strokeWidth = 1,
  width = '100%',
  height = '100%',
}: CourtLinesProps) {
  const { colors } = useTheme();
  const s = stroke ?? colors.surface;

  return (
    <Svg viewBox="0 0 360 180" preserveAspectRatio="none" width={width} height={height}>
      <G fill="none" stroke={s} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth}>
        {/* outer court */}
        <Rect x="20" y="20" width="320" height="140" />
        {/* singles sidelines */}
        <Line x1="20" y1="40" x2="340" y2="40" />
        <Line x1="20" y1="140" x2="340" y2="140" />
        {/* net */}
        <Line x1="180" y1="20" x2="180" y2="160" strokeWidth={strokeWidth * 1.4} />
        {/* service boxes */}
        <Line x1="80" y1="40" x2="80" y2="140" />
        <Line x1="280" y1="40" x2="280" y2="140" />
        <Line x1="80" y1="90" x2="280" y2="90" />
        {/* center marks */}
        <Line x1="20" y1="90" x2="30" y2="90" />
        <Line x1="330" y1="90" x2="340" y2="90" />
      </G>
    </Svg>
  );
}
