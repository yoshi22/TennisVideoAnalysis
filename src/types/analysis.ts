export type WeaknessPattern =
  | 'highDoubleFault'
  | 'lowFirstServeIn'
  | 'shortRally'
  | 'weakBackhand'
  | 'weakVolley'
  | 'frequentUnforcedError'
  | 'poorNetApproach';

export interface CoachingTip {
  id: string;
  weakness: WeaknessPattern;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PracticeDrill {
  id: string;
  weakness: WeaknessPattern;
  name: string;
  description: string;
  durationMin: number;
}

export interface TennisAnalysisResult {
  sessionId: string;
  analyzedAt: string;
  // 0..1
  firstServeInRate: number;
  // 0..1
  secondServeInRate: number;
  doubleFaultCount: number;
  aceCount: number;
  // 0..1
  winRate: number;
  averageRallyCount: number;
  weaknesses: WeaknessPattern[];
  tips: CoachingTip[];
  drills: PracticeDrill[];
  strengths: string[];
}
