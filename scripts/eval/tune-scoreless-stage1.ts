#!/usr/bin/env tsx
/**
 * tune-scoreless-stage1.ts — Evaluate a small scoreless Stage 1 grid with LOCO selection.
 *
 * The script decodes each clip once, extracts scoreless motion/blob features,
 * evaluates candidate rally segmentation options, then writes one per-video
 * result using the config that performed best on the other clips.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { computeMotionMask } from '../../src/services/ball/core/frameDiff';
import { removeLargeRegions } from '../../src/services/ball/core/playerMask';
import { detectBlobs } from '../../src/services/ball/core/blobDetect';
import {
  mergeDetectionsIntoWindows,
  type RallySegmentOptions,
  type RallyWindow,
} from '../../src/services/ball/core/rallySegment';
import { getVideoDurationSec } from './lib/frameSampler.node';
import { aggregateMetrics, computePerVideoMetrics } from './lib/metrics';
import type { EvalMetrics, GroundTruth, PerVideoMetrics, VideoRunResult } from './lib/types';

type LabelWithDuration = GroundTruth & {
  clipDurationSec?: number;
};

type CandidateConfig = {
  id: string;
  options: RallySegmentOptions;
};

type ClipFeatures = {
  videoId: string;
  videoDurationSec: number;
  scanFps: number;
  features: {
    timeSec: number;
    blobCount: number;
    minHalfMotion: number;
  }[];
  label: LabelWithDuration;
};

const CANDIDATE_CONFIGS: CandidateConfig[] = [
  { id: 'default', options: {} },
  {
    id: 'wide-window',
    options: {
      maxDurationSec: 42,
      windowStartPaddingSec: 4,
      windowEndPaddingSec: 5,
      refinedWindowStartPaddingSec: 3,
      refinedWindowEndPaddingSec: 4,
      maxVisualTrimSec: 1,
    },
  },
  {
    id: 'loose-recall',
    options: {
      minDurationSec: 3,
      maxDurationSec: 45,
      gapToleranceSec: 3.5,
      rallyBlobThreshold: 10,
      bridgeBlobThreshold: 6,
      bridgeMinDualZonePx: 260,
      windowStartPaddingSec: 4,
      windowEndPaddingSec: 5,
      refinedWindowStartPaddingSec: 3,
      refinedWindowEndPaddingSec: 4,
      maxVisualTrimSec: 1,
      paddedWindowMergeEpsilonSec: 0.5,
    },
  },
  {
    id: 'high-recall-long',
    options: {
      minDurationSec: 3,
      maxDurationSec: 45,
      gapToleranceSec: 4,
      rallyBlobThreshold: 9,
      bridgeBlobThreshold: 6,
      bridgeMinDualZonePx: 240,
      windowStartPaddingSec: 5,
      windowEndPaddingSec: 6,
      refinedWindowStartPaddingSec: 4,
      refinedWindowEndPaddingSec: 5,
      maxVisualTrimSec: 0.5,
      paddedWindowMergeEpsilonSec: 0.5,
    },
  },
  {
    id: 'tight-gap-long',
    options: {
      maxDurationSec: 42,
      gapToleranceSec: 2.5,
      rallyBlobThreshold: 11,
      bridgeBlobThreshold: 7,
      bridgeMinDualZonePx: 320,
      windowStartPaddingSec: 4,
      windowEndPaddingSec: 5,
      refinedWindowStartPaddingSec: 3,
      refinedWindowEndPaddingSec: 4,
      maxVisualTrimSec: 1,
      splitQuietSec: 5,
      visualActivityGapSec: 2.5,
    },
  },
  {
    id: 'precision-long',
    options: {
      maxDurationSec: 42,
      gapToleranceSec: 3,
      rallyBlobThreshold: 12,
      bridgeBlobThreshold: 8,
      bridgeMinDualZonePx: 380,
      windowStartPaddingSec: 4,
      windowEndPaddingSec: 5,
      refinedWindowStartPaddingSec: 3,
      refinedWindowEndPaddingSec: 4,
      maxVisualTrimSec: 1,
    },
  },
  {
    id: 'split-sensitive',
    options: {
      maxDurationSec: 38,
      gapToleranceSec: 3,
      rallyBlobThreshold: 10,
      bridgeBlobThreshold: 7,
      bridgeMinDualZonePx: 300,
      windowStartPaddingSec: 4,
      windowEndPaddingSec: 5,
      refinedWindowStartPaddingSec: 3,
      refinedWindowEndPaddingSec: 4,
      maxVisualTrimSec: 1,
      splitMinWindowSec: 15,
      splitQuietSec: 5,
      visualActivityGapSec: 2.5,
    },
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const dataset = get('--dataset');
  const fps = Number(get('--fps') ?? '3');
  const runId = get('--run-id') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baselineRunId = get('--baseline-run-id');
  if (!dataset) {
    console.error(
      'Usage: npx tsx scripts/eval/tune-scoreless-stage1.ts --dataset <name> --run-id <id>'
    );
    process.exit(1);
  }
  return { dataset, fps, runId, baselineRunId };
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

function sampleFramePathsForScan(
  framePaths: string[],
  videoDurationSec: number,
  targetFps: number
): string[] {
  const targetCount = Math.max(3, Math.round(videoDurationSec * targetFps));
  if (framePaths.length <= targetCount * 1.5) {
    return framePaths;
  }

  const sampled: string[] = [];
  const last = framePaths.length - 1;
  for (let i = 0; i < targetCount; i++) {
    const index = Math.round((i * last) / Math.max(targetCount - 1, 1));
    sampled.push(framePaths[index]);
  }
  return sampled;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function computeMinHalfMotion(mask: Uint8Array, width: number, height: number): number {
  let top = 0;
  let bottom = 0;
  const midY = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (y < midY) top++;
      else bottom++;
    }
  }
  return Math.min(top, bottom);
}

async function buildClipFeatures(
  dataset: string,
  videoId: string,
  label: LabelWithDuration,
  fps: number
): Promise<ClipFeatures> {
  const framesDir = join('eval', 'datasets', dataset, 'frames', videoId);
  const clipPath = join('eval', 'datasets', dataset, 'clips', `${videoId}.mp4`);

  const allFramePaths = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));

  const labelDuration =
    typeof label.clipDurationSec === 'number' && label.clipDurationSec > 0
      ? label.clipDurationSec
      : 600;
  const videoDurationSec = existsSync(clipPath)
    ? await getVideoDurationSec(clipPath)
    : labelDuration;
  const framePaths = sampleFramePathsForScan(allFramePaths, videoDurationSec, fps);
  const step = videoDurationSec / Math.max(framePaths.length - 1, 1);

  const frames = await mapWithConcurrency(framePaths, 24, async (framePath, index) => ({
    decoded: await decodeFrameGrayNode(framePath),
    timeSec: index * step,
  }));

  const features: ClipFeatures['features'] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1].decoded;
    const curr = frames[i].decoded;
    const next = frames[i + 1].decoded;
    const rawMask = computeMotionMask(prev, curr, next);
    const cleanedMask = removeLargeRegions(rawMask, curr.width, curr.height);
    features.push({
      timeSec: frames[i].timeSec,
      blobCount: detectBlobs(cleanedMask, curr.width, curr.height).length,
      minHalfMotion: computeMinHalfMotion(rawMask, curr.width, curr.height),
    });
  }

  return { videoId, videoDurationSec, scanFps: fps, features, label };
}

function detectFromFeatures(clip: ClipFeatures, config: CandidateConfig): RallyWindow[] {
  const rallyBlobThreshold = config.options.rallyBlobThreshold ?? 11;
  const bridgeBlobThreshold = config.options.bridgeBlobThreshold ?? 7;
  const bridgeMinDualZonePx = config.options.bridgeMinDualZonePx ?? 320;
  const detections = clip.features
    .filter((feature) => {
      if (feature.blobCount >= rallyBlobThreshold) return true;
      return (
        feature.blobCount >= bridgeBlobThreshold && feature.minHalfMotion >= bridgeMinDualZonePx
      );
    })
    .map((feature) => feature.timeSec);

  return mergeDetectionsIntoWindows(detections, config.options);
}

function evaluateConfig(clip: ClipFeatures, config: CandidateConfig): PerVideoMetrics {
  const run: VideoRunResult = {
    videoId: clip.videoId,
    videoDurationSec: clip.videoDurationSec,
    scanFps: clip.scanFps,
    detectedRallies: detectFromFeatures(clip, config),
    runtimeMs: 0,
  };
  return computePerVideoMetrics(run, clip.label);
}

function meanTrainF1(
  perConfigMetrics: Record<string, Record<string, PerVideoMetrics>>,
  configId: string,
  holdoutVideoId: string
): number {
  const metrics = Object.values(perConfigMetrics[configId]).filter(
    (metric) => metric.videoId !== holdoutVideoId
  );
  if (metrics.length === 0) return 0;
  return metrics.reduce((sum, metric) => sum + metric.eventF1, 0) / metrics.length;
}

async function main() {
  const { dataset, fps, runId, baselineRunId } = parseArgs();
  const labelsDir = join('eval', 'datasets', dataset, 'labels');
  const framesBase = join('eval', 'datasets', dataset, 'frames');
  const labelFiles = readdirSync(labelsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const baselineMetrics =
    baselineRunId && existsSync(join('eval', 'results', baselineRunId, 'metrics.json'))
      ? (JSON.parse(
          readFileSync(join('eval', 'results', baselineRunId, 'metrics.json'), 'utf8')
        ) as EvalMetrics)
      : null;

  console.log(`Run ID: ${runId}`);
  console.log(`Dataset: ${dataset} (${labelFiles.length} videos)`);
  console.log(`Configs: ${CANDIDATE_CONFIGS.map((config) => config.id).join(', ')}`);

  const clips: ClipFeatures[] = [];
  for (const labelFile of labelFiles) {
    const videoId = labelFile.replace('.json', '');
    const framesDir = join(framesBase, videoId);
    if (!existsSync(framesDir)) {
      console.warn(`Skipping ${videoId}: frames not found`);
      continue;
    }
    process.stdout.write(`  Feature pass ${videoId}...`);
    const label = JSON.parse(readFileSync(join(labelsDir, labelFile), 'utf8')) as LabelWithDuration;
    const clip = await buildClipFeatures(dataset, videoId, label, fps);
    clips.push(clip);
    console.log(` ${clip.features.length} feature frames`);
  }

  const perConfigMetrics: Record<string, Record<string, PerVideoMetrics>> = {};
  for (const config of CANDIDATE_CONFIGS) {
    perConfigMetrics[config.id] = {};
    for (const clip of clips) {
      perConfigMetrics[config.id][clip.videoId] = evaluateConfig(clip, config);
    }
    const aggregate = aggregateMetrics(Object.values(perConfigMetrics[config.id]));
    const regressionRejected = baselineMetrics
      ? Object.values(perConfigMetrics[config.id]).some((metric) => {
          const baseline = baselineMetrics.perVideo[metric.videoId];
          return baseline ? metric.eventF1 - baseline.eventF1 < -0.05 : false;
        })
      : false;
    const delta = baselineMetrics ? aggregate.eventF1 - baselineMetrics.aggregate.eventF1 : 0;
    const suffix = baselineMetrics
      ? ` delta=${delta >= 0 ? '+' : ''}${delta.toFixed(3)} ${regressionRejected ? 'rejected' : 'guard-ok'}`
      : '';
    console.log(`  ${config.id.padEnd(18)} F1=${aggregate.eventF1.toFixed(3)}${suffix}`);
  }

  const resultsDir = join('eval', 'results', runId, 'per-video');
  mkdirSync(resultsDir, { recursive: true });

  const selectedByVideo: Record<string, string> = {};
  for (const clip of clips) {
    let bestConfig = CANDIDATE_CONFIGS[0];
    let bestTrainF1 = -1;
    for (const config of CANDIDATE_CONFIGS) {
      const trainF1 = meanTrainF1(perConfigMetrics, config.id, clip.videoId);
      if (trainF1 > bestTrainF1) {
        bestTrainF1 = trainF1;
        bestConfig = config;
      }
    }
    selectedByVideo[clip.videoId] = bestConfig.id;
    const detectedRallies = detectFromFeatures(clip, bestConfig);
    const run: VideoRunResult = {
      videoId: clip.videoId,
      videoDurationSec: clip.videoDurationSec,
      scanFps: clip.scanFps,
      detectedRallies,
      runtimeMs: 0,
    };
    writeFileSync(join(resultsDir, `${clip.videoId}.json`), JSON.stringify(run, null, 2));
    const metric = computePerVideoMetrics(run, clip.label);
    console.log(
      `  LOCO ${clip.videoId.padEnd(40)} ${bestConfig.id.padEnd(18)} F1=${metric.eventF1.toFixed(3)}`
    );
  }

  const globalAggregates = Object.fromEntries(
    CANDIDATE_CONFIGS.map((config) => [
      config.id,
      aggregateMetrics(Object.values(perConfigMetrics[config.id])),
    ])
  );
  const perConfigF1 = Object.fromEntries(
    CANDIDATE_CONFIGS.map((config) => [
      config.id,
      Object.fromEntries(
        Object.values(perConfigMetrics[config.id]).map((metric) => [
          metric.videoId,
          Number(metric.eventF1.toFixed(6)),
        ])
      ),
    ])
  );
  const regressionSummary = baselineMetrics
    ? Object.fromEntries(
        CANDIDATE_CONFIGS.map((config) => {
          const perVideoDelta = Object.fromEntries(
            Object.values(perConfigMetrics[config.id]).map((metric) => {
              const baseline = baselineMetrics.perVideo[metric.videoId];
              const delta = baseline ? metric.eventF1 - baseline.eventF1 : 0;
              return [metric.videoId, Number(delta.toFixed(6))];
            })
          );
          const rejected = Object.values(perVideoDelta).some((delta) => delta < -0.05);
          return [config.id, { rejected, perVideoDelta }];
        })
      )
    : null;
  const manifest = {
    runId,
    dataset,
    fps,
    detector: 'scoreless-feature-grid',
    gitSha: getGitSha(),
    createdAt: new Date().toISOString(),
    configs: CANDIDATE_CONFIGS,
    globalAggregates,
    perConfigF1,
    baselineRunId,
    regressionSummary,
    selectedByVideo,
  };
  writeFileSync(join('eval', 'results', runId, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nResults written to eval/results/${runId}/`);
  console.log(`Next: npm run eval:score -- --run-id ${runId} --dataset ${dataset}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
