#!/usr/bin/env tsx
/**
 * run-stage1.ts — Run rally segmentation pipeline on all labeled clips in a dataset.
 *
 * Usage:
 *   npm run eval:run1 -- --dataset <name> [--run-id <id>] [--fps <n>]
 *
 * Reads:  eval/datasets/<name>/frames/<videoId>/  (pre-extracted JPEG frames)
 *         eval/datasets/<name>/labels/<videoId>.json  (ground truth, for duration)
 * Writes: eval/results/<run-id>/per-video/<videoId>.json
 *         eval/results/<run-id>/manifest.json
 */
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { detectRallyWindowsFromFrames } from '../../src/services/ball/core/rallySegment';
import { getVideoDurationSec } from './lib/frameSampler.node';
import type { VideoRunResult, GroundTruth } from './lib/types';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const dataset = get('--dataset');
  const fps = parseFloat(get('--fps') ?? '3');
  const runId = get('--run-id') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (!dataset) {
    console.error('Usage: npm run eval:run1 -- --dataset <name> [--run-id <id>] [--fps <n>]');
    process.exit(1);
  }
  return { dataset, fps, runId };
}

function getGitSha(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; }
}

async function runOnVideo(
  videoId: string,
  framesDir: string,
  videoDurationSec: number,
  fps: number
): Promise<VideoRunResult> {
  const framePaths = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));

  if (framePaths.length < 3) {
    return { videoId, videoDurationSec, scanFps: fps, detectedRallies: [], runtimeMs: 0 };
  }

  const step = videoDurationSec / Math.max(framePaths.length - 1, 1);

  const t0 = Date.now();
  const framesWithTimestamp = await Promise.all(
    framePaths.map(async (fp, i) => ({
      decoded: await decodeFrameGrayNode(fp),
      timeSec: i * step,
    }))
  );

  // Use library defaults (maxDurationSec=90, gapToleranceSec=5) optimised for broadcast tennis
  const windows = detectRallyWindowsFromFrames(framesWithTimestamp);

  return {
    videoId,
    videoDurationSec,
    scanFps: fps,
    detectedRallies: windows,
    runtimeMs: Date.now() - t0,
  };
}

async function main() {
  const { dataset, fps, runId } = parseArgs();

  const labelsDir = join('eval', 'datasets', dataset, 'labels');
  const framesBase = join('eval', 'datasets', dataset, 'frames');
  const resultsDir = join('eval', 'results', runId, 'per-video');
  mkdirSync(resultsDir, { recursive: true });

  const labelFiles = existsSync(labelsDir)
    ? readdirSync(labelsDir).filter((f) => f.endsWith('.json'))
    : [];

  if (labelFiles.length === 0) {
    console.error(`No label files found in ${labelsDir}`);
    console.error('Create a label JSON first, then run eval:run1.');
    process.exit(1);
  }

  console.log(`Run ID: ${runId}`);
  console.log(`Dataset: ${dataset} (${labelFiles.length} videos)`);

  for (const labelFile of labelFiles) {
    const videoId = labelFile.replace('.json', '');
    const gt = JSON.parse(readFileSync(join(labelsDir, labelFile), 'utf8')) as GroundTruth;
    const framesDir = join(framesBase, videoId);
    const clipPath = join('eval', 'datasets', dataset, 'clips', `${videoId}.mp4`);

    if (!existsSync(framesDir)) {
      console.warn(`⚠ Frames not found for ${videoId}, skipping (run eval:frames first)`);
      continue;
    }

    const videoDurationSec = existsSync(clipPath)
      ? await getVideoDurationSec(clipPath)
      : gt.rallies.length > 0 ? gt.rallies[gt.rallies.length - 1].endSec + 10 : 60;

    process.stdout.write(`  Processing ${videoId}...`);
    const result = await runOnVideo(videoId, framesDir, videoDurationSec, fps);
    writeFileSync(join(resultsDir, `${videoId}.json`), JSON.stringify(result, null, 2));
    console.log(` ${result.detectedRallies.length} rallies in ${result.runtimeMs}ms`);
  }

  // Write manifest
  const manifest = {
    runId, dataset, fps, gitSha: getGitSha(),
    createdAt: new Date().toISOString(),
    config: { scanFps: fps, minDurationSec: 2, maxDurationSec: 30, gapToleranceSec: 0.5 },
  };
  writeFileSync(join('eval', 'results', runId, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nResults written to eval/results/${runId}/`);
  console.log(`Next: npm run eval:score -- --run-id ${runId} --dataset ${dataset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
