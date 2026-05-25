import { type PointRecord } from '@/types';
import { computeCumulativeScores } from '@/utils/cumulativeScore';

function makePoint(id: string, outcome: 'won' | 'lost'): PointRecord {
  return {
    id,
    sessionId: 's1',
    outcome,
    rallyCount: 1,
    timestamp: new Date().toISOString(),
  };
}

describe('computeCumulativeScores', () => {
  it('returns empty map for empty array', () => {
    expect(computeCumulativeScores([])).toEqual(new Map());
  });

  it('accumulates w and l correctly', () => {
    const points = [makePoint('p1', 'won'), makePoint('p2', 'lost'), makePoint('p3', 'won')];
    const scores = computeCumulativeScores(points);
    expect(scores.get('p1')).toEqual({ w: 1, l: 0 });
    expect(scores.get('p2')).toEqual({ w: 1, l: 1 });
    expect(scores.get('p3')).toEqual({ w: 2, l: 1 });
  });

  it('each point id has an entry', () => {
    const points = [makePoint('a', 'won'), makePoint('b', 'won'), makePoint('c', 'lost')];
    const scores = computeCumulativeScores(points);
    expect(scores.size).toBe(3);
    expect(scores.has('a')).toBe(true);
    expect(scores.has('b')).toBe(true);
    expect(scores.has('c')).toBe(true);
  });

  it('all losses', () => {
    const points = [makePoint('p1', 'lost'), makePoint('p2', 'lost')];
    const scores = computeCumulativeScores(points);
    expect(scores.get('p1')).toEqual({ w: 0, l: 1 });
    expect(scores.get('p2')).toEqual({ w: 0, l: 2 });
  });
});
