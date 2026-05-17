import { computePeakSpeedKmh, computeSpeedSamples } from '@/services/ball/serveSpeed';
import { type BallTrajectory } from '@/types/ball';
import { type CourtCalibration } from '@/types/court';

// Identity homography (image coords == court coords)
const IDENTITY_HOMOGRAPHY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function makeCalibration(): CourtCalibration {
  return {
    imageCorners: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ],
    homography: IDENTITY_HOMOGRAPHY,
    referenceTimeSec: 0,
    createdAt: new Date().toISOString(),
  };
}

function makeTrajectory(detections: { timeSec: number; x: number; y: number }[]): BallTrajectory {
  return {
    detections: detections.map((d) => ({
      timeSec: d.timeSec,
      imageX: d.x,
      imageY: d.y,
      radiusPx: 4,
      confidence: 0.8,
    })),
  };
}

describe('computeSpeedSamples', () => {
  it('returns empty for fewer than 2 detections', () => {
    const traj = makeTrajectory([{ timeSec: 0, x: 0, y: 0 }]);
    expect(computeSpeedSamples(traj, makeCalibration())).toHaveLength(0);
  });

  it('returns empty for empty trajectory', () => {
    const traj = makeTrajectory([]);
    expect(computeSpeedSamples(traj, makeCalibration())).toHaveLength(0);
  });

  it('computes speed from two detections', () => {
    // Ball moves 1 court-width (8.23m) in 1 second → 8.23 m/s → 29.6 km/h
    const traj = makeTrajectory([
      { timeSec: 0, x: 0, y: 0 },
      { timeSec: 1, x: 1, y: 0 },
    ]);
    const samples = computeSpeedSamples(traj, makeCalibration());
    expect(samples).toHaveLength(1);
    // 1 court-width = 8.23m, 1s → 8.23 m/s × 3.6 = 29.628 km/h
    expect(samples[0].speedKmh).toBeCloseTo(29.628, 0);
  });

  it('computes speed from court length displacement', () => {
    // Ball moves 1 full court length (23.77m) in 1 second → 23.77 m/s → 85.57 km/h
    const traj = makeTrajectory([
      { timeSec: 0, x: 0, y: 0 },
      { timeSec: 1, x: 0, y: 1 },
    ]);
    const samples = computeSpeedSamples(traj, makeCalibration());
    expect(samples[0].speedKmh).toBeCloseTo(85.572, 0);
  });

  it('timestamps the sample at the midpoint', () => {
    const traj = makeTrajectory([
      { timeSec: 2, x: 0, y: 0 },
      { timeSec: 4, x: 1, y: 0 },
    ]);
    const samples = computeSpeedSamples(traj, makeCalibration());
    expect(samples[0].timeSec).toBeCloseTo(3, 5);
  });
});

describe('computePeakSpeedKmh', () => {
  it('returns null for empty trajectory', () => {
    expect(computePeakSpeedKmh(makeTrajectory([]), makeCalibration())).toBeNull();
  });

  it('returns the peak (maximum) speed across all intervals', () => {
    // First interval: slow (0.1 court-width/s), second: fast (1 court-width/s)
    const traj = makeTrajectory([
      { timeSec: 0, x: 0, y: 0 },
      { timeSec: 1, x: 0.1, y: 0 }, // slow
      { timeSec: 2, x: 1.1, y: 0 }, // fast (1 width/s)
    ]);
    const peak = computePeakSpeedKmh(traj, makeCalibration());
    expect(peak).toBeCloseTo(29.628, 0); // 1 court-width/s
  });

  it('discards implausible speeds (> 300 km/h)', () => {
    // Unrealistic displacement: 100 court-widths in 0.001s
    const traj = makeTrajectory([
      { timeSec: 0, x: 0, y: 0 },
      { timeSec: 0.001, x: 100, y: 0 },
    ]);
    expect(computePeakSpeedKmh(traj, makeCalibration())).toBeNull();
  });
});
