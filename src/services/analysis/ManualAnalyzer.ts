import {
  type PointRecord,
  type ShotType,
  type TennisAnalysisResult,
  type TennisSession,
  type WeaknessPattern,
} from '@/types';

import { generateCoachingTips } from './CoachingTipsGenerator';
import { generatePracticeMenu } from './PracticeMenuGenerator';
import { type RallyStats, type ServeStats, type ShotBreakdown } from './types';
import { type TennisAnalyzer } from './TennisAnalyzer';

const shotTypes: ShotType[] = ['serve', 'forehand', 'backhand', 'volley', 'smash', 'lob', 'drop'];

function divideOrZero(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function calculateServeStats(points: PointRecord[]): ServeStats {
  return points.reduce<ServeStats>(
    (stats, point) => {
      if (point.serveResult === undefined) {
        return stats;
      }

      stats.totalServes += 1;
      stats.firstServeAttempts += 1;

      if (
        point.serveResult === 'firstIn' ||
        point.serveResult === 'ace' ||
        point.serveResult === 'returnError'
      ) {
        stats.firstServeIn += 1;
      }

      if (point.serveResult === 'secondIn') {
        stats.secondServeIn += 1;
      }

      if (point.serveResult === 'doubleFault') {
        stats.doubleFaults += 1;
      }

      if (point.serveResult === 'ace') {
        stats.aces += 1;
      }

      if (point.serveResult === 'returnError') {
        stats.returnErrors += 1;
      }

      return stats;
    },
    {
      totalServes: 0,
      firstServeAttempts: 0,
      firstServeIn: 0,
      secondServeIn: 0,
      doubleFaults: 0,
      aces: 0,
      returnErrors: 0,
    }
  );
}

function calculateRallyStats(points: PointRecord[]): RallyStats {
  const totalPoints = points.length;
  const rallyTotal = points.reduce((sum, point) => sum + point.rallyCount, 0);

  return {
    totalPoints,
    averageRallyCount: divideOrZero(rallyTotal, totalPoints),
    shortRallyCount: points.filter((point) => point.rallyCount <= 3).length,
    longRallyCount: points.filter((point) => point.rallyCount >= 7).length,
  };
}

function calculateShotBreakdowns(points: PointRecord[]): ShotBreakdown[] {
  return shotTypes.map((shotType) => {
    const shotPoints = points.filter((point) => point.shotType === shotType);

    return {
      shotType,
      total: shotPoints.length,
      wonCount: shotPoints.filter((point) => point.outcome === 'won').length,
      lostCount: shotPoints.filter((point) => point.outcome === 'lost').length,
    };
  });
}

function findShotBreakdown(breakdowns: ShotBreakdown[], shotType: ShotType): ShotBreakdown {
  const breakdown = breakdowns.find((item) => item.shotType === shotType);

  if (breakdown !== undefined) {
    return breakdown;
  }

  return {
    shotType,
    total: 0,
    wonCount: 0,
    lostCount: 0,
  };
}

function detectWeaknesses(
  points: PointRecord[],
  serveStats: ServeStats,
  rallyStats: RallyStats,
  shotBreakdowns: ShotBreakdown[],
  firstServeInRate: number
): WeaknessPattern[] {
  const totalPoints = points.length;
  const backhand = findShotBreakdown(shotBreakdowns, 'backhand');
  const volley = findShotBreakdown(shotBreakdowns, 'volley');
  const smash = findShotBreakdown(shotBreakdowns, 'smash');
  const unforcedErrorCount = points.filter(
    (point) => point.resultReason === 'unforcedError'
  ).length;
  const weaknesses: WeaknessPattern[] = [];

  if (serveStats.doubleFaults >= 2) {
    weaknesses.push('highDoubleFault');
  }

  if (firstServeInRate < 0.55 && serveStats.totalServes >= 4) {
    weaknesses.push('lowFirstServeIn');
  }

  if (rallyStats.averageRallyCount < 3 && totalPoints >= 5) {
    weaknesses.push('shortRally');
  }

  if (divideOrZero(backhand.lostCount, backhand.total) >= 0.6 && backhand.total >= 3) {
    weaknesses.push('weakBackhand');
  }

  if (divideOrZero(volley.lostCount, volley.total) >= 0.5 && volley.total >= 2) {
    weaknesses.push('weakVolley');
  }

  if (divideOrZero(unforcedErrorCount, totalPoints) >= 0.3 && totalPoints >= 5) {
    weaknesses.push('frequentUnforcedError');
  }

  if (volley.total + smash.total < 2 && totalPoints >= 8) {
    weaknesses.push('poorNetApproach');
  }

  return weaknesses;
}

function generateStrengths(
  firstServeInRate: number,
  aceCount: number,
  winRate: number,
  averageRallyCount: number
): string[] {
  const strengths: string[] = [];

  if (firstServeInRate >= 0.7) {
    strengths.push('ファーストサーブの成功率が高い');
  }

  if (aceCount >= 2) {
    strengths.push('エースを多く獲得している');
  }

  if (winRate >= 0.65) {
    strengths.push('得点率が高い');
  }

  if (averageRallyCount >= 5) {
    strengths.push('ラリーを長く続けられている');
  }

  return strengths.slice(0, 3);
}

export class ManualAnalyzer implements TennisAnalyzer {
  analyze(session: TennisSession): TennisAnalysisResult {
    // ソフトテニス固有の前衛/後衛コーチング（positionベースのTips）はPhase 4以降で実装予定
    const points = session.points;
    const serveStats = calculateServeStats(points);
    const rallyStats = calculateRallyStats(points);
    const shotBreakdowns = calculateShotBreakdowns(points);
    const wonCount = points.filter((point) => point.outcome === 'won').length;

    const firstServeInRate = divideOrZero(serveStats.firstServeIn, serveStats.totalServes);
    const secondServeDenominator = serveStats.secondServeIn + serveStats.doubleFaults;
    const secondServeInRate = divideOrZero(serveStats.secondServeIn, secondServeDenominator);
    const winRate = divideOrZero(wonCount, points.length);

    const weaknesses = detectWeaknesses(
      points,
      serveStats,
      rallyStats,
      shotBreakdowns,
      firstServeInRate
    );

    return {
      sessionId: session.id,
      analyzedAt: new Date().toISOString(),
      firstServeInRate,
      secondServeInRate,
      doubleFaultCount: serveStats.doubleFaults,
      aceCount: serveStats.aces,
      winRate,
      averageRallyCount: rallyStats.averageRallyCount,
      weaknesses,
      tips: generateCoachingTips(weaknesses),
      drills: generatePracticeMenu(weaknesses),
      strengths: generateStrengths(
        firstServeInRate,
        serveStats.aces,
        winRate,
        rallyStats.averageRallyCount
      ),
    };
  }
}
