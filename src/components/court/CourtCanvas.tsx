import { type ReactNode } from 'react';
import Svg, { Line, Rect } from 'react-native-svg';

import { colors } from '@/theme';
import { type SportType } from '@/types';

interface CourtCanvasProps {
  width: number;
  height: number;
  sport: SportType;
  children?: ReactNode;
}

export function CourtCanvas({ width, height, sport, children }: CourtCanvasProps) {
  const lineColor = colors.courtLine;
  const courtColor = sport === 'softTennis' ? colors.navyLight : colors.courtSurface;
  const netColor = colors.courtNet;
  const sportLabel = sport === 'softTennis' ? 'ソフトテニス' : '硬式テニス';
  const singlesLeft = width * 0.12;
  const singlesRight = width * 0.88;
  const centerX = width / 2;
  const netY = height / 2;
  const serviceLineY = height * 0.25;
  const strokeWidth = 2;

  return (
    <Svg
      accessibilityLabel={`${sportLabel}コート`}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <Rect fill={courtColor} height={height} width={width} x={0} y={0} />
      <Rect
        fill="none"
        height={height - strokeWidth}
        stroke={lineColor}
        strokeWidth={strokeWidth}
        width={width - strokeWidth}
        x={strokeWidth / 2}
        y={strokeWidth / 2}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={singlesLeft}
        x2={singlesLeft}
        y1={0}
        y2={height}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={singlesRight}
        x2={singlesRight}
        y1={0}
        y2={height}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={0}
        x2={width}
        y1={strokeWidth / 2}
        y2={strokeWidth / 2}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={0}
        x2={width}
        y1={height - strokeWidth / 2}
        y2={height - strokeWidth / 2}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={singlesLeft}
        x2={singlesRight}
        y1={serviceLineY}
        y2={serviceLineY}
      />
      <Line
        stroke={lineColor}
        strokeWidth={strokeWidth}
        x1={centerX}
        x2={centerX}
        y1={serviceLineY}
        y2={netY}
      />
      <Line stroke={netColor} strokeWidth={3} x1={0} x2={width} y1={netY} y2={netY} />
      {children}
    </Svg>
  );
}
