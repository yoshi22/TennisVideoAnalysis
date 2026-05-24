#!/usr/bin/env tsx
/**
 * run-stage1.ts — Run rally segmentation pipeline on all labeled clips in a dataset.
 *
 * Usage:
 *   npm run eval:run1 -- --dataset <name> [--run-id <id>] [--fps <n>] [--clip-id <id>]
 *
 * Reads:  eval/datasets/<name>/frames/<videoId>/  (pre-extracted JPEG frames)
 *         eval/datasets/<name>/labels/<videoId>.json  (ground truth, for duration)
 * Writes: eval/results/<run-id>/per-video/<videoId>.json
 *         eval/results/<run-id>/manifest.json
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import {
  detectRallyWindowsFromFrames,
  detectRallyWindowsFromTrajectories,
  type RallySegmentOptions,
} from '../../src/services/ball/core/rallySegment';
import { getVideoDurationSec } from './lib/frameSampler.node';
import type { VideoRunResult } from './lib/types';

type MinimalGroundTruth = {
  clipDurationSec?: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const getNumber = (flag: string): number | undefined => {
    const raw = get(flag);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const dataset = get('--dataset');
  const fps = parseFloat(get('--fps') ?? '3');
  const runId = get('--run-id') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const detector = (get('--detector') ?? 'blob') as 'blob' | 'trajectory';
  const clipId = get('--clip-id');
  const rallyOptions: RallySegmentOptions = {
    minDurationSec: getNumber('--min-duration-sec'),
    maxDurationSec: getNumber('--max-duration-sec'),
    gapToleranceSec: getNumber('--gap-tolerance-sec'),
    rallyBlobThreshold: getNumber('--rally-blob-threshold'),
    bridgeBlobThreshold: getNumber('--bridge-blob-threshold'),
    bridgeMinDualZonePx: getNumber('--bridge-min-dual-zone-px'),
    windowStartPaddingSec: getNumber('--window-start-padding-sec'),
    windowEndPaddingSec: getNumber('--window-end-padding-sec'),
    refinedWindowStartPaddingSec: getNumber('--refined-window-start-padding-sec'),
    refinedWindowEndPaddingSec: getNumber('--refined-window-end-padding-sec'),
    maxVisualTrimSec: getNumber('--max-visual-trim-sec'),
    splitMinWindowSec: getNumber('--split-min-window-sec'),
    splitQuietSec: getNumber('--split-quiet-sec'),
    visualActivityGapSec: getNumber('--visual-activity-gap-sec'),
    paddedWindowMergeEpsilonSec: getNumber('--padded-window-merge-epsilon-sec'),
  };

  if (!dataset) {
    console.error(
      'Usage: npm run eval:run1 -- --dataset <name> [--run-id <id>] [--fps <n>] [--detector blob|trajectory] [--clip-id <id>]'
    );
    process.exit(1);
  }
  return { dataset, fps, runId, detector, rallyOptions, clipId };
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

async function runOnVideo(
  videoId: string,
  framesDir: string,
  videoDurationSec: number,
  fps: number,
  detector: 'blob' | 'trajectory',
  rallyOptions: RallySegmentOptions
): Promise<VideoRunResult> {
  const allFramePaths = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));
  const framePaths = sampleFramePathsForScan(allFramePaths, videoDurationSec, fps);

  if (framePaths.length < 3) {
    return { videoId, videoDurationSec, scanFps: fps, detectedRallies: [], runtimeMs: 0 };
  }

  const step = videoDurationSec / Math.max(framePaths.length - 1, 1);

  const t0 = Date.now();
  const framesWithTimestamp = await mapWithConcurrency(framePaths, 24, async (fp, i) => ({
    decoded: await decodeFrameGrayNode(fp),
    timeSec: i * step,
  }));

  const windows =
    detector === 'trajectory'
      ? detectRallyWindowsFromTrajectories(framesWithTimestamp, rallyOptions)
      : detectRallyWindowsFromFrames(framesWithTimestamp, rallyOptions);

  return {
    videoId,
    videoDurationSec,
    scanFps: fps,
    detectedRallies: windows,
    runtimeMs: Date.now() - t0,
  };
}

async function main() {
  const { dataset, fps, runId, detector, rallyOptions, clipId } = parseArgs();

  const labelsDir = join('eval', 'datasets', dataset, 'labels');
  const framesBase = join('eval', 'datasets', dataset, 'frames');
  const resultsDir = join('eval', 'results', runId, 'per-video');
  mkdirSync(resultsDir, { recursive: true });

  const labelFiles = existsSync(labelsDir)
    ? readdirSync(labelsDir).filter((f) => f.endsWith('.json'))
    : [];
  const filteredFiles = clipId ? labelFiles.filter((f) => f === `${clipId}.json`) : labelFiles;

  if (clipId && filteredFiles.length === 0) {
    console.error(`No label file found for clip-id: ${clipId} in ${labelsDir}`);
    process.exit(1);
  }

  if (filteredFiles.length === 0) {
    console.error(`No label files found in ${labelsDir}`);
    console.error('Create a label JSON first, then run eval:run1.');
    process.exit(1);
  }

  console.log(`Run ID: ${runId}`);
  console.log(`Dataset: ${dataset} (${filteredFiles.length} videos)`);

  for (const labelFile of filteredFiles) {
    const videoId = labelFile.replace('.json', '');
    const labelPath = join(labelsDir, labelFile);
    const label = JSON.parse(readFileSync(labelPath, 'utf8')) as MinimalGroundTruth;
    const framesDir = join(framesBase, videoId);
    const clipPath = join('eval', 'datasets', dataset, 'clips', `${videoId}.mp4`);

    if (!existsSync(framesDir)) {
      console.warn(`⚠ Frames not found for ${videoId}, skipping (run eval:frames first)`);
      continue;
    }

    // Prefer the clip file for exact duration. If deleted (48h ToS cleanup),
    // prefer the label duration. This keeps legacy 30fps frame directories
    // compatible with a 3fps scan instead of stretching their timeline.
    const derivedDuration = readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length / fps;
    const labelDuration =
      typeof label.clipDurationSec === 'number' && label.clipDurationSec > 0
        ? label.clipDurationSec
        : 600;
    const videoDurationSec = existsSync(clipPath)
      ? await getVideoDurationSec(clipPath)
      : labelDuration > 0
        ? labelDuration
        : derivedDuration > 0
          ? derivedDuration
          : 60;

    process.stdout.write(`  Processing ${videoId}...`);
    const result = await runOnVideo(
      videoId,
      framesDir,
      videoDurationSec,
      fps,
      detector,
      rallyOptions
    );
    writeFileSync(join(resultsDir, `${videoId}.json`), JSON.stringify(result, null, 2));
    console.log(` ${result.detectedRallies.length} rallies in ${result.runtimeMs}ms`);
  }

  // Write manifest
  const manifest = {
    runId,
    dataset,
    fps,
    detector,
    gitSha: getGitSha(),
    createdAt: new Date().toISOString(),
    config: { scanFps: fps, detector, rallyOptions },
  };
  writeFileSync(join('eval', 'results', runId, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nResults written to eval/results/${runId}/`);
  console.log(`Next: npm run eval:score -- --run-id ${runId} --dataset ${dataset}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
