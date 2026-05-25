import { type PointRecord, type TennisSession } from '@/types';
import { calculateShotBreakdown, computeReportStats, hasLocation } from '@/utils/reportStats';

function makePoint(overrides: Partial<PointRecord> = {}): PointRecord {
  return {
    id: 'p1',
    sessionId: 's1',
    outcome: 'won',
    rallyCount: 3,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(points: PointRecord[]): TennisSession {
  return {
    id: 's1',
    title: 'Test Session',
    sport: 'tennis',
    matchFormat: 'singles',
    sessionType: 'match',
    points,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  } as TennisSession;
}

describe('hasLocation', () => {
  it('returns true for defined location', () => {
    expect(hasLocation({ x: 0.5, y: 0.5 })).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(hasLocation(undefined)).toBe(false);
  });
});

describe('calculateShotBreakdown', () => {
  it('excludes draft points', () => {
    const session = makeSession([
      makePoint({ shotType: 'forehand', outcome: 'won' }),
      makePoint({ id: 'p2', shotType: 'forehand', outcome: 'won', reviewStatus: 'draft' }),
    ]);
    const result = calculateShotBreakdown(session);
    const fh = result.find((r) => r.shotType === 'forehand')!;
    expect(fh.total).toBe(1);
    expect(fh.wonCount).toBe(1);
  });

  it('counts won/lost correctly for confirmed points', () => {
    const session = makeSession([
      makePoint({ shotType: 'backhand', outcome: 'won' }),
      makePoint({ id: 'p2', shotType: 'backhand', outcome: 'lost' }),
      makePoint({ id: 'p3', shotType: 'backhand', outcome: 'lost' }),
    ]);
    const result = calculateShotBreakdown(session);
    const bh = result.find((r) => r.shotType === 'backhand')!;
    expect(bh.total).toBe(3);
    expect(bh.wonCount).toBe(1);
    expect(bh.lostCount).toBe(2);
  });

  it('includes label from SHOT_TYPE_META', () => {
    const session = makeSession([makePoint({ shotType: 'serve', outcome: 'won' })]);
    const result = calculateShotBreakdown(session);
    const serve = result.find((r) => r.shotType === 'serve')!;
    expect(typeof serve.label).toBe('string');
    expect(serve.label.length).toBeGreaterThan(0);
  });
});

describe('computeReportStats', () => {
  it('wonCount and lostCount exclude draft points', () => {
    const session = makeSession([
      makePoint({ outcome: 'won' }),
      makePoint({ id: 'p2', outcome: 'won', reviewStatus: 'draft' }),
      makePoint({ id: 'p3', outcome: 'lost' }),
    ]);
    const stats = computeReportStats(session);
    expect(stats.wonCount).toBe(1);
    expect(stats.lostCount).toBe(1);
  });

  it('totalPoints counts all points including drafts', () => {
    const session = makeSession([
      makePoint({ outcome: 'won' }),
      makePoint({ id: 'p2', outcome: 'won', reviewStatus: 'draft' }),
    ]);
    const stats = computeReportStats(session);
    expect(stats.totalPoints).toBe(2);
  });

  it('draftCount returns correct count', () => {
    const session = makeSession([
      makePoint({ outcome: 'won' }),
      makePoint({ id: 'p2', outcome: 'won', reviewStatus: 'draft' }),
      makePoint({ id: 'p3', outcome: 'won', reviewStatus: 'draft' }),
    ]);
    const stats = computeReportStats(session);
    expect(stats.draftCount).toBe(2);
  });

  it('completePointCount counts confirmed complete points only', () => {
    const session = makeSession([
      makePoint({ shotType: 'forehand', resultReason: 'winner', rallyCount: 3 }),
      makePoint({
        id: 'p2',
        shotType: 'forehand',
        resultReason: 'winner',
        rallyCount: 3,
        reviewStatus: 'draft',
      }),
      makePoint({ id: 'p3', outcome: 'won' }),
    ]);
    const stats = computeReportStats(session);
    expect(stats.completePointCount).toBe(1);
  });

  it('locations collects all shotLocations regardless of reviewStatus', () => {
    const session = makeSession([
      makePoint({ shotLocation: { x: 0.3, y: 0.4 } }),
      makePoint({ id: 'p2', shotLocation: { x: 0.6, y: 0.7 }, reviewStatus: 'draft' }),
      makePoint({ id: 'p3' }),
    ]);
    const stats = computeReportStats(session);
    expect(stats.locations).toHaveLength(2);
  });
});
