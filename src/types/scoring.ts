import {
  type PointOutcome,
  type ResultReason,
  type ServeResult,
  type ShotLocation,
  type ShotType,
} from './point';

export interface AutoPointCandidate {
  id: string;
  suggestedOutcome: PointOutcome;
  suggestedShotType: ShotType;
  suggestedResultReason: ResultReason;
  suggestedRallyCount: number;
  suggestedShotLocation?: ShotLocation;
  suggestedServeResult?: ServeResult;
  /** Seconds into the source video where the rally ended. */
  videoTimestamp: number;
  /** Human-readable reasoning strings shown in the confirmation UI. */
  diagnostics: string[];
}
