import { type MatchFormat, type SoftTennisPosition } from './player';
import { type PointRecord } from './point';

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
  points: PointRecord[];
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
