import { type DecodedFrame } from './types';
import { computeMotionMask } from './frameDiff';
import { removeLargeRegions } from './playerMask';
import { detectBlobs } from './blobDetect';

// 4s discards post-serve bounces and net-cord fragments while keeping the
// shortest GT rally (10s) well above threshold.
const DEFAULT_MIN_DURATION_SEC = 4;

// Amateur fixed-camera rallies range 10-27s. 30s gives headroom above the
// longest observed rally (27s) while the hard-cap merge prevents cascade bloat.
const DEFAULT_MAX_DURATION_SEC = 30;

// At 3fps, 3s ≈ 9 frames. Shorter than broadcast (5s) because fixed cameras have
// no broadcast-cut gaps to bridge; the only true within-rally gap is ball off-screen.
const DEFAULT_GAP_TOLERANCE_SEC = 3;

// Primary signal: after removing player silhouettes (large CCs), a rally frame
// has ≥11 small ball-sized blobs from ball motion, racket tips, and spray.
// Youden J=0.073 at frame level but produces F1=0.632 at window level because
// the signal is bursty and aligns well with rally boundaries.
const MIN_FIXED_CAM_RALLY_BLOBS = 11;

// Bridge signal: mid-rally gaps occur when the ball is mid-flight and both
// players pause (blobCount drops to 7-10 for 1-4s). The bridge fires when
// moderate blob activity (≥7) coincides with very high simultaneous motion
// in BOTH vertical halves (minTB ≥ 320 raw AND-diff pixels).
// Threshold=320 is calibrated: inter-point walk-ins peak at minTB≈315 while
// genuine mid-rally pauses (both players actively in rally position) reach
// minTB≥356 (GT14 at t=429s). Fires at most 1-2 frames per bridge, so the
// sole effect is reducing effective gap from 3.3s to ≤3.0s for gap_tol merge.
const BRIDGE_BLOB_THRESH = 7;
const BRIDGE_MIN_DUAL_ZONE_PX = 320;

// 3s serve lead-in captures the ball toss; 4s end padding retains the follow-through
// and ball landing — together keeping boundary MAE low.
const WINDOW_START_PADDING_SEC = 3;
const WINDOW_END_PADDING_SEC = 4;

// Padding can leave windows separated by sub-frame rounding gaps; merge those
// artifacts while preserving distinct tennis points.  Hard cap prevents cascade
// merges: two adjacent 25s windows must not fuse into a 50s false positive.
const PADDED_WINDOW_MERGE_EPSILON_SEC = 0.25;

export interface RallyWindow {
  startSec: number;
  endSec: number;
  /** 0..1 estimate of detection confidence for this window */
  confidence: number;
}

export interface FrameWithTimestamp {
  decoded: DecodedFrame;
  timeSec: number;
}

export interface RallySegmentOptions {
  /** Minimum rally duration in seconds (default: 4) */
  minDurationSec?: number;
  /** Maximum rally duration in seconds (default: 30) */
  maxDurationSec?: number;
  /** Max gap between detections to treat as same rally in seconds (default: 3) */
  gapToleranceSec?: number;
}

/**
 * Pure function: given pre-decoded frames, detects rally windows via motion + blob analysis.
 * Runtime: Node or React Native — no I/O dependencies.
 */
export function detectRallyWindowsFromFrames(
  frames: FrameWithTimestamp[],
  opts?: RallySegmentOptions
): RallyWindow[] {
  const resolvedOpts = resolveRallySegmentOptions(opts);

  if (frames.length < 3) return [];

  const ballPresentAt: number[] = [];

  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1].decoded;
    const curr = frames[i].decoded;
    const next = frames[i + 1].decoded;

    const rawMask = computeMotionMask(prev, curr, next);
    const cleanedMask = removeLargeRegions(rawMask, curr.width, curr.height);
    const blobCount = detectBlobs(cleanedMask, curr.width, curr.height).length;

    const isHighActivity = blobCount >= MIN_FIXED_CAM_RALLY_BLOBS;
    const isBridgeActivity =
      !isHighActivity &&
      blobCount >= BRIDGE_BLOB_THRESH &&
      computeMinHalfMotion(rawMask, curr.width, curr.height) >= BRIDGE_MIN_DUAL_ZONE_PX;

    if (isHighActivity || isBridgeActivity) {
      ballPresentAt.push(frames[i].timeSec);
    }
  }

  return mergeDetectionsIntoWindows(ballPresentAt, resolvedOpts);
}

