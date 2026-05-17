import { Fragment, useEffect, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Image as SvgImage, Line, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';
import { type ImagePoint } from '@/types';

type CalibrationCorners = [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

interface CalibrationCanvasProps {
  imageUri: string;
  corners: CalibrationCorners;
  onCornersChange: (corners: CalibrationCorners) => void;
  width: number;
  height: number;
}

interface CornerHandleProps {
  index: number;
  label: string;
  point: ImagePoint;
  width: number;
  height: number;
  onChange: (index: number, point: ImagePoint) => void;
}

const CORNER_LABELS = ['手前左', '手前右', '奥右', '奥左'] as const;
const HANDLE_RADIUS = 16;
const HIT_SIZE = 52;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function CornerDragTarget({ index, label, point, width, height, onChange }: CornerHandleProps) {
  const pointRef = useRef(point);
  const startRef = useRef(point);

  useEffect(() => {
    pointRef.current = point;
  }, [point]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = pointRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          onChange(index, {
            x: clamp01(startRef.current.x + gesture.dx / width),
            y: clamp01(startRef.current.y + gesture.dy / height),
          });
        },
      }),
    [height, index, onChange, width]
  );

  return (
    <View
      accessibilityLabel={`${label}コーナー`}
      accessibilityRole="adjustable"
      {...panResponder.panHandlers}
      style={[
        styles.dragTarget,
        {
          left: point.x * width - HIT_SIZE / 2,
          top: point.y * height - HIT_SIZE / 2,
        },
      ]}
    />
  );
}

export function CalibrationCanvas({
  imageUri,
  corners,
  onCornersChange,
  width,
  height,
}: CalibrationCanvasProps) {
  const { colors } = useTheme();

  const updateCorner = useMemo(
    () => (index: number, point: ImagePoint) => {
      const next = corners.map((corner, cornerIndex) =>
        cornerIndex === index ? point : corner
      ) as CalibrationCorners;
      onCornersChange(next);
    },
    [corners, onCornersChange]
  );

  return (
    <View style={[styles.container, { height, width }]}>
      <Svg
        accessibilityLabel="コート較正キャンバス"
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

        {corners.map((corner, index) => {
          const nextCorner = corners[(index + 1) % corners.length];
          return (
            <Line
              key={`edge-${CORNER_LABELS[index]}`}
              opacity={0.9}
              stroke={colors.primary}
              strokeWidth={3}
              x1={corner.x * width}
              x2={nextCorner.x * width}
              y1={corner.y * height}
              y2={nextCorner.y * height}
            />
          );
        })}

        {corners.map((corner, index) => {
          const cx = corner.x * width;
          const cy = corner.y * height;

          return (
            <Fragment key={CORNER_LABELS[index]}>
              <Circle cx={cx} cy={cy} fill={colors.primary} r={HANDLE_RADIUS} />
              <SvgText
                fill={colors.surface}
                fontSize={8.5}
                fontWeight="700"
                textAnchor="middle"
                x={cx}
                y={cy + 3}
              >
                {CORNER_LABELS[index]}
              </SvgText>
            </Fragment>
          );
        })}
      </Svg>

      {corners.map((corner, index) => (
        <CornerDragTarget
          height={height}
          index={index}
          key={`drag-${CORNER_LABELS[index]}`}
          label={CORNER_LABELS[index]}
          onChange={updateCorner}
          point={corner}
          width={width}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  dragTarget: {
    height: HIT_SIZE,
    position: 'absolute',
    width: HIT_SIZE,
  },
});
