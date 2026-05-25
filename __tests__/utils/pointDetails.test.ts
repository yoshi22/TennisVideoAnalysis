import { type PointRecord } from '@/types';
import { getConfirmedPoints, isConfirmed, isPointComplete } from '@/utils/pointDetails';

function makePoint(overrides: Partial<PointRecord> = {}): PointRecord {
  return {
    id: 'p1',
    sessionId: 's1',
    outcome: 'won',
    rallyCount: 3,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('isConfirmed', () => {
  it('returns true when reviewStatus is undefined', () => {
    expect(isConfirmed(makePoint())).toBe(true);
  });

  it('returns true when reviewStatus is confirmed', () => {
    expect(isConfirmed(makePoint({ reviewStatus: 'confirmed' }))).toBe(true);
  });

  it('returns false when reviewStatus is draft', () => {
    expect(isConfirmed(makePoint({ reviewStatus: 'draft' }))).toBe(false);
  });
});

describe('getConfirmedPoints', () => {
  it('filters out draft points', () => {
    const points = [
      makePoint({ id: 'p1' }),
      makePoint({ id: 'p2', reviewStatus: 'draft' }),
      makePoint({ id: 'p3', reviewStatus: 'confirmed' }),
    ];
    const result = getConfirmedPoints(points);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('returns all points when none are draft', () => {
    const points = [makePoint({ id: 'p1' }), makePoint({ id: 'p2', reviewStatus: 'confirmed' })];
    expect(getConfirmedPoints(points)).toHaveLength(2);
  });
});

describe('isPointComplete', () => {
  it('returns true when all detail fields are present', () => {
    expect(
      isPointComplete(makePoint({ shotType: 'forehand', resultReason: 'winner', rallyCount: 3 }))
    ).toBe(true);
  });

  it('returns false when shotType is missing', () => {
    expect(isPointComplete(makePoint({ resultReason: 'winner', rallyCount: 3 }))).toBe(false);
  });
});
