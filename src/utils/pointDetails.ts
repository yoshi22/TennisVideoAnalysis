import { type PointRecord } from '@/types';

export type CompletePointRecord = PointRecord &
  Required<Pick<PointRecord, 'shotType' | 'resultReason' | 'rallyCount'>>;

export function isPointComplete(point: PointRecord): point is CompletePointRecord {
  return (
    point.shotType !== undefined &&
    point.resultReason !== undefined &&
    typeof point.rallyCount === 'number'
  );
}

export function getPointDetailStatus(point: PointRecord): 'quick' | 'complete' {
  return point.detailStatus ?? (isPointComplete(point) ? 'complete' : 'quick');
}
