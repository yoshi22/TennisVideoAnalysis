#!/usr/bin/env tsx
/**
 * clip-video.ts — Cut a 5-10 minute dense-rally section from a downloaded video.
 *
 * Usage:
 *   npm run eval:clip -- --dataset <name> --id <videoId> --start <sec> --duration <sec>
 *
 * Output: eval/datasets/<name>/clips/<videoId>.mp4
 * The clipOffsetSec written here must match the value in the label JSON.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  const dataset = get('--dataset');
  const id = get('--id');
  const startStr = get('--start');
  const durationStr = get('--duration');

  if (!dataset || !id || !startStr || !durationStr) {
    console.error(
      'Usage: npm run eval:clip -- --dataset <name> --id <videoId> --start <sec> --duration <sec>'
    );
    process.exit(1);
  }

  return {
    dataset,
    videoId: id,
    startSec: parseFloat(startStr),
    durationSec: parseFloat(durationStr),
  };
}

async function main() {
  const { dataset, videoId, startSec, durationSec } = parseArgs();

  const videoPath = join('eval', 'datasets', dataset, 'videos', `${videoId}.mp4`);
  const clipsDir = join('eval', 'datasets', dataset, 'clips');
  const outputPath = join(clipsDir, `${videoId}.mp4`);

  if (!existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    console.error('Run eval:fetch first.');
    process.exit(1);
  }

  mkdirSync(clipsDir, { recursive: true });

  console.log(`Clipping ${videoId}: ${startSec}s + ${durationSec}s → ${outputPath}`);
  execSync(
    `ffmpeg -y -ss ${startSec} -t ${durationSec} -i "${videoPath}" -c copy "${outputPath}"`,
    { stdio: 'inherit' }
  );

  console.log(`\nClip saved: ${outputPath}`);
  console.log(`Remember to set "clipOffsetSec": ${startSec} in your label JSON.`);
  console.log(`Next: npm run eval:frames -- --dataset ${dataset} --id ${videoId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
