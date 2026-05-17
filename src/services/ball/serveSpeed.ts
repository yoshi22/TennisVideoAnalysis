import { type BallDetection, type BallTrajectory } from '@/types/ball';
import { type CourtCalibration } from '@/types/court';
import { projectImageToCourt } from '@/utils/court-geometry';

// ITF standard singles court: 23.77m long × 8.23m wide
const COURT_LENGTH_M = 23.77;
const COURT_WIDTH_M = 8.23;

export interface SpeedSample {
  timeSec: number;
  speedKmh: number;
}

/**
 * Computes ball speed for each consecutive detection pair.
 * Requires calibration to convert normalized image coords → real distances.
 * Returns an empty array when fewer than 2 detections are available or calibration is absent.
 */
export function computeSpeedSamples(
  trajectory: BallTrajectory,
  calibration: CourtCalibration
): SpeedSample[] {
  const { detections } = trajectory;
  if (detections.length < 2) return [];

  const samples: SpeedSample[] = [];

  for (let i = 0; i < detections.length - 1; i++) {
    const a: BallDetection = detections[i];
    const b: BallDetection = detections[i + 1];
    const dt = b.timeSec - a.timeSec;
    if (dt <= 0) continue;

    const ca = projectImageToCourt({ x: a.imageX, y: a.imageY }, calibration);
    const cb = projectImageToCourt({ x: b.imageX, y: b.imageY }, calibration);

    const dx = (cb.x - ca.x) * COURT_WIDTH_M;
    const dy = (cb.y - ca.y) * COURT_LENGTH_M;
    const distanceM = Math.sqrt(dx * dx + dy * dy);

    const speedMs = distanceM / dt;
    samples.push({ timeSec: (a.timeSec + b.timeSec) / 2, speedKmh: speedMs * 3.6 });
  }

  return samples;
}

/**
 * Returns the peak speed (km/h) observed in the trajectory, or null if unavailable.
 * The first high-speed segment corresponds to the serve or earliest stroke.
 */
export function computePeakSpeedKmh(
  trajectory: BallTrajectory,
  calibration: CourtCalibration
): number | null {
  const samples = computeSpeedSamples(trajectory, calibration);
  if (samples.length === 0) return null;

  let peak = 0;
  for (const s of samples) {
    if (s.speedKmh > peak) peak = s.speedKmh;
  }

  // Sanity-check: real tennis serves top out around 263 km/h (world record).
  // Anything above 300 km/h is a measurement artifact — discard.
  return peak < 300 ? peak : null;
}
