import { type CourtCalibration } from './court';
import { type MatchFormat, type SoftTennisPosition } from './player';
import { type ResultReason, type ServeResult, type ShotLocation, type ShotType } from './point';
import { type SessionType } from './session';

/** Scoreless rally interval — eval-compatible, training pool only. */
export interface SubmissionRally {
  startSec: number;
  endSec: number;
}

/** Full per-point label including outcome/配球. Training data only — NOT for scoreless test set. */
export interface SubmissionPointLabel {
  videoTimestamp?: number;
  rallyStartSec?: number;
  rallyEndSec?: number;
  outcome: 'won' | 'lost';
  shotType?: ShotType;
  serveResult?: ServeResult;
  resultReason?: ResultReason;
  rallyCount?: number;
  /** 配球（着地位置）0..1 正規化 */
  shotLocation?: ShotLocation;
  /** 狙い 0..1 正規化 */
  targetLocation?: ShotLocation;
}

/**
 * Closed-beta submission manifest — one per session upload.
 * sha256 is intentionally left empty ('') by the client; the eval ingestion
 * script computes it from the uploaded video file.
 */
export interface SubmissionManifest {
  schemaVersion: 1;
  submissionId: string;
  /** Anonymous participant ID (NanoID-compatible random string) generated once and persisted. */
  participantId: string;
  /** App version string from Constants.expoConfig.version. */
  appVersion: string;
  /** ISO 8601 */
  createdAt: string;
  sport: 'tennis' | 'softTennis';
  sessionType: SessionType;
  matchFormat: MatchFormat;
  /** ソフトテニス専用ポジション (forehand/backhand side) */
  position?: SoftTennisPosition;
  video: {
    filename: string;
    durationSec?: number;
    /** Nominal capture frame rate (default 30). */
    fps: number;
    /** Computed by ingestion script; empty string from client. */
    sha256: string;
  };
  courtCalibration?: CourtCalibration;
  /** Scoreless rally intervals for eval pipeline (training pool). */
  rallies: SubmissionRally[];
  /** Full tactical labels (scores/配球). Training use only. */
  points: SubmissionPointLabel[];
  consent: {
    version: number;
    acceptedAt: string;
  };
}
