import {
  type PointOutcome,
  type ResultReason,
  type ServeResult,
  type ShotLocation,
  type ShotType,
} from '@/types';

export interface PartialPointRecord {
  outcome?: PointOutcome;
  serveResult?: ServeResult;
  shotType?: ShotType;
  resultReason?: ResultReason;
  rallyCount: number;
  shotLocation?: ShotLocation;
}
