import { type CourtCalibration, type ImagePoint } from '@/types/court';

function cross2d(a: ImagePoint, b: ImagePoint, c: ImagePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Validates that the 4 image corners form a non-degenerate quadrilateral.
 * Returns null on success, or a Japanese error string describing the problem.
 */
export function validateCalibration(calibration: CourtCalibration): string | null {
  const [p0, p1, p2, p3] = calibration.imageCorners;

  // All 4 points must not be collinear — check each triangle
  const crossProducts = [
    cross2d(p0, p1, p2),
    cross2d(p1, p2, p3),
    cross2d(p2, p3, p0),
    cross2d(p3, p0, p1),
  ];

  for (const cp of crossProducts) {
    if (Math.abs(cp) < 1e-6) {
      return '4 点が一直線上にあるか重なっています。コーナーを正しくコートの四隅に配置してください。';
    }
  }

  // Diagonals must intersect (convex quadrilateral)
  // Use the sign of cross products: for a convex quad they must all be the same sign
  const signs = crossProducts.map((cp) => Math.sign(cp));
  if (signs[0] !== signs[1] || signs[1] !== signs[2] || signs[2] !== signs[3]) {
    return '四隅の配置が交差しています。near-left → near-right → far-right → far-left の順に設定してください。';
  }

  return null;
}
