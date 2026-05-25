import { SHOT_TYPE_META, SHOT_TYPES } from '@/constants/shotTypes';
import { type ShotLocation, type ShotType, type TennisSession } from '@/types';
import { isConfirmed, isPointComplete } from '@/utils/pointDetails';

export interface ShotBreakdownItem {
  shotType: ShotType;
  label: string;
  total: number;
  wonCount: number;
  lostCount: number;
}

export const REPORT_CHART_COLORS = [
  '#1F6F4A',
  '#3FB37B',
  '#7AC4A0',
  '#F29F3E',
  '#E86060',
  '#94A3B8',
] as const;

export function hasLocation(loc: ShotLocation | undefined): loc is ShotLocation {
  return loc !== undefined;
}

export function calculateShotBreakdown(session: TennisSession): ShotBreakdownItem[] {
  const confirmedPoints = session.points.filter(isConfirmed);
  return SHOT_TYPES.map((shotType) => {
    const pts = confirmedPoints.filter((p) => p.shotType === shotType);
    return {
      shotType,
      label: SHOT_TYPE_META[shotType].label,
      total: pts.length,
      wonCount: pts.filter((p) => p.outcome === 'won').length,
      lostCount: pts.filter((p) => p.outcome === 'lost').length,
    };
  });
}

export interface ReportStats {
  wonCount: number;
  lostCount: number;
  totalPoints: number;
  confirmedCount: number;
  completePointCount: number;
  quickPointCount: number;
  draftCount: number;
  shotBreakdown: ShotBreakdownItem[];
  locations: ShotLocation[];
}

export function computeReportStats(session: TennisSession): ReportStats {
  const confirmedPoints = session.points.filter(isConfirmed);
  const completePoints = confirmedPoints.filter(isPointComplete);
  const draftCount = session.points.filter((p) => !isConfirmed(p)).length;

  return {
    wonCount: confirmedPoints.filter((p) => p.outcome === 'won').length,
    lostCount: confirmedPoints.filter((p) => p.outcome === 'lost').length,
    totalPoints: session.points.length,
    confirmedCount: confirmedPoints.length,
    completePointCount: completePoints.length,
    quickPointCount: confirmedPoints.length - completePoints.length,
    draftCount,
    shotBreakdown: calculateShotBreakdown(session),
    locations: session.points.map((p) => p.shotLocation).filter(hasLocation),
  };
}
