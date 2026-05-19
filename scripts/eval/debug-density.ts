#!/usr/bin/env tsx
/**
 * debug-density.ts — Generate per-frame motion+blob density profile for a clip.
 *
 * Usage:
 *   npx tsx scripts/eval/debug-density.ts <framesDir> [outputTsv]
 *   npx tsx scripts/eval/debug-density.ts eval/datasets/fixed-camera-v1/frames/yt-maitou-suzumura-muko-clip1 /tmp/density-clip1.tsv
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { computeMotionMask } from '../../src/services/ball/core/frameDiff';
import { removeLargeRegions } from '../../src/services/ball/core/playerMask';
import { detectBlobs } from '../../src/services/ball/core/blobDetect';

async function main() {
  const framesDir = process.argv[2];
  const outPath = process.argv[3] ?? '/tmp/density.tsv';

  if (!framesDir) {
    console.error('Usage: npx tsx scripts/eval/debug-density.ts <framesDir> [outputTsv]');
    process.exit(1);
  }

  const fps = 3;
  const framePaths = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));

  console.log(`Loading ${framePaths.length} frames...`);
  const frames = await Promise.all(
    framePaths.map(async (fp, i) => ({
      decoded: await decodeFrameGrayNode(fp),
      timeSec: i / fps,
    }))
  );

  const lines = [
    'frameNum\ttimeSec\trawMotionPx\tmotionPx\tblobCount\trawTopHalf\trawBotHalf\trawLeftHalf\trawRightHalf',
  ];
  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1].decoded;
    const curr = frames[i].decoded;
    const next = frames[i + 1].decoded;
    const w = curr.width;
    const h = curr.height;
    const rawMask = computeMotionMask(prev, curr, next);
    const mask = removeLargeRegions(rawMask, curr.width, curr.height);
    const blobs = detectBlobs(mask, curr.width, curr.height);
    const rawMotionPx = rawMask.reduce((s, v) => s + v, 0);
    const motionPx = mask.reduce((s, v) => s + v, 0);
    // spatial split: top/bottom and left/right halves of raw mask
    let rawTop = 0,
      rawBot = 0,
      rawLeft = 0,
      rawRight = 0;
    const midY = Math.floor(h / 2);
    const midX = Math.floor(w / 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = rawMask[y * w + x];
        if (!v) continue;
        if (y < midY) rawTop += v;
        else rawBot += v;
        if (x < midX) rawLeft += v;
        else rawRight += v;
      }
    }
    lines.push(
      `${i}\t${frames[i].timeSec.toFixed(4)}\t${rawMotionPx}\t${motionPx}\t${blobs.length}\t${rawTop}\t${rawBot}\t${rawLeft}\t${rawRight}`
    );
    if (i % 200 === 0) process.stdout.write(`  ${i}/${frames.length - 2}\r`);
  }

  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`\nWrote ${lines.length - 1} rows to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
