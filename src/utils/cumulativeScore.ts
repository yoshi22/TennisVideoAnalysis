import { type PointRecord } from '@/types';

export function computeCumulativeScores(
  points: PointRecord[]
): Map<string, { w: number; l: number }> {
  let w = 0;
  let l = 0;
  return new Map(
    points.map((p) => {
      if (p.outcome === 'won') w++;
      else l++;
      return [p.id, { w, l }];
    })
  );
}
