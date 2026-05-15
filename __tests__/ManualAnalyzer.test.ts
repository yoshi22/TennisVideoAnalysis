import { ManualAnalyzer } from '@/services/analysis/ManualAnalyzer';
import { type PointRecord, type TennisSession } from '@/types';

describe('ManualAnalyzer', () => {
  const analyzer = new ManualAnalyzer();

  const makeSession = (points: PointRecord[]): TennisSession => ({
    id: 'test-session',
    title: 'テストセッション',
    sport: 'tennis',
    sessionType: 'match',
    matchFormat: 'singles',
    points,
    startedAt: '2026-05-14T00:00:00.000Z',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
  });

  it('handles a session with no points', () => {
    const session = makeSession([]);

    expect(() => analyzer.analyze(session)).not.toThrow();

    const result = analyzer.analyze(session);

    expect(result.firstServeInRate).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.averageRallyCount).toBe(0);
  });

  it('calculates win rate correctly', () => {
    const points: PointRecord[] = [
      { id: '1', sessionId: 'test-session', timestamp: '2026-05-14T00:00:00.000Z', outcome: 'won', shotType: 'forehand', resultReason: 'winner', rallyCount: 3 },
      { id: '2', sessionId: 'test-session', timestamp: '2026-05-14T00:00:01.000Z', outcome: 'won', shotType: 'serve', resultReason: 'winner', rallyCount: 1, serveResult: 'ace' },
      { id: '3', sessionId: 'test-session', timestamp: '2026-05-14T00:00:02.000Z', outcome: 'lost', shotType: 'backhand', resultReason: 'unforcedError', rallyCount: 5 },
      { id: '4', sessionId: 'test-session', timestamp: '2026-05-14T00:00:03.000Z', outcome: 'lost', shotType: 'forehand', resultReason: 'net', rallyCount: 2 },
    ];
    const session = makeSession(points);
    const result = analyzer.analyze(session);

    expect(result.winRate).toBe(0.5);
  });

  it('calculates serve stats and average rally count', () => {
    const points: PointRecord[] = [
      { id: '1', sessionId: 'test-session', timestamp: '2026-05-14T00:00:00.000Z', outcome: 'won', shotType: 'serve', resultReason: 'winner', rallyCount: 1, serveResult: 'firstIn' },
      { id: '2', sessionId: 'test-session', timestamp: '2026-05-14T00:00:01.000Z', outcome: 'lost', shotType: 'serve', resultReason: 'unforcedError', rallyCount: 4, serveResult: 'secondIn' },
      { id: '3', sessionId: 'test-session', timestamp: '2026-05-14T00:00:02.000Z', outcome: 'won', shotType: 'forehand', resultReason: 'winner', rallyCount: 7 },
    ];
    const session = makeSession(points);
    const result = analyzer.analyze(session);

    expect(result.firstServeInRate).toBeGreaterThan(0);
    expect(result.averageRallyCount).toBeCloseTo((1 + 4 + 7) / 3, 5);
  });
});
