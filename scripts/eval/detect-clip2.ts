#!/usr/bin/env tsx
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFrameGrayNode } from '../../src/services/ball/core/decodeFrame.node';
import { detectRallyWindowsFromFrames } from '../../src/services/ball/core/rallySegment';

async function main() {
  const framesDir = 'eval/datasets/fixed-camera-v1/frames/yt-maitou-suzumura-muko-clip2';
  const videoDurationSec = 600;

  const framePaths = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(framesDir, f));

  const step = videoDurationSec / Math.max(framePaths.length - 1, 1);
  const frames = await Promise.all(
    framePaths.map(async (fp, i) => ({
      decoded: await decodeFrameGrayNode(fp),
      timeSec: i * step,
    }))
  );

  const windows = detectRallyWindowsFromFrames(frames);
  console.log(`Detected ${windows.length} windows:`);
  for (const w of windows) {
    console.log(
      JSON.stringify({
        start: +w.startSec.toFixed(2),
        end: +w.endSec.toFixed(2),
        conf: +w.confidence.toFixed(3),
      })
    );
  }
}
main().catch(console.error);
