import { type CourtCalibration } from './court';
import { type MatchFormat, type SoftTennisPosition } from './player';
import { type PointRecord } from './point';
import { type RallyAnalysis } from './rallyAnalysis';

export type SessionType =
  | 'match'
  | 'serveTraining'
  | 'strokeTraining'
  | 'volleyTraining'
  | 'freeTraining';

interface BaseSession {
  id: string;
  title: string;
  sessionType: SessionType;
  matchFormat: MatchFormat;
  opponentName?: string;
  // local URI
  videoUri?: string;
  // seconds, populated after the app can inspect the local video
  videoDurationSec?: number;
  courtCalibration?: CourtCalibration;
  points: PointRecord[];
  /** Rally histories extracted from video analysis (newest last). */
  rallyAnalyses?: RallyAnalysis[];
  note?: string;
  // ISO 8601
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HardTennisSession extends BaseSession {
  sport: 'tennis';
}

export interface SoftTennisSession extends BaseSession {
  sport: 'softTennis';
  // 前衛/後衛ポジション
  position?: SoftTennisPosition;
}

export type TennisSession = HardTennisSession | SoftTennisSession;
