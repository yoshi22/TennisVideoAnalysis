import { buildDraftPointFromCandidate } from '@/services/scoring';
import { type AutoPointCandidate } from '@/types';

describe('buildDraftPointFromCandidate', () => {
  it('preserves rally interval metadata', () => {
    const candidate: AutoPointCandidate = {
      id: 'c1',
      suggestedOutcome: 'won',
      suggestedShotType: 'forehand',
      suggestedResultReason: 'winner',
      suggestedRallyCount: 6,
      videoTimestamp: 18,
      rallyStartSec: 10,
      rallyEndSec: 18,
      diagnostics: [],
      confidence: 0.82,
    };

    expect(
      buildDraftPointFromCandidate('sess1', candidate, 'p1', '2026-05-17T10:00:00.000Z')
    ).toMatchObject({
      id: 'p1',
      sessionId: 'sess1',
      source: 'auto',
      reviewStatus: 'draft',
      rallyStartSec: 10,
      rallyEndSec: 18,
      videoTimestamp: 18,
    });
  });
});
