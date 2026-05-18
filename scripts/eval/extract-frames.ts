#!/usr/bin/env tsx
/**
 * extract-frames.ts — Extract JPEG frames from a clip using ffmpeg.
 *
 * Usage:
 *   npm run eval:frames -- --dataset <name> --id <videoId> [--fps <n>]
 *
 * Output: eval/datasets/<name>/frames/<videoId>/frame_000001.jpg ...
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractFramesNode, getVideoDurationSec } from './lib/frameSampler.node';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  const dataset = get('--dataset');
  const id = get('--id');
  const fps = parseFloat(get('--fps') ?? '3');

  if (!dataset || !id) {
    console.error('Usage: npm run eval:frames -- --dataset <name> --id <videoId> [--fps <n>]');
    process.exit(1);
  }

  return { dataset, videoId: id, fps };
}

async function main() {
  const { dataset, videoId, fps } = parseArgs();

  const clipPath = join('eval', 'datasets', dataset, 'clips', `${videoId}.mp4`);
  const framesDir = join('eval', 'datasets', dataset, 'frames', videoId);

  if (!existsSync(clipPath)) {
    console.error(`Clip not found: ${clipPath}`);
    console.error('Run eval:clip first.');
    process.exit(1);
  }

  mkdirSync(framesDir, { recursive: true });

  console.log(`Extracting frames at ${fps} fps from ${clipPath}`);
  const duration = await getVideoDurationSec(clipPath);
  console.log(`  Video duration: ${duration.toFixed(1)}s`);

  const frames = await extractFramesNode({ videoPath: clipPath, outputDir: framesDir, fps });

  console.log(`  Extracted ${frames.length} frames → ${framesDir}`);
  console.log(`\nNext: npm run eval:stage1 -- --dataset ${dataset} [--run-id <id>]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
