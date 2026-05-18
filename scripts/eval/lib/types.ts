// ────────────────────────────────────────────────────────────
// Ground Truth schema (forward-compatible across Stage 1→3)
// ────────────────────────────────────────────────────────────

export interface RallyLabel {
  startSec: number;
  endSec: number;
  // Stage 2+
  server?: 'near' | 'far';
  serveSpeedKmh?: number;
  // Stage 3+
  winner?: 'near' | 'far';
  endReason?: 'winner' | 'forcedError' | 'unforcedError' | 'ace' | 'doubleFault';
  shots?: Array<{ timeSec: number; player: 'near' | 'far'; type?: string }>;
}

export interface GroundTruth {
  schemaVersion: 1;
  /** Identifier used for filenames and result keys, e.g. "us-open-2024-sf-clip1" */
  videoId: string;
  sourceUrl: string;
  /** SHA-256 hex of the downloaded video file for reproducibility */
  sourceSha256: string;
  /** Frame rate of the source the labeler watched */
  fps: number;
  /** Offset of clip start from the original video start */
  clipOffsetSec: number;
  rallies: RallyLabel[];
}

// ────────────────────────────────────────────────────────────
// Per-video evaluation output
// ────────────────────────────────────────────────────────────

export interface PerVideoMetrics {
  videoId: string;
  /** Event-level F1 at IoU ≥ 0.5 (primary KPI) */
  eventF1: number;
  eventPrecision: number;
  eventRecall: number;
  iouMean: number;
  iouP10: number;
  boundaryStartMaeSec: number;
  boundaryEndMaeSec: number;
  /** False positive seconds per video minute */
  fpSecondsPerMinute: number;
  rallyCountTrue: number;
  rallyCountDetected: number;
  videoDurationSec: number;
}

export interface RegressionGuard {
  baselineRunId: string;
  perVideoF1Delta: Record<string, number>; // negative = regression
  /** true when any video degrades by > 0.05 F1 vs baseline */
  rejected: boolean;
}

export interface AggregateMetrics {
  eventF1: number;
  eventPrecision: number;
  eventRecall: number;
  iouMean: number;
  iouP10: number;
  boundaryStartMaeSec: number;
  boundaryEndMaeSec: number;
  fpSecondsPerMinute: number;
  videoCount: number;
}

export interface EvalMetrics {
  runId: string;
  stage: 1 | 2 | 3;
  createdAt: string;
  perVideo: Record<string, PerVideoMetrics>;
  aggregate: AggregateMetrics;
  regressionGuard?: RegressionGuard;
}

// ────────────────────────────────────────────────────────────
// run-stage1 output (one per video)
// ────────────────────────────────────────────────────────────

export interface DetectedRallyWindow {
  startSec: number;
  endSec: number;
  confidence: number;
}

export interface VideoRunResult {
  videoId: string;
  videoDurationSec: number;
  scanFps: number;
  detectedRallies: DetectedRallyWindow[];
  runtimeMs: number;
}
