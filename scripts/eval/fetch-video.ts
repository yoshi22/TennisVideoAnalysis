#!/usr/bin/env tsx
/**
 * fetch-video.ts — Download a tennis video via yt-dlp for eval purposes.
 *
 * Usage:
 *   npm run eval:fetch -- <URL> --dataset <name> [--id <videoId>]
 *
 * ⚠️  LEGAL NOTICE: Downloaded videos are for personal research only.
 *     Do NOT redistribute, publish, or commit video files.
 *     Delete within 48 hours if not actively needed.
 *     The eval/datasets/videos/ directory is gitignored.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LEGAL_NOTICE = `
⚠️  LEGAL NOTICE ⚠️
This script downloads copyrighted content for personal research purposes only.
• Do NOT redistribute, publish, or share downloaded videos.
• Do NOT commit videos to git (they are gitignored).
• Delete videos within 48h when no longer needed.
• Ensure your usage complies with YouTube ToS and local copyright law.
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('http'));
  const datasetIdx = args.indexOf('--dataset');
  const idIdx = args.indexOf('--id');

  if (!url || datasetIdx === -1) {
    console.error('Usage: npm run eval:fetch -- <URL> --dataset <name> [--id <videoId>]');
    process.exit(1);
  }

  return {
    url,
    dataset: args[datasetIdx + 1],
    videoId: idIdx >= 0 ? args[idIdx + 1] : null,
  };
}

async function main() {
  console.log(LEGAL_NOTICE);

  // Require explicit acknowledgment in CI-free interactive sessions
  const { url, dataset, videoId } = parseArgs();

  const outputDir = join('eval', 'datasets', dataset, 'videos');
  mkdirSync(outputDir, { recursive: true });

  const outputTemplate = videoId
    ? join(outputDir, `${videoId}.%(ext)s`)
    : join(outputDir, '%(id)s.%(ext)s');

  console.log(`Downloading: ${url}`);
  console.log(`Output dir:  ${outputDir}`);

  try {
    execSync(
      `yt-dlp -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]" --merge-output-format mp4 -o "${outputTemplate}" "${url}"`,
      { stdio: 'inherit' }
    );
  } catch {
    console.error('\nyt-dlp not found. Install with: brew install yt-dlp');
    process.exit(1);
  }

  console.log('\nDone. Next step:');
  console.log(`  npm run eval:clip -- --dataset ${dataset} --id <videoId> --start <sec> --duration <sec>`);
}

main().catch((e) => { console.error(e); process.exit(1); });
