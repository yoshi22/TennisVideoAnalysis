import { sampleFrames } from '@/services/pose/frameSampler';

import { detectBlobs } from './blobDetect';
import { decodeFrameGray } from './decodeFrame';
import { computeMotionMask } from './frameDiff';
import { analyzeRally, type AnalyzeRallyOptions, type RallyAnalysis } from './index';

export interface RallyWindow {
  startSec: number;
  endSec: number;
  /** 0..1 estimate of detection confidence for this window */
  confidence: number;
}

export interface DetectRallyWindowsOptions {
  videoUri: string;
  videoDurationSec: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Scan FPS (default: 3) */
  scanFps?: number;
  /** Minimum rally duration in seconds (default: 2) */
  minDurationSec?: number;
  /** Maximum rally duration in seconds (default: 30) */
  maxDurationSec?: number;
  /** Max gap between detections to treat as same rally in seconds (default: 0.5) */
  gapToleranceSec?: number;
}

/**
 * Scans the full video at low fps and identifies time windows where ball candidates exist.
 * Returns merged rally windows sorted chronologically.
 */
export async function detectRallyWindows(opts: DetectRallyWindowsOptions): Promise<RallyWindow[]> {
  const {
    videoUri,
    videoDurationSec,
    signal,
    onProgress,
    scanFps = 3,
    minDurationSec = 2,
    maxDurationSec = 30,
    gapToleranceSec = 0.5,
  } = opts;

  if (videoDurationSec <= 0) {
    return [];
  }

  const totalFrames = Math.max(Math.round(videoDurationSec * scanFps), 2);
  const sampledFrames = await sampleFrames(videoUri, 0, videoDurationSec, totalFrames);
  onProgress?.(0.3);

  if (signal?.aborted) return [];

  const ballPresentAt: number[] = [];

  for (let i = 1; i < sampledFrames.length - 1; i++) {
    if (signal?.aborted) break;

    try {
      const [prev, curr, next] = await Promise.all([
        decodeFrameGray(sampledFrames[i - 1].uri),
        decodeFrameGray(sampledFrames[i].uri),
        decodeFrameGray(sampledFrames[i + 1].uri),
      ]);
      const mask = computeMotionMask(prev, curr, next);
      const blobs = detectBlobs(mask, curr.width, curr.height);

      if (blobs.length > 0) {
        ballPresentAt.push(sampledFrames[i].timeSec);
      }
    } catch {
      // Skip undecodable frames
    }

    onProgress?.(0.3 + (i / sampledFrames.length) * 0.6);
  }

  onProgress?.(0.9);

  // Merge detections into windows
  const windows: RallyWindow[] = [];
  if (ballPresentAt.length === 0) {
    onProgress?.(1.0);
    return [];
  }

  let windowStart = ballPresentAt[0];
  let windowEnd = ballPresentAt[0];
  let detectionCount = 1;
  let totalInWindow = 1;

  for (let i = 1; i < ballPresentAt.length; i++) {
    const timeSec = ballPresentAt[i];
    const gap = timeSec - windowEnd;

    if (gap <= gapToleranceSec) {
      windowEnd = timeSec;
      detectionCount++;
    } else {
      const duration = windowEnd - windowStart;
      if (duration >= minDurationSec) {
        const clampedEnd = Math.min(windowStart + maxDurationSec, windowEnd);
        const conf = Math.min(1, detectionCount / Math.max(1, totalInWindow));
        windows.push({ startSec: windowStart, endSec: clampedEnd, confidence: conf });
      }
      windowStart = timeSec;
      windowEnd = timeSec;
      detectionCount = 1;
    }
    totalInWindow++;
  }

  // Flush last window
  const duration = windowEnd - windowStart;
  if (duration >= minDurationSec) {
    const clampedEnd = Math.min(windowStart + maxDurationSec, windowEnd);
    const conf = Math.min(1, detectionCount / Math.max(1, totalInWindow));
    windows.push({ startSec: windowStart, endSec: clampedEnd, confidence: conf });
  }

  onProgress?.(1.0);
  return windows;
}

/**
 * Runs analyzeRally on multiple windows sequentially.
 * Calls onProgress with overall progress 0→1.
 */
export async function analyzeRallyBatch(
  windows: RallyWindow[],
  baseOpts: Omit<AnalyzeRallyOptions, 'startSec' | 'endSec' | 'onProgress'> & {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  }
): Promise<{ window: RallyWindow; result: RallyAnalysis }[]> {
  const results: { window: RallyWindow; result: RallyAnalysis }[] = [];

  for (let i = 0; i < windows.length; i++) {
    if (baseOpts.signal?.aborted) break;

    const win = windows[i];
    try {
      const result = await analyzeRally({
        ...baseOpts,
        startSec: win.startSec,
        endSec: win.endSec,
        onProgress: (p) => {
          baseOpts.onProgress?.((i + p) / windows.length);
        },
      });
      results.push({ window: win, result });
    } catch {
      // Continue with next window on error
    }
  }

  return results;
}
