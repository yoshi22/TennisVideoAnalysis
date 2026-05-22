import { type DecodedFrame } from './types';
import { computeMotionMask } from './frameDiff';
import { removeLargeRegions } from './playerMask';
import { detectBlobs } from './blobDetect';
import { trackAllBalls, type FrameInput } from './tracker';

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

// Scoreless visual post-refinement: keep the initial generous padding for
// recall, then trim only a small amount back toward actual activity. This
// improved fixed-camera-v1 aggregate F1 from 0.599 to 0.634 without using score.
const REFINED_WINDOW_START_PADDING_SEC = 2.5;
const REFINED_WINDOW_END_PADDING_SEC = 3;
const MAX_VISUAL_TRIM_SEC = 2;
const SPLIT_MIN_WINDOW_SEC = 18;
const SPLIT_QUIET_SEC = 6;
const VISUAL_ACTIVITY_GAP_SEC = 3;

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
  /** Blob count needed for a primary rally-activity frame (default: 11) */
  rallyBlobThreshold?: number;
  /** Blob count needed for a bridge frame between stronger activity (default: 7) */
  bridgeBlobThreshold?: number;
  /** Minimum simultaneous top/bottom motion pixels for bridge frames (default: 320) */
  bridgeMinDualZonePx?: number;
  /** Seconds to pad before the first raw activity frame (default: 3) */
  windowStartPaddingSec?: number;
  /** Seconds to pad after the last raw activity frame (default: 4) */
  windowEndPaddingSec?: number;
  /** Seconds to pad before refined activity groups (default: 2.5) */
  refinedWindowStartPaddingSec?: number;
  /** Seconds to pad after refined activity groups (default: 3) */
  refinedWindowEndPaddingSec?: number;
  /** Maximum seconds a refined boundary may trim from the padded source window (default: 2) */
  maxVisualTrimSec?: number;
  /** Minimum source-window duration before split refinement is allowed (default: 18) */
  splitMinWindowSec?: number;
  /** Quiet gap that triggers split refinement (default: 6) */
  splitQuietSec?: number;
  /** Max gap between visual activity frames inside a refinement group (default: 3) */
  visualActivityGapSec?: number;
  /** Merge epsilon for adjacent padded windows (default: 0.25) */
  paddedWindowMergeEpsilonSec?: number;
}

type ResolvedRallySegmentOptions = Required<RallySegmentOptions>;

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

    const isHighActivity = blobCount >= resolvedOpts.rallyBlobThreshold;
    const isBridgeActivity =
      !isHighActivity &&
      blobCount >= resolvedOpts.bridgeBlobThreshold &&
      computeMinHalfMotion(rawMask, curr.width, curr.height) >= resolvedOpts.bridgeMinDualZonePx;

    if (isHighActivity || isBridgeActivity) {
      ballPresentAt.push(frames[i].timeSec);
    }
  }

  return mergeDetectionsIntoWindows(ballPresentAt, resolvedOpts);
}

export function mergeDetectionsIntoWindows(
  ballPresentAt: number[],
  opts: RallySegmentOptions = {}
): RallyWindow[] {
  const resolvedOpts = resolveRallySegmentOptions(opts);
  const { gapToleranceSec } = resolvedOpts;
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
      appendWindow(windows, windowStart, windowEnd, detectionCount, resolvedOpts);
      windowStart = timeSec;
      windowEnd = timeSec;
      detectionCount = 1;
    }
  }

  // Flush last window
  appendWindow(windows, windowStart, windowEnd, detectionCount, resolvedOpts);

  const mergedWindows = mergeOverlappingWindows(
    windows,
    resolvedOpts.maxDurationSec,
    resolvedOpts.paddedWindowMergeEpsilonSec
  );
  return refineWindowsWithDetections(mergedWindows, detections, resolvedOpts);
}

/**
 * Trajectory-based rally detector.
 * Uses ball position tracking (greedy NN) instead of blob count.
 * A rally frame is one covered by any completed ball trajectory.
 * The underlying mergeDetectionsIntoWindows logic is identical to the baseline.
 */
