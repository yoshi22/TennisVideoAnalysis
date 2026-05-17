import { type Bounce, type BallTrajectory } from '@/types/ball';
import { type CourtCalibration } from '@/types/court';

import { detectBounces } from './bounceDetect';
import { detectBlobs } from './blobDetect';
import { decodeFrameGray } from './decodeFrame';
import { computeMotionMask } from './frameDiff';
import { computePeakSpeedKmh } from './serveSpeed';
import { trackBall } from './tracker';
import { sampleFrames } from '../pose/frameSampler';

export type { RallyWindow, DetectRallyWindowsOptions } from './autoSegment';
export { detectRallyWindows, analyzeRallyBatch } from './autoSegment';
export { computeSpeedSamples, computePeakSpeedKmh } from './serveSpeed';
export type { SpeedSample } from './serveSpeed';

export interface AnalyzeRallyOptions {
  videoUri: string;
  startSec: number;
  endSec: number;
  calibration?: CourtCalibration;
  onProgress?: (progress: number) => void;
}

export interface RallyAnalysis {
  trajectory: BallTrajectory;
  bounces: Bounce[];
  /** Peak ball speed in km/h estimated from ball displacement + court homography.
   *  null when calibration is absent or too few detections. */
  peakSpeedKmh: number | null;
}

/**
 * Analyzes a rally clip for ball trajectory and bounce events.
 * Sampling at ~15 fps. Progress reported 0→1.
 */
export async function analyzeRally(opts: AnalyzeRallyOptions): Promise<RallyAnalysis> {
  const { videoUri, startSec, endSec, calibration, onProgress } = opts;

  const duration = Math.max(endSec - startSec, 0.5);
  const fps = 15;
  const count = Math.round(duration * fps);

  const sampledFrames = await sampleFrames(videoUri, startSec, endSec, count);
  onProgress?.(0.2);

  // Decode all frames to grayscale
  const decoded = await Promise.all(sampledFrames.map((f) => decodeFrameGray(f.uri)));
  onProgress?.(0.5);

  // Compute motion masks and detect blobs (skip first and last — need neighbors)
  const frameInputs: { timeSec: number; candidates: ReturnType<typeof detectBlobs> }[] = [];
  for (let i = 1; i < decoded.length - 1; i++) {
    const mask = computeMotionMask(decoded[i - 1], decoded[i], decoded[i + 1]);
    const candidates = detectBlobs(mask, decoded[i].width, decoded[i].height);
    frameInputs.push({ timeSec: sampledFrames[i].timeSec, candidates });
    if (i % 10 === 0) onProgress?.(0.5 + (i / decoded.length) * 0.3);
  }
  onProgress?.(0.8);

  const trajectory = trackBall(frameInputs);
  const bounces = detectBounces(trajectory, calibration);
  const peakSpeedKmh = calibration ? computePeakSpeedKmh(trajectory, calibration) : null;
  onProgress?.(1.0);

  return { trajectory, bounces, peakSpeedKmh };
}
