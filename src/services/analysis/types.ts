export interface ServeStats {
  totalServes: number;
  firstServeAttempts: number;
  firstServeIn: number;
  secondServeIn: number;
  doubleFaults: number;
  aces: number;
  returnErrors: number;
}

export interface RallyStats {
  totalPoints: number;
  averageRallyCount: number;
  shortRallyCount: number;
  longRallyCount: number;
}

export interface ShotBreakdown {
  shotType: import('@/types').ShotType;
  total: number;
  wonCount: number;
  lostCount: number;
}