export function mergeDetectionsIntoWindows(
  ballPresentAt: number[],
  opts: Required<RallySegmentOptions>
): RallyWindow[] {
  const { minDurationSec, maxDurationSec, gapToleranceSec } = resolveRallySegmentOptions(opts);
  const detections = ballPresentAt
    .filter((timeSec) => Number.isFinite(timeSec))
    .sort((a, b) => a - b);

  const windows: RallyWindow[] = [];
  if (detections.length === 0) return [];

  let windowStart = detections[0];
  let windowEnd = detections[0];
  let detectionCount = 1;

  for (let i = 1; i < detections.length; i++) {
    const timeSec = detections[i];
    const gap = timeSec - windowEnd;

    if (gap <= gapToleranceSec) {
      windowEnd = timeSec;
      detectionCount++;
    } else {
      appendWindow(windows, windowStart, windowEnd, detectionCount, minDurationSec, maxDurationSec);
      windowStart = timeSec;
      windowEnd = timeSec;
      detectionCount = 1;
    }
  }

  // Flush last window
  appendWindow(windows, windowStart, windowEnd, detectionCount, minDurationSec, maxDurationSec);

  return mergeOverlappingWindows(windows, maxDurationSec);
}

function resolveRallySegmentOptions(opts?: RallySegmentOptions): Required<RallySegmentOptions> {
  const minDurationSec = getPositiveOption(opts?.minDurationSec, DEFAULT_MIN_DURATION_SEC);
  const maxDurationSec = Math.max(
    getPositiveOption(opts?.maxDurationSec, DEFAULT_MAX_DURATION_SEC),
    minDurationSec
  );
  const gapToleranceSec = getPositiveOption(opts?.gapToleranceSec, DEFAULT_GAP_TOLERANCE_SEC);
  return { minDurationSec, maxDurationSec, gapToleranceSec };
}

function getPositiveOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function appendWindow(
  windows: RallyWindow[],
  windowStart: number,
  windowEnd: number,
  detectionCount: number,
  minDurationSec: number,
  maxDurationSec: number
): void {
  const duration = windowEnd - windowStart;
  if (duration >= minDurationSec) {
    const paddedStart = Math.max(0, windowStart - WINDOW_START_PADDING_SEC);
    const clampedEnd = Math.min(paddedStart + maxDurationSec, windowEnd + WINDOW_END_PADDING_SEC);
    const confidence = Math.min(1, detectionCount / Math.max(1, duration));
    windows.push({ startSec: paddedStart, endSec: clampedEnd, confidence });
  }
}

/**
 * Returns min(topHalfMotion, bottomHalfMotion) of the raw AND-diff mask.
 * A high value means BOTH vertical halves of the frame have simultaneous motion —
 * the characteristic signature of a live rally on a side-view fixed camera.
 */
function computeMinHalfMotion(mask: Uint8Array, width: number, height: number): number {
  let top = 0;
  let bot = 0;
  const midY = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        if (y < midY) top++;
        else bot++;
      }
    }
  }
  return Math.min(top, bot);
}

/**
 * Merges adjacent windows that are within epsilon of each other, but refuses to
 * merge if the result would exceed maxDurationSec. This hard cap prevents cascade
 * merges where multiple padded windows chain into one oversized false positive.
 */
function mergeOverlappingWindows(windows: RallyWindow[], maxDurationSec: number): RallyWindow[] {
  if (windows.length <= 1) return windows;

  const merged: RallyWindow[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + PADDED_WINDOW_MERGE_EPSILON_SEC) {
      const candidateEnd = Math.max(previous.endSec, window.endSec);
      if (candidateEnd - previous.startSec <= maxDurationSec) {
        previous.endSec = candidateEnd;
        previous.confidence = Math.max(previous.confidence, window.confidence);
      } else {
        merged.push({ ...window });
      }
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
}
