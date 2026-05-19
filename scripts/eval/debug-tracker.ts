#!/usr/bin/env tsx
/**
 * debug-tracker.ts — Phase E-3.5 analysis gate.
 * Runs trackAllBalls on a specific time window to verify coherent ball trajectories exist.
 *
 * Usage:
 *   npx tsx scripts/eval/debug-tracker.ts <framesDir> <startSec> <endSec> [--fps <n>]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { computeMotionMask } from '../../src/services/ball/core/frameDiff';
import { removeLargeRegions } from '../../src/services/ball/core/playerMask';
import { detectBlobs } from '../../src/services/ball/core/blobDetect';
import { trackAllBalls } from '../../src/services/ball/core/tracker';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const fps = parseFloat(get('--fps') ?? '30');
  const positional = args.filter((a) => !a.startsWith('--') && a !== get('--fps'));
  if (positional.length < 3) {
    console.error(
      'Usage: npx tsx scripts/eval/debug-tracker.ts <framesDir> <startSec> <endSec> [--fps <n>]'
    );
    process.exit(1);
  }
  return {
    framesDir: positional[0],
    startSec: parseFloat(positional[1]),
    endSec: parseFloat(positional[2]),
    fps,
  };
}

async function main() {
  const { framesDir, startSec, endSec, fps } = parseArgs();
  const step = 1 / fps;

  const allFiles = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort();

  const startIdx = Math.max(0, Math.floor(startSec * fps));
  const endIdx = Math.min(allFiles.length - 1, Math.ceil(endSec * fps));

  console.log(`framesDir: ${framesDir}`);
  console.log(
    `Window: [${startSec}s, ${endSec}s]  frames ${startIdx}..${endIdx}  (${endIdx - startIdx + 1} frames)`
  );

  const framesData: {
    decoded: Awaited<ReturnType<typeof decodeFrameGrayNode>>;
    timeSec: number;
  }[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const fp = join(framesDir, allFiles[i]);
    const decoded = await decodeFrameGrayNode(fp);
    framesData.push({ decoded, timeSec: i * step });
  }

  const frameInputs: { timeSec: number; candidates: ReturnType<typeof detectBlobs> }[] = [];
  for (let i = 1; i < framesData.length - 1; i++) {
    const prev = framesData[i - 1].decoded;
    const curr = framesData[i].decoded;
    const next = framesData[i + 1].decoded;
    const rawMask = computeMotionMask(prev, curr, next);
    const cleanedMask = removeLargeRegions(rawMask, curr.width, curr.height);
    const candidates = detectBlobs(cleanedMask, curr.width, curr.height);
    frameInputs.push({ timeSec: framesData[i].timeSec, candidates });
  }

  const avgCandidates =
    frameInputs.reduce((s, f) => s + f.candidates.length, 0) / frameInputs.length;
  console.log(`  avg candidates/frame: ${avgCandidates.toFixed(1)}`);

  const trajectories = trackAllBalls(frameInputs);

  console.log(`\ntrackAllBalls → ${trajectories.length} trajectories`);
  for (const [i, traj] of trajectories.entries()) {
    const dets = traj.detections;
    const tStart = dets[0].timeSec.toFixed(2);
    const tEnd = dets[dets.length - 1].timeSec.toFixed(2);
    const dur = (dets[dets.length - 1].timeSec - dets[0].timeSec).toFixed(2);
    const xs = dets.map((d) => d.imageX);
    const ys = dets.map((d) => d.imageY);
    const xSpan = (Math.max(...xs) - Math.min(...xs)).toFixed(3);
    const ySpan = (Math.max(...ys) - Math.min(...ys)).toFixed(3);
    console.log(
      `  [${i}] len=${dets.length}  t=[${tStart}s,${tEnd}s]  dur=${dur}s  xSpan=${xSpan}  ySpan=${ySpan}`
    );
  }

  const covered = new Set(
    trajectories.flatMap((t) => t.detections.map((d) => d.timeSec.toFixed(3)))
  ).size;
  console.log(`\nCoverage: ${covered}/${frameInputs.length} frames covered by ≥1 trajectory`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
