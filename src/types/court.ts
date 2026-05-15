export type CourtArea =
  | 'deuce-service-box'
  | 'ad-service-box'
  | 'deuce-baseline'
  | 'ad-baseline'
  | 'net-area'
  | 'out';

export interface CourtAreaStat {
  area: CourtArea;
  count: number;
  wonCount: number;
}
