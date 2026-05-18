import type { PerVideoMetrics, VideoRunResult, GroundTruth, AggregateMetrics } from './types';

export function computeIoU(
  a: { startSec: number; endSec: number },
  b: { startSec: number; endSec: number }
): number {
  const interStart = Math.max(a.startSec, b.startSec);
  const interEnd = Math.min(a.endSec, b.endSec);
  const inter = Math.max(0, interEnd - interStart);
  if (inter === 0) return 0;
  const union = a.endSec - a.startSec + (b.endSec - b.startSec) - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Greedy matching: for each GT rally, find the best-IoU detected rally (above threshold).
 * Returns matched pairs and unmatched indices.
 */
export function matchRallies(
  detected: Array<{ startSec: number; endSec: number }>,
  gt: Array<{ startSec: number; endSec: number }>,
  iouThreshold = 0.5
): {
  matches: Array<{ gtIdx: number; detIdx: number; iou: number }>;
  unmatchedGt: number[];
  unmatchedDet: number[];
} {
  const usedDet = new Set<number>();
  const usedGt = new Set<number>();
  const matches: Array<{ gtIdx: number; detIdx: number; iou: number }> = [];

  for (let g = 0; g < gt.length; g++) {
    let bestIou = iouThreshold;
    let bestD = -1;
    for (let d = 0; d < detected.length; d++) {
      if (usedDet.has(d)) continue;
      const iou = computeIoU(gt[g], detected[d]);
      if (iou > bestIou) {
        bestIou = iou;
        bestD = d;
      }
    }
    if (bestD >= 0) {
      matches.push({ gtIdx: g, detIdx: bestD, iou: bestIou });
      usedDet.add(bestD);
      usedGt.add(g);
    }
  }

  const unmatchedGt = gt.map((_, i) => i).filter((i) => !usedGt.has(i));
  const unmatchedDet = detected.map((_, i) => i).filter((i) => !usedDet.has(i));

  return { matches, unmatchedGt, unmatchedDet };
}

export function computePerVideoMetrics(
  run: VideoRunResult,
  gt: GroundTruth,
  iouThreshold = 0.5
): PerVideoMetrics {
  const detected = run.detectedRallies;
  const gtRallies = gt.rallies;

  const { matches, unmatchedDet } = matchRallies(detected, gtRallies, iouThreshold);

  const tp = matches.length;
  const fp = unmatchedDet.length;
  const fn = gtRallies.length - tp;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const eventF1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const ious = matches.map((m) => m.iou);
  const iouMean = ious.length > 0 ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
  const iouP10 =
    ious.length > 0 ? [...ious].sort((a, b) => a - b)[Math.floor(ious.length * 0.1)] : 0;

  const boundaryStartErrors = matches.map((m) =>
    Math.abs(detected[m.detIdx].startSec - gtRallies[m.gtIdx].startSec)
  );
  const boundaryEndErrors = matches.map((m) =>
    Math.abs(detected[m.detIdx].endSec - gtRallies[m.gtIdx].endSec)
  );
  const mae = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // False-positive total seconds
  const fpSeconds = unmatchedDet.reduce(
    (sum, i) => sum + (detected[i].endSec - detected[i].startSec),
    0
  );
  const videoMinutes = run.videoDurationSec / 60;
  const fpSecondsPerMinute = videoMinutes > 0 ? fpSeconds / videoMinutes : 0;

  return {
    videoId: run.videoId,
    eventF1,
    eventPrecision: precision,
    eventRecall: recall,
    iouMean,
    iouP10,
    boundaryStartMaeSec: mae(boundaryStartErrors),
    boundaryEndMaeSec: mae(boundaryEndErrors),
    fpSecondsPerMinute,
    rallyCountTrue: gtRallies.length,
    rallyCountDetected: detected.length,
    videoDurationSec: run.videoDurationSec,
  };
}

export function aggregateMetrics(perVideo: PerVideoMetrics[]): AggregateMetrics {
  const count = perVideo.length;
  if (count === 0) {
    return {
      eventF1: 0,
      eventPrecision: 0,
      eventRecall: 0,
      iouMean: 0,
      iouP10: 0,
      boundaryStartMaeSec: 0,
      boundaryEndMaeSec: 0,
      fpSecondsPerMinute: 0,
      videoCount: 0,
    };
  }
  const avg = (key: keyof PerVideoMetrics) =>
    perVideo.reduce((s, v) => s + (v[key] as number), 0) / count;

  return {
    eventF1: avg('eventF1'),
    eventPrecision: avg('eventPrecision'),
    eventRecall: avg('eventRecall'),
    iouMean: avg('iouMean'),
    iouP10: avg('iouP10'),
    boundaryStartMaeSec: avg('boundaryStartMaeSec'),
    boundaryEndMaeSec: avg('boundaryEndMaeSec'),
    fpSecondsPerMinute: avg('fpSecondsPerMinute'),
    videoCount: count,
  };
}
