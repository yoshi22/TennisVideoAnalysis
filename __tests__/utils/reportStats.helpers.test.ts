import { type PointRecord } from '@/types';
import { countLost, countWon, resultFromPoints } from '@/utils/reportStats';

function makePoint(id: string, outcome: 'won' | 'lost'): PointRecord {
  return {
    id,
    sessionId: 's1',
    outcome,
    timestamp: new Date().toISOString(),
  };
}

describe('reportStats helpers', () => {
  describe('countWon', () => {
    it('counts won points', () => {
      const points = [makePoint('p1', 'won'), makePoint('p2', 'lost'), makePoint('p3', 'won')];

      expect(countWon(points)).toBe(2);
    });
  });

  describe('countLost', () => {
    it('counts lost points', () => {
      const points = [makePoint('p1', 'lost'), makePoint('p2', 'won'), makePoint('p3', 'lost')];

      expect(countLost(points)).toBe(2);
    });
  });

  describe('resultFromPoints', () => {
    it('returns won when wins are greater than losses', () => {
      const points = [makePoint('p1', 'won'), makePoint('p2', 'lost'), makePoint('p3', 'won')];

      expect(resultFromPoints(points)).toBe('won');
    });

    it('returns lost when losses are greater than wins', () => {
      const points = [makePoint('p1', 'lost'), makePoint('p2', 'won'), makePoint('p3', 'lost')];

      expect(resultFromPoints(points)).toBe('lost');
    });

    it('returns null for ties', () => {
      const points = [makePoint('p1', 'won'), makePoint('p2', 'lost')];

      expect(resultFromPoints(points)).toBeNull();
    });

    it('returns null for empty points', () => {
      expect(resultFromPoints([])).toBeNull();
    });
  });
});
