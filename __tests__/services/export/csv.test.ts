import { buildPointsCSV } from '@/services/export/csv';
import { type TennisSession } from '@/types/session';

function makeSession(overrides: Partial<TennisSession> = {}): TennisSession {
  return {
    id: 'sess1',
    title: 'テスト',
    sessionType: 'match',
    matchFormat: 'singles',
    points: [],
    sport: 'tennis',
    startedAt: '2026-05-17T10:00:00.000Z',
    createdAt: '2026-05-17T10:00:00.000Z',
    updatedAt: '2026-05-17T10:00:00.000Z',
    ...overrides,
  } as TennisSession;
}

describe('buildPointsCSV', () => {
  it('returns BOM + header line for empty session', () => {
    const csv = buildPointsCSV(makeSession());
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[0]).toContain('timestamp');
    expect(lines[0]).toContain('outcome');
    expect(lines[0]).toContain('shotType');
    expect(lines[0]).toContain('videoTimestamp');
    expect(lines.length).toBe(1); // header only (no data rows)
  });

  it('includes one data row per point', () => {
    const session = makeSession({
      points: [
        {
          id: 'p1',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:01:00.000Z',
          outcome: 'won',
          shotType: 'serve',
          resultReason: 'winner',
          rallyCount: 1,
          videoTimestamp: 12.5,
        },
      ],
    });
    const csv = buildPointsCSV(session);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('won');
    expect(lines[1]).toContain('serve');
    expect(lines[1]).toContain('12.5');
  });

  it('escapes fields with commas by wrapping in quotes', () => {
    const session = makeSession({
      points: [
        {
          id: 'p2',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:02:00.000Z',
          outcome: 'lost',
          shotType: 'forehand',
          resultReason: 'unforcedError',
          rallyCount: 3,
          note: 'net cord, unfortunate',
        },
      ],
    });
    const csv = buildPointsCSV(session);
    expect(csv).toContain('"net cord, unfortunate"');
  });

  it('handles all optional fields being absent', () => {
    const session = makeSession({
      points: [
        {
          id: 'p3',
          sessionId: 'sess1',
          timestamp: '2026-05-17T10:03:00.000Z',
          outcome: 'won',
          shotType: 'backhand',
          resultReason: 'winner',
          rallyCount: 5,
        },
      ],
    });
    const csv = buildPointsCSV(session);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines.length).toBe(2);
    // Optional fields should be empty
    const fields = lines[1].split(',');
    expect(fields[5]).toBe(''); // serveResult
    expect(fields[6]).toBe(''); // shotLocationX
  });
});