export function detectRallyWindowsFromTrajectories(
  frames: FrameWithTimestamp[],
  opts?: RallySegmentOptions
): RallyWindow[] {
  const resolvedOpts = resolveRallySegmentOptions(opts);

  if (frames.length < 3) return [];

  const frameInputs: FrameInput[] = [];

  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1].decoded;
    const curr = frames[i].decoded;
    const next = frames[i + 1].decoded;

    const rawMask = computeMotionMask(prev, curr, next);
    const cleanedMask = removeLargeRegions(rawMask, curr.width, curr.height);
    const candidates = detectBlobs(cleanedMask, curr.width, curr.height);

    frameInputs.push({ timeSec: frames[i].timeSec, candidates });
  }

  const trajectories = trackAllBalls(frameInputs);

  const ballPresentAt: number[] = [];
  for (const traj of trajectories) {
    for (const det of traj.detections) {
      ballPresentAt.push(det.timeSec);
    }
  }

  return mergeDetectionsIntoWindows(ballPresentAt, resolvedOpts);
}

function resolveRallySegmentOptions(opts?: RallySegmentOptions): ResolvedRallySegmentOptions {
  const minDurationSec = getPositiveOption(opts?.minDurationSec, DEFAULT_MIN_DURATION_SEC);
  const maxDurationSec = Math.max(
    getPositiveOption(opts?.maxDurationSec, DEFAULT_MAX_DURATION_SEC),
    minDurationSec
  );
  const gapToleranceSec = getPositiveOption(opts?.gapToleranceSec, DEFAULT_GAP_TOLERANCE_SEC);
  const rallyBlobThreshold = getPositiveOption(opts?.rallyBlobThreshold, MIN_FIXED_CAM_RALLY_BLOBS);
  const bridgeBlobThreshold = getPositiveOption(opts?.bridgeBlobThreshold, BRIDGE_BLOB_THRESH);
  const bridgeMinDualZonePx = getPositiveOption(opts?.bridgeMinDualZonePx, BRIDGE_MIN_DUAL_ZONE_PX);
  const windowStartPaddingSec = getPositiveOption(
    opts?.windowStartPaddingSec,
    WINDOW_START_PADDING_SEC
  );
  const windowEndPaddingSec = getPositiveOption(opts?.windowEndPaddingSec, WINDOW_END_PADDING_SEC);
  const refinedWindowStartPaddingSec = getPositiveOption(
    opts?.refinedWindowStartPaddingSec,
    REFINED_WINDOW_START_PADDING_SEC
  );
  const refinedWindowEndPaddingSec = getPositiveOption(
    opts?.refinedWindowEndPaddingSec,
    REFINED_WINDOW_END_PADDING_SEC
  );
  const maxVisualTrimSec = getPositiveOption(opts?.maxVisualTrimSec, MAX_VISUAL_TRIM_SEC);
  const splitMinWindowSec = getPositiveOption(opts?.splitMinWindowSec, SPLIT_MIN_WINDOW_SEC);
  const splitQuietSec = getPositiveOption(opts?.splitQuietSec, SPLIT_QUIET_SEC);
  const visualActivityGapSec = getPositiveOption(
    opts?.visualActivityGapSec,
    VISUAL_ACTIVITY_GAP_SEC
  );
  const paddedWindowMergeEpsilonSec = getPositiveOption(
    opts?.paddedWindowMergeEpsilonSec,
    PADDED_WINDOW_MERGE_EPSILON_SEC
  );
  return {
    minDurationSec,
    maxDurationSec,
    gapToleranceSec,
    rallyBlobThreshold,
    bridgeBlobThreshold,
    bridgeMinDualZonePx,
    windowStartPaddingSec,
    windowEndPaddingSec,
    refinedWindowStartPaddingSec,
    refinedWindowEndPaddingSec,
    maxVisualTrimSec,
    splitMinWindowSec,
    splitQuietSec,
    visualActivityGapSec,
    paddedWindowMergeEpsilonSec,
  };
}

function getPositiveOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function appendWindow(
  windows: RallyWindow[],
  windowStart: number,
  windowEnd: number,
  detectionCount: number,
  opts: ResolvedRallySegmentOptions
): void {
  const duration = windowEnd - windowStart;
  if (duration >= opts.minDurationSec) {
    const paddedStart = Math.max(0, windowStart - opts.windowStartPaddingSec);
    const clampedEnd = Math.min(
      paddedStart + opts.maxDurationSec,
      windowEnd + opts.windowEndPaddingSec
    );
    const confidence = Math.min(1, detectionCount / Math.max(1, duration));
    windows.push({ startSec: paddedStart, endSec: clampedEnd, confidence });
  }
}

function refineWindowsWithDetections(
  windows: RallyWindow[],
  detections: number[],
  opts: ResolvedRallySegmentOptions
): RallyWindow[] {
  if (windows.length === 0) return windows;

  const refined: RallyWindow[] = [];
  for (const window of windows) {
    const activeTimes = detections.filter(
      (timeSec) => timeSec >= window.startSec && timeSec <= window.endSec
    );

    if (activeTimes.length === 0) {
      refined.push({ ...window });
      continue;
    }

    const groups = groupDetectionTimes(activeTimes, opts.visualActivityGapSec);
    const selectedGroups = shouldSplitRefinedWindow(window, groups, opts) ? groups : [activeTimes];

    for (const group of selectedGroups) {
      const candidate = refinedWindowFromGroup(window, group, opts);
      if (candidate) refined.push(candidate);
    }
  }

  return mergeOverlappingWindows(refined, opts.maxDurationSec, opts.paddedWindowMergeEpsilonSec);
}

function groupDetectionTimes(times: number[], maxGapSec: number): number[][] {
  if (times.length === 0) return [];

  const groups: number[][] = [[times[0]]];
  for (const timeSec of times.slice(1)) {
    const currentGroup = groups[groups.length - 1];
    const previousTime = currentGroup[currentGroup.length - 1];
    if (timeSec - previousTime <= maxGapSec) {
      currentGroup.push(timeSec);
    } else {
      groups.push([timeSec]);
    }
  }
  return groups;
}

function shouldSplitRefinedWindow(
  window: RallyWindow,
  groups: number[][],
  opts: ResolvedRallySegmentOptions
): boolean {
  if (window.endSec - window.startSec < opts.splitMinWindowSec || groups.length < 2) {
    return false;
  }

  for (let i = 1; i < groups.length; i++) {
    const previousGroup = groups[i - 1];
    const currentGroup = groups[i];
    const quietGap = currentGroup[0] - previousGroup[previousGroup.length - 1];
    if (quietGap >= opts.splitQuietSec) return true;
  }
  return false;
}

function refinedWindowFromGroup(
  source: RallyWindow,
  group: number[],
  opts: ResolvedRallySegmentOptions
): RallyWindow | null {
  let startSec = Math.max(source.startSec, group[0] - opts.refinedWindowStartPaddingSec);
  let endSec = Math.min(source.endSec, group[group.length - 1] + opts.refinedWindowEndPaddingSec);

  if (startSec - source.startSec > opts.maxVisualTrimSec) {
    startSec = source.startSec + opts.maxVisualTrimSec;
  }
  if (source.endSec - endSec > opts.maxVisualTrimSec) {
    endSec = source.endSec - opts.maxVisualTrimSec;
  }

  const duration = endSec - startSec;
  if (duration < opts.minDurationSec || duration > opts.maxDurationSec) return null;

  const activityConfidence = Math.min(1, group.length / Math.max(1, duration));
  return {
    startSec,
    endSec,
    confidence: Math.max(source.confidence, activityConfidence),
  };
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
function mergeOverlappingWindows(
  windows: RallyWindow[],
  maxDurationSec: number,
  mergeEpsilonSec = PADDED_WINDOW_MERGE_EPSILON_SEC
): RallyWindow[] {
  if (windows.length <= 1) return windows;

  const merged: RallyWindow[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + mergeEpsilonSec) {
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
