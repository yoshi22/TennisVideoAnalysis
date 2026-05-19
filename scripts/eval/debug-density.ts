#!/usr/bin/env tsx
/**
 * debug-density.ts — Generate per-frame motion+blob density profile for a clip.
 *
 * Processes frames as a rolling 3-frame window (memory-efficient).
 * Use --stride to subsample source frames — e.g. --fps 30 --stride 10 on a
 * 30fps directory yields timestamps spaced at 1/3s, matching 3fps clips.
 *
 * Usage:
 *   npx tsx scripts/eval/debug-density.ts <framesDir> [outputTsv] [--fps <n>] [--stride <n>]
 *
 * Examples:
 *   # 3fps clip (default)
 *   npx tsx scripts/eval/debug-density.ts eval/.../muko-clip2 /tmp/clip2.tsv
 *   # 30fps clip sampled at 3fps-equivalent spacing
 *   npx tsx scripts/eval/debug-density.ts eval/.../muko-clip1 /tmp/clip1.tsv --fps 30 --stride 10
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { computeMotionMask } from '../../src/services/ball/core/frameDiff';
import { removeLargeRegions } from '../../src/services/ball/core/playerMask';
import { detectBlobs } from '../../src/services/ball/core/blobDetect';

function parseArgs() {
  const argv = process.argv.slice(2);
  const getFlag = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const positional = argv.filter(
    (a) => !a.startsWith('--') && a !== getFlag('--fps') && a !== getFlag('--stride')
  );
  if (!positional[0]) {
    console.error(
      'Usage: npx tsx scripts/eval/debug-density.ts <framesDir> [outputTsv] [--fps <n>] [--stride <n>]'
    );
    process.exit(1);
  }
  return {
    framesDir: positional[0],
    outPath: positional[1] ?? '/tmp/density.tsv',
    fps: parseFloat(getFlag('--fps') ?? '3'),
    stride: parseInt(getFlag('--stride') ?? '1', 10),
  };
}

function computeRow(
  prev: Awaited<ReturnType<typeof decodeFrameGrayNode>>,
  curr: Awaited<ReturnType<typeof decodeFrameGrayNode>>,
  next: Awaited<ReturnType<typeof decodeFrameGrayNode>>,
  fileIndex: number,
  fps: number
): string {
  const { width: w, height: h } = curr;
  const rawMask = computeMotionMask(prev, curr, next);
  const mask = removeLargeRegions(rawMask, w, h);
  const blobs = detectBlobs(mask, w, h);
  const rawMotionPx = rawMask.reduce((s, v) => s + v, 0);
  const motionPx = mask.reduce((s, v) => s + v, 0);

  const midY = Math.floor(h / 2);
  const midX = Math.floor(w / 2);
  let rawTop = 0,
    rawBot = 0,
    rawLeft = 0,
    rawRight = 0;
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

  const timeSec = (fileIndex / fps).toFixed(4);
  return `${fileIndex}\t${timeSec}\t${rawMotionPx}\t${motionPx}\t${blobs.length}\t${rawTop}\t${rawBot}\t${rawLeft}\t${rawRight}`;
}

async function main() {
  const { framesDir, outPath, fps, stride } = parseArgs();

  const allFiles = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));

  // Selected frame file indices: [stride, 2*stride, 3*stride, ...]
  const selectedIndices: number[] = [];
  for (let i = stride; i < allFiles.length - stride; i += stride) {
    selectedIndices.push(i);
  }

  console.log(
    `framesDir: ${framesDir}\nfps=${fps}  stride=${stride}  total_files=${allFiles.length}  selected_frames=${selectedIndices.length}`
  );

  const header =
    'frameNum\ttimeSec\trawMotionPx\tmotionPx\tblobCount\trawTopHalf\trawBotHalf\trawLeftHalf\trawRightHalf';
  const lines = [header];

  // Rolling window: load prev once, then slide curr→prev, load next
  let prevDecoded = await decodeFrameGrayNode(allFiles[selectedIndices[0] - stride]);
  let currDecoded = await decodeFrameGrayNode(allFiles[selectedIndices[0]]);

  for (let j = 0; j < selectedIndices.length; j++) {
    const fileIdx = selectedIndices[j];
    const nextDecoded = await decodeFrameGrayNode(allFiles[fileIdx + stride]);

    lines.push(computeRow(prevDecoded, currDecoded, nextDecoded, fileIdx, fps));

    prevDecoded = currDecoded;
    currDecoded = nextDecoded;

    if (j % 100 === 0) process.stdout.write(`  ${j + 1}/${selectedIndices.length}\r`);
  }

  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`\nWrote ${lines.length - 1} rows to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
