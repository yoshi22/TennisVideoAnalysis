import { Circle, G, Svg } from 'react-native-svg';

interface DonutItem {
  value: number;
  color: string;
}

interface DonutProps {
  items?: DonutItem[];
  size?: number;
  stroke?: number;
  gap?: number;
}

export function Donut({ items = [], size = 120, stroke = 14, gap = 0.012 }: DonutProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
        {items.map((it, idx) => {
          const frac = it.value / total;
          const len = frac * c;
          const offset = -(acc * c + gap * c);
          acc += frac;
          const dashLen = Math.max(0, len - gap * c * 2);
          return (
            <Circle
              key={idx}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={it.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dashLen} ${c}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
            />
          );
        })}
      </G>
    </Svg>
  );
}
