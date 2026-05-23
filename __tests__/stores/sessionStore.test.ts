import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { useSessionStore } from '@/stores/sessionStore';
import { type TennisSession } from '@/types';
import { getPointDetailStatus } from '@/utils/pointDetails';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

function makeSession(): TennisSession {
  return {
    id: 'session-1',
    title: 'Store test',
    sessionType: 'match',
    matchFormat: 'singles',
    points: [],
    sport: 'tennis',
    startedAt: '2026-05-23T00:00:00.000Z',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
  };
}

describe('useSessionStore point updates', () => {
  afterEach(() => {
    useSessionStore.getState().clearAll();
  });

  it('updates a quick point into a complete point', () => {
    const session = makeSession();
    useSessionStore.getState().addSession(session);
    useSessionStore.getState().addPoint(session.id, {
      id: 'point-1',
      sessionId: session.id,
      timestamp: '2026-05-23T00:01:00.000Z',
      outcome: 'won',
      videoTimestamp: 12,
      detailStatus: 'quick',
    });

    let point = useSessionStore.getState().sessions[0].points[0];
    expect(getPointDetailStatus(point)).toBe('quick');

    useSessionStore.getState().updatePoint(session.id, 'point-1', {
      shotType: 'forehand',
      resultReason: 'winner',
      rallyCount: 4,
      detailStatus: 'complete',
    });

    point = useSessionStore.getState().sessions[0].points[0];
    expect(point.shotType).toBe('forehand');
    expect(point.resultReason).toBe('winner');
    expect(point.rallyCount).toBe(4);
    expect(getPointDetailStatus(point)).toBe('complete');
  });
});
