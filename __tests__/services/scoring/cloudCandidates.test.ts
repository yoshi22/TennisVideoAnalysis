import { type CloudAnalyzeResult } from '@/services/analysis/cloudAnalyze';
import { cloudResultToCandidates } from '@/services/scoring/cloudCandidates';

function makeResult(): CloudAnalyzeResult {
  return {
    clip_id: 'clip1',
    status: 'ok',
    events: {
      summary: {},
      shots: [],
      rallies: [
        {
          rally: 1,
          n_points: 100,
          bounces: [],
          p95_kmh: 120,
          median_kmh: 40,
          contacts: [
            { type: 'contact', rally: 1, frameIdx: 10, timeSec: 1.0 },
            {
              type: 'contact',
              rally: 1,
              frameIdx: 40,
              timeSec: 2.5,
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
        // Rally with no contacts is skipped.
        { rally: 2, n_points: 5, bounces: [], contacts: [] },
      ],
    },
    strokes: {
      summary: { counts: { forehand: 1, backhand: 1 } },
      contacts: [
        { rally: 1, frameIdx: 10, timeSec: 1.0, stroke: 'backhand' },
        { rally: 1, frameIdx: 40, timeSec: 2.5, stroke: 'backhand' },
      ],
    },
  };
}

describe('cloudResultToCandidates', () => {
  it('maps one candidate per rally with contacts', () => {
    let n = 0;
    const candidates = cloudResultToCandidates(makeResult(), { idFactory: () => `id-${(n += 1)}` });
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c.suggestedRallyCount).toBe(2);
    expect(c.rallyStartSec).toBe(1.0);
    expect(c.rallyEndSec).toBe(2.5);
    expect(c.videoTimestamp).toBe(2.5);
  });

  it('picks dominant stroke type (backhand-heavy → backhand)', () => {
    const candidates = cloudResultToCandidates(makeResult());
    expect(candidates[0].suggestedShotType).toBe('backhand');
  });

  it('defaults outcome/reason to placeholders for user review', () => {
    const candidates = cloudResultToCandidates(makeResult());
    expect(candidates[0].suggestedOutcome).toBe('won');
    expect(candidates[0].suggestedResultReason).toBe('winner');
    expect(candidates[0].diagnostics.some((d) => d.includes('自動判定不可'))).toBe(true);
  });

  it('returns empty array when events missing', () => {
    expect(cloudResultToCandidates({ clip_id: 'x', status: 'ok', events: null })).toEqual([]);
  });
});
