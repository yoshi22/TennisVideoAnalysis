import { applyHomography, computeHomographyDLT, invertMatrix3x3 } from '@/utils/homography';

const EPS = 1e-5;

function approxEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

describe('computeHomographyDLT', () => {
  it('identity mapping — unit square to itself', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const H = computeHomographyDLT(pts, pts);
    const test = { x: 0.3, y: 0.7 };
    const result = applyHomography(H, test);
    expect(approxEqual(result.x, test.x)).toBe(true);
    expect(approxEqual(result.y, test.y)).toBe(true);
  });

  it('trapezoid → unit square and back', () => {
    const src = [
      { x: 0.1, y: 0.8 },
      { x: 0.9, y: 0.75 },
      { x: 0.85, y: 0.15 },
      { x: 0.15, y: 0.2 },
    ];
    const dst = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ];
    const H = computeHomographyDLT(src, dst);
    // Verify each source point maps to its destination
    for (let i = 0; i < 4; i++) {
      const result = applyHomography(H, src[i]);
      expect(approxEqual(result.x, dst[i].x)).toBe(true);
      expect(approxEqual(result.y, dst[i].y)).toBe(true);
    }
  });

  it('throws on collinear points', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(() => computeHomographyDLT(collinear, dst)).toThrow();
  });
});

describe('invertMatrix3x3', () => {
  it('round-trip: H * H^-1 ≈ identity', () => {
    const src = [
      { x: 0.1, y: 0.8 },
      { x: 0.9, y: 0.75 },
      { x: 0.85, y: 0.15 },
      { x: 0.15, y: 0.2 },
    ];
    const dst = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ];
    const H = computeHomographyDLT(src, dst);
    const Hinv = invertMatrix3x3(H);

    const testPoint = { x: 0.4, y: 0.6 };
    const projected = applyHomography(H, testPoint);
    const recovered = applyHomography(Hinv, projected);
    expect(approxEqual(recovered.x, testPoint.x)).toBe(true);
    expect(approxEqual(recovered.y, testPoint.y)).toBe(true);
  });
});
