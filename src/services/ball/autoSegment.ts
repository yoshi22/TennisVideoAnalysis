import { sampleFrames } from '@/services/pose/frameSampler';

import { decodeFrameGray } from './decodeFrame';
import {
  detectRallyWindowsFromFrames,
  type FrameWithTimestamp,
  type RallySegmentOptions,
  type RallyWindow,
} from './core/rallySegment';
import { analyzeRally, type AnalyzeRallyOptions, type RallyAnalysis } from './index';

export type { RallyWindow, FrameWithTimestamp };
export { detectRallyWindowsFromFrames };

export interface DetectRallyWindowsOptions extends RallySegmentOptions {
  videoUri: string;
  videoDurationSec: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Scan FPS (default: 3) */
  scanFps?: number;
}

/**
 * Scans the full video at low fps and identifies time windows where ball candidates exist.
 * Returns merged rally windows sorted chronologically.
 * React Native only — for Node eval use detectRallyWindowsFromFrames + decodeFrame.node.ts.
 */
export async function detectRallyWindows(opts: DetectRallyWindowsOptions): Promise<RallyWindow[]> {
  const {
    videoUri,
    videoDurationSec,
    signal,
    onProgress,
    scanFps = 3,
    minDurationSec,
    maxDurationSec,
    gapToleranceSec,
  } = opts;

  if (videoDurationSec <= 0) {
    return [];
  }

  const totalFrames = Math.max(Math.round(videoDurationSec * scanFps), 2);
  const sampledFrames = await sampleFrames(videoUri, 0, videoDurationSec, totalFrames);
  onProgress?.(0.3);

  if (signal?.aborted) return [];

  // Decode all frames upfront so the pure core function can process them
  const framesWithTimestamp: FrameWithTimestamp[] = [];
  for (let i = 0; i < sampledFrames.length; i++) {
    if (signal?.aborted) break;
    try {
      const decoded = await decodeFrameGray(sampledFrames[i].uri);
      framesWithTimestamp.push({ decoded, timeSec: sampledFrames[i].timeSec });
    } catch {
      // Skip undecodable frames
    }
    onProgress?.(0.3 + (i / sampledFrames.length) * 0.55);
  }

  onProgress?.(0.85);

  const windows = detectRallyWindowsFromFrames(framesWithTimestamp, {
    minDurationSec,
    maxDurationSec,
    gapToleranceSec,
  });

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
