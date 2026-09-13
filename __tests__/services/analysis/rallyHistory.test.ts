import { type CloudAnalyzeResult } from '@/services/analysis/cloudAnalyze';
import { cloudResultToRallyAnalysis, inferRallyOutcome } from '@/services/analysis/rallyHistory';
import { type RallyBounceRecord } from '@/types';

function bounce(y: number, inBounds: boolean): RallyBounceRecord {
  return { timeSec: 0, courtXY: [4, y], inBounds };
}

describe('inferRallyOutcome', () => {
  it('in-bounds on opponent (far) side → player(near) won', () => {
    expect(inferRallyOutcome([bounce(20, true)], 'near')).toEqual({
      outcome: 'won',
      confidence: 0.45,
    });
  });
  it('in-bounds on player(near) side → lost', () => {
    expect(inferRallyOutcome([bounce(3, true)], 'near')).toEqual({
      outcome: 'lost',
      confidence: 0.4,
    });
  });
  it('out of bounds → unknown (low confidence)', () => {
    expect(inferRallyOutcome([bounce(20, false)], 'near').outcome).toBe('unknown');
  });
  it('no bounces → unknown, zero confidence', () => {
    expect(inferRallyOutcome([], 'near')).toEqual({ outcome: 'unknown', confidence: 0 });
  });
});

function makeResult(): CloudAnalyzeResult {
  return {
    clip_id: 'c1',
    status: 'ok',
    court_type: 'singles',
    summary: { p95SpeedKmh: 120, medianSpeedKmh: 40 },
    events: {
      summary: {},
      shots: [],
      rallies: [
        {
          rally: 1,
          n_points: 10,
          p95_kmh: 120,
          median_kmh: 40,
          contacts: [
            { type: 'contact', rally: 1, frameIdx: 10, timeSec: 1.0, court_xy_m: [2, 3] },
            {
              type: 'contact',
              rally: 1,
              frameIdx: 40,
              timeSec: 2.5,
              court_xy_m: [6, 20],
              zone: {
                side: 'ad',
                depth: 'deep',
                half: 'far',
                label: 'far_ad_deep',
                in_bounds: true,
              },
              speed_kmh: 90,
            },
          ],
          bounces: [
            {
              type: 'bounce',
              rally: 1,
              frameIdx: 45,
              timeSec: 2.7,
              court_xy_m: [6, 21],
              zone: {
                side: 'ad',
                depth: 'deep',
                half: 'far',
                label: 'far_ad_deep',
                in_bounds: true,
              },
            },
          ],
        },
      ],
    },
    strokes: {
      summary: { counts: { forehand: 1 } },
      contacts: [{ rally: 1, frameIdx: 40, timeSec: 2.5, stroke: 'forehand' }],
    },
  };
}

describe('cloudResultToRallyAnalysis', () => {
  it('builds rally records with shots, bounces, normalized locations, and heuristic outcome', () => {
    const a = cloudResultToRallyAnalysis(makeResult(), {
      playerSide: 'near',
      idFactory: () => 'a1',
      now: '2026-09-13T00:00:00.000Z',
    });
    expect(a.id).toBe('a1');
    expect(a.courtType).toBe('singles');
    expect(a.rallies).toHaveLength(1);
    const r = a.rallies[0];
    expect(r.shotCount).toBe(2);
    // first shot defaults to serve, second uses joined stroke
    expect(r.shots[0].stroke).toBe('serve');
    expect(r.shots[1].stroke).toBe('forehand');
    // normalized location within [0,1]
    expect(r.shots[1].location?.x).toBeCloseTo(6 / 8.23, 3);
    expect(r.shots[1].location?.y).toBeCloseTo(20 / 23.77, 3);
    // last bounce in-bounds on far side, player near → won (auto)
    expect(r.outcome).toBe('won');
    expect(r.outcomeSource).toBe('auto');
    expect(a.summary.shots).toBe(2);
    expect(a.summary.bounces).toBe(1);
  });

  it('returns empty rallies when events missing', () => {
    const a = cloudResultToRallyAnalysis({ clip_id: 'x', status: 'ok', events: null });
    expect(a.rallies).toEqual([]);
  });
});
