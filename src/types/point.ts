export type ShotType = 'serve' | 'forehand' | 'backhand' | 'volley' | 'smash' | 'lob' | 'drop';
export type ServeResult = 'firstIn' | 'secondIn' | 'doubleFault' | 'ace' | 'returnError';
export type ResultReason = 'winner' | 'forcedError' | 'unforcedError' | 'net' | 'out';
export type PointOutcome = 'won' | 'lost';

export interface ShotLocation {
  // 0..1 正規化座標
  x: number;
  // 0..1 正規化座標
  y: number;
}

export interface PointRecord {
  id: string;
  sessionId: string;
  // ISO 8601
  timestamp: string;
  outcome: PointOutcome;
  serveResult?: ServeResult;
  shotType: ShotType;
  resultReason: ResultReason;
  // 0以上
  rallyCount: number;
  // コート上の打球位置
  shotLocation?: ShotLocation;
  // 狙った位置
  targetLocation?: ShotLocation;
  // 動画内の秒数
  videoTimestamp?: number;
  note?: string;
}
