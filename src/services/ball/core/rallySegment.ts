import { type DecodedFrame } from './types';
import { detectBlobs } from './blobDetect';
import { computeMotionMask } from './frameDiff';

// Aces and double faults can produce only a few seconds of usable ball motion,
// so keep the floor low for recall after noisy frames are filtered out.
const DEFAULT_MIN_DURATION_SEC = 2;

// Long baseline rallies can exceed 60s; 90s avoids truncating valid points while
// still bounding accidental merges across extended broadcast sequences.
const DEFAULT_MAX_DURATION_SEC = 90;

// 5s bridges within-rally motion gaps (ball briefly off-screen, player position change)
// without spanning the typical inter-point rest. Tuned on fixed-camera amateur footage.
const DEFAULT_GAP_TOLERANCE_SEC = 5;

// Crowd/player closeups and replay-like shots create hundreds of tiny motion
// blobs; court-view ball evidence is sparse enough to keep candidate counts low.
const MAX_BLOB_CANDIDATES_PER_FRAME = 20;

// 3s serve lead-in captures the ball toss; 4s end padding retains the follow-through
// and ball landing — together keeping boundary MAE low for fast-serve broadcasts.
const WINDOW_START_PADDING_SEC = 3;
const WINDOW_END_PADDING_SEC = 4;

// Padding can leave windows separated by sub-frame rounding gaps; merge those
// artifacts while preserving distinct tennis points.
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
  /** Maximum rally duration in seconds (default: 90) */
  maxDurationSec?: number;
  /** Max gap between detections to treat as same rally in seconds (default: 5) */
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

    const mask = computeMotionMask(prev, curr, next);
    const blobs = detectBlobs(mask, curr.width, curr.height);

    if (isBroadcastBallPresenceFrame(blobs.length)) {
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

  return mergeOverlappingWindows(windows);
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

function isBroadcastBallPresenceFrame(blobCount: number): boolean {
  return blobCount > 0 && blobCount <= MAX_BLOB_CANDIDATES_PER_FRAME;
}

function mergeOverlappingWindows(windows: RallyWindow[]): RallyWindow[] {
  if (windows.length <= 1) return windows;

  const merged: RallyWindow[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + PADDED_WINDOW_MERGE_EPSILON_SEC) {
      previous.endSec = Math.max(previous.endSec, window.endSec);
      previous.confidence = Math.max(previous.confidence, window.confidence);
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
}
