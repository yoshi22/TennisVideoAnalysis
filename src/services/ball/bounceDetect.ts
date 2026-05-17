import { type Bounce, type BallTrajectory } from '@/types/ball';
import { type CourtCalibration } from '@/types/court';
import { isInCourtBounds, projectImageToCourt } from '@/utils/court-geometry';

const SMOOTH_WINDOW = 3; // frames to smooth before derivative

function smooth(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(values.length - 1, i + window);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}

/**
 * Detects bounce events from a ball trajectory by finding sign reversals
 * in the vertical velocity component (courtY increases toward far baseline).
 * A bounce = local maximum in imageY (ball descends then ascends in image).
 */
export function detectBounces(
  trajectory: BallTrajectory,
  calibration?: CourtCalibration
): Bounce[] {
  const dets = trajectory.detections;
  if (dets.length < 5) return [];

  const rawY = dets.map((d) => d.imageY);
  const smoothY = smooth(rawY, SMOOTH_WINDOW);

  const bounces: Bounce[] = [];

  for (let i = 1; i < smoothY.length - 1; i++) {
    const isLocalMax = smoothY[i] > smoothY[i - 1] && smoothY[i] > smoothY[i + 1];
    if (!isLocalMax) continue;

    const det = dets[i];
    const imagePoint = { x: det.imageX, y: det.imageY };

    let courtPoint = imagePoint; // fallback when no calibration
    if (calibration) {
      try {
        courtPoint = projectImageToCourt(imagePoint, calibration);
      } catch {
        courtPoint = imagePoint;
      }
    }

    bounces.push({
      timeSec: det.timeSec,
      imagePoint,
      courtPoint,
      inBounds: isInCourtBounds(courtPoint, -0.02), // slight tolerance
    });
  }

  return bounces;
}
