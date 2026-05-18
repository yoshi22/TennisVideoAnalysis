import { type DecodedFrame } from './types';
import { detectBlobs } from './blobDetect';
import { computeMotionMask } from './frameDiff';
import { removeLargeRegions } from './playerMask';

const DEFAULT_MIN_DURATION_SEC = 2;

// Amateur fixed-camera rallies range 10-27s. 25s gives headroom while keeping
// the hard cap tight enough to prevent cascade merges across inter-point activity.
const DEFAULT_MAX_DURATION_SEC = 25;

// At 3fps, 3s ≈ 9 frames. Shorter than broadcast (5s) because fixed cameras have
// no broadcast-cut gaps to bridge; the only true within-rally gap is ball off-screen.
const DEFAULT_GAP_TOLERANCE_SEC = 3;

// On fixed-camera footage, rally frames contain simultaneous motion from both players
// AND the ball, producing a higher blob count than inter-point frames where players
// are stationary. Empirically tuned on muko-clip1 (1798 frames, 18 GT rallies):
// blob ≥ 13 separates rally activity from inter-point noise (F1=0.558 vs 0.000 baseline).
// This is the INVERSE of the broadcast heuristic (which used blob ≤ 20 to exclude closeups).
const MIN_FIXED_CAM_RALLY_BLOBS = 13;

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
  /** Minimum rally duration in seconds (default: 2) */
  minDurationSec?: number;
  /** Maximum rally duration in seconds (default: 25) */
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
    const mask = removeLargeRegions(rawMask, curr.width, curr.height);
    const blobs = detectBlobs(mask, curr.width, curr.height);

    if (isActiveRallyFrame(blobs.length)) {
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
 * On fixed-camera footage, rally frames have simultaneous player + ball motion,
 * producing a higher blob count than inter-point frames where players stand still.
 * Threshold of 13 empirically separates active rally from between-point activity.
 */
function isActiveRallyFrame(blobCount: number): boolean {
  return blobCount >= MIN_FIXED_CAM_RALLY_BLOBS;
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
