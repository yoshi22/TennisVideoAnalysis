import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { useSessionStore } from '@/stores/sessionStore';
import { type RallyAnalysis, type TennisSession } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

function makeSession(): TennisSession {
  return {
    id: 'session-1',
    title: 'Rally analysis test',
    sessionType: 'match',
    matchFormat: 'singles',
    points: [],
    sport: 'tennis',
    startedAt: '2026-09-13T00:00:00.000Z',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  };
}

function makeAnalysis(): RallyAnalysis {
  return {
    id: 'analysis-1',
    createdAt: '2026-09-13T00:00:00.000Z',
    source: 'cloud',
    courtType: 'singles',
    playerSide: 'near',
    summary: { rallies: 1, shots: 2, bounces: 1 },
    rallies: [
      {
        rally: 1,
        startSec: 1,
        endSec: 3,
        shotCount: 2,
        shots: [
          { index: 1, stroke: 'serve', timeSec: 1, frameIdx: 10 },
          { index: 2, stroke: 'forehand', timeSec: 3, frameIdx: 40, location: { x: 0.7, y: 0.8 } },
        ],
        bounces: [],
        outcome: 'unknown',
        outcomeConfidence: 0.2,
        outcomeSource: 'auto',
      },
    ],
  };
}

describe('sessionStore rally analysis', () => {
  afterEach(() => useSessionStore.getState().clearAll());

  it('persists a rally analysis on the session', () => {
    useSessionStore.getState().addSession(makeSession());
    useSessionStore.getState().addRallyAnalysis('session-1', makeAnalysis());
    const s = useSessionStore.getState().sessions[0];
    expect(s.rallyAnalyses).toHaveLength(1);
    expect(s.rallyAnalyses?.[0].rallies[0].shotCount).toBe(2);
  });

  it('confirming won creates a confirmed auto PointRecord linked to the rally', () => {
    useSessionStore.getState().addSession(makeSession());
    useSessionStore.getState().addRallyAnalysis('session-1', makeAnalysis());
    useSessionStore.getState().confirmRallyOutcome('session-1', 'analysis-1', 1, 'won');

    const s = useSessionStore.getState().sessions[0];
    expect(s.points).toHaveLength(1);
    const p = s.points[0];
    expect(p.outcome).toBe('won');
    expect(p.source).toBe('auto');
    expect(p.reviewStatus).toBe('confirmed');
    expect(p.shotType).toBe('forehand'); // from last shot
    expect(p.rallyCount).toBe(2);
    const rally = s.rallyAnalyses![0].rallies[0];
    expect(rally.outcome).toBe('won');
    expect(rally.outcomeSource).toBe('confirmed');
    expect(rally.pointId).toBe(p.id);
  });

  it('re-confirming updates the same point (no duplicate)', () => {
    useSessionStore.getState().addSession(makeSession());
    useSessionStore.getState().addRallyAnalysis('session-1', makeAnalysis());
    useSessionStore.getState().confirmRallyOutcome('session-1', 'analysis-1', 1, 'won');
    useSessionStore.getState().confirmRallyOutcome('session-1', 'analysis-1', 1, 'lost');

    const s = useSessionStore.getState().sessions[0];
    expect(s.points).toHaveLength(1);
    expect(s.points[0].outcome).toBe('lost');
  });

  it('confirming unknown removes the linked point', () => {
    useSessionStore.getState().addSession(makeSession());
    useSessionStore.getState().addRallyAnalysis('session-1', makeAnalysis());
    useSessionStore.getState().confirmRallyOutcome('session-1', 'analysis-1', 1, 'won');
    useSessionStore.getState().confirmRallyOutcome('session-1', 'analysis-1', 1, 'unknown');

    const s = useSessionStore.getState().sessions[0];
    expect(s.points).toHaveLength(0);
    expect(s.rallyAnalyses![0].rallies[0].pointId).toBeUndefined();
  });
});
