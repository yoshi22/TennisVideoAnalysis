import { buildTrainingLabel, buildTrainingLabelJson } from '@/services/export/trainingLabel';
import { type TennisSession } from '@/types/session';

function makeSession(overrides: Partial<TennisSession> = {}): TennisSession {
  return {
    id: 'sess1',
    title: '練習/試合',
    sessionType: 'match',
    matchFormat: 'singles',
    points: [],
    sport: 'tennis',
    videoUri: 'file:///tmp/video.mp4',
    videoDurationSec: 60,
    startedAt: '2026-05-17T10:00:00.000Z',
    createdAt: '2026-05-17T10:00:00.000Z',
    updatedAt: '2026-05-17T10:00:00.000Z',
    ...overrides,
  } as TennisSession;
}

describe('buildTrainingLabel', () => {
  it('returns null when the session has no video', () => {
    expect(buildTrainingLabel(makeSession({ videoUri: undefined }))).toBeNull();
  });

  it('returns null when there are no valid rally intervals', () => {
    const session = makeSession({
      points: [
        {
          id: 'p1',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:01:00.000Z',
          outcome: 'won',
          videoTimestamp: 10,
          rallyStartSec: 12,
          rallyEndSec: 11,
        },
      ],
    });

    expect(buildTrainingLabel(session)).toBeNull();
  });

  it('exports eval-compatible ground-truth schema sorted by start time', () => {
    const session = makeSession({
      points: [
        {
          id: 'p2',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:02:00.000Z',
          outcome: 'lost',
          videoTimestamp: 31,
          rallyStartSec: 20.04,
          rallyEndSec: 30.96,
        },
        {
          id: 'p3',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:03:00.000Z',
          outcome: 'won',
          videoTimestamp: 12,
          rallyStartSec: 5,
          rallyEndSec: 12,
        },
      ],
    });

    expect(buildTrainingLabel(session)).toEqual({
      schemaVersion: 1,
      videoId: 'user-sess1',
      sourceUrl: 'file:///tmp/video.mp4',
      sourceSha256: '',
      fps: 30,
      clipOffsetSec: 0,
      clipDurationSec: 60,
      note: 'User-exported rally interval labels from session "練習/試合" recorded at 2026-05-17T10:00:00.000Z.',
      rallies: [
        { startSec: 5, endSec: 12, server: null, winner: null, endReason: null },
        { startSec: 20, endSec: 31, server: null, winner: null, endReason: null },
      ],
    });
  });

  it('falls back to max rally end when video duration is unknown', () => {
    const session = makeSession({
      videoDurationSec: undefined,
      points: [
        {
          id: 'p4',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:04:00.000Z',
          outcome: 'won',
          rallyStartSec: 8,
          rallyEndSec: 12.25,
        },
      ],
    });

    expect(buildTrainingLabel(session)?.clipDurationSec).toBe(12.3);
  });

  it('serializes null as null for unavailable rally attributes', () => {
    const session = makeSession({
      points: [
        {
          id: 'p5',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:05:00.000Z',
          outcome: 'won',
          rallyStartSec: 1,
          rallyEndSec: 3,
        },
      ],
    });
    const json = buildTrainingLabelJson(session);

    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toMatchObject({
      rallies: [{ server: null, winner: null, endReason: null }],
    });
  });
});
