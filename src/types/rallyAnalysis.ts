import { type ShotLocation } from './point';

/** Persisted rally history extracted from video (cloud or on-device). */

export type StrokeKind = 'forehand' | 'backhand' | 'serve' | 'unknown';
export type RallyOutcome = 'won' | 'lost' | 'unknown';

export interface ShotRecord {
  /** 1-based shot number within the rally. */
  index: number;
  stroke: StrokeKind;
  timeSec: number;
  frameIdx: number;
  /** Court coordinate in metres [x, y]. */
  courtXY?: [number, number];
  /** Court-normalized [0,1] location for top-down rendering. */
  location?: ShotLocation;
  /** e.g. "far_ad_deep". */
  zoneLabel?: string;
  /** Approximate speed near this shot (km/h). */
  speedKmh?: number | null;
}

export interface RallyBounceRecord {
  timeSec: number;
  courtXY: [number, number];
  location?: ShotLocation;
  zoneLabel?: string;
  inBounds?: boolean;
}

export interface RallyRecord {
  rally: number;
  startSec: number;
  endSec: number;
  shotCount: number;
  shots: ShotRecord[];
  bounces: RallyBounceRecord[];
  p95Kmh?: number | null;
  medianKmh?: number | null;
  /** Heuristic (auto) or user-confirmed point outcome for the player. */
  outcome: RallyOutcome;
  /** 0..1; auto heuristics are intentionally low-confidence (<=0.5). */
  outcomeConfidence: number;
  outcomeSource: 'auto' | 'confirmed';
  /** PointRecord id created when the outcome is confirmed. */
  pointId?: string;
}

export interface RallyAnalysisSummary {
  rallies: number;
  shots: number;
  bounces: number;
  p95Kmh?: number | null;
  medianKmh?: number | null;
}

export interface RallyAnalysis {
  id: string;
  /** ISO 8601. */
  createdAt: string;
  source: 'cloud' | 'on-device';
  courtType: 'singles' | 'doubles';
  /** Which half the tracked player is on (used for outcome heuristics). */
  playerSide: 'near' | 'far';
  summary: RallyAnalysisSummary;
  rallies: RallyRecord[];
}
