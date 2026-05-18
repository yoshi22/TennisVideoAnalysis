#!/usr/bin/env tsx
/**
 * visualize.ts — Generate SVG timeline diagrams comparing GT vs detected rallies.
 * Used as input to codex when explaining failure cases.
 *
 * Usage:
 *   npm run eval:viz -- --run-id <id> --dataset <name> [--top-n <n>]
 *
 * Writes: eval/results/<run-id>/timelines/<videoId>.svg
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalMetrics, VideoRunResult, GroundTruth } from './lib/types';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const runId = get('--run-id');
  const dataset = get('--dataset');
  const topN = parseInt(get('--top-n') ?? '3', 10);
  if (!runId || !dataset) {
    console.error('Usage: npm run eval:viz -- --run-id <id> --dataset <name> [--top-n <n>]');
    process.exit(1);
  }
  return { runId, dataset, topN };
}

function buildSVG(videoId: string, run: VideoRunResult, gt: GroundTruth, f1: number): string {
  const W = 1200;
  const TRACK_H = 40;
  const PAD = 60;
  const H = PAD * 2 + TRACK_H * 4;
  const duration = run.videoDurationSec;
  const toX = (s: number) => PAD + (s / duration) * (W - PAD * 2);

  const bars = (
    intervals: Array<{ startSec: number; endSec: number }>,
    y: number,
    color: string,
    label: string
  ) => {
    const rects = intervals.map((iv) => {
      const x1 = toX(iv.startSec);
      const x2 = toX(iv.endSec);
      return `<rect x="${x1.toFixed(1)}" y="${y}" width="${(x2 - x1).toFixed(1)}" height="${TRACK_H}" fill="${color}" opacity="0.75" rx="3"/>`;
    });
    return `<text x="${PAD}" y="${y - 6}" font-size="13" font-family="monospace" fill="#333">${label} (${intervals.length})</text>${rects.join('')}`;
  };

  // 1-second tick marks
  const ticks: string[] = [];
  for (let s = 0; s <= duration; s += 10) {
    const x = toX(s).toFixed(1);
    ticks.push(
      `<line x1="${x}" y1="${PAD - 8}" x2="${x}" y2="${H - PAD + 4}" stroke="#ccc" stroke-width="1"/>`
    );
    ticks.push(
      `<text x="${x}" y="${PAD - 10}" font-size="11" font-family="monospace" fill="#999" text-anchor="middle">${s}s</text>`
    );
  }

  const gtBars = bars(gt.rallies, PAD, '#2196f3', 'GT rallies');
  const detBars = bars(run.detectedRallies, PAD + TRACK_H + 10, '#f44336', 'Detected rallies');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  <text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="bold" font-family="monospace" fill="#111">${videoId} — F1=${f1.toFixed(3)}  dur=${duration.toFixed(0)}s  GT=${gt.rallies.length}  Det=${run.detectedRallies.length}</text>
  ${ticks.join('\n  ')}
  ${gtBars}
  ${detBars}
  <!-- Axis -->
  <line x1="${PAD}" y1="${H - PAD + 4}" x2="${W - PAD}" y2="${H - PAD + 4}" stroke="#999" stroke-width="1"/>
</svg>`;
}

async function main() {
  const { runId, dataset, topN } = parseArgs();

  const metricsPath = join('eval', 'results', runId, 'metrics.json');
  if (!existsSync(metricsPath)) {
    console.error(`metrics.json not found at ${metricsPath}`);
    console.error('Run eval:score first.');
    process.exit(1);
  }

  const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as EvalMetrics;
  const perVideoDir = join('eval', 'results', runId, 'per-video');
  const labelsDir = join('eval', 'datasets', dataset, 'labels');
  const timelinesDir = join('eval', 'results', runId, 'timelines');
  mkdirSync(timelinesDir, { recursive: true });

  // Sort by ascending F1 (worst first)
  const sorted = Object.values(metrics.perVideo).sort((a, b) => a.eventF1 - b.eventF1);
  const targets = sorted.slice(0, topN);

  for (const m of targets) {
    const videoId = m.videoId;
    const runPath = join(perVideoDir, `${videoId}.json`);
    const labelPath = join(labelsDir, `${videoId}.json`);
    if (!existsSync(runPath) || !existsSync(labelPath)) continue;

    const run = JSON.parse(readFileSync(runPath, 'utf8')) as VideoRunResult;
    const gt = JSON.parse(readFileSync(labelPath, 'utf8')) as GroundTruth;

    const svg = buildSVG(videoId, run, gt, m.eventF1);
    const outPath = join(timelinesDir, `${videoId}.svg`);
    writeFileSync(outPath, svg);
    console.log(`  ${videoId}: F1=${m.eventF1.toFixed(3)} → ${outPath}`);
  }

  console.log(`\nTimelines written to eval/results/${runId}/timelines/`);
  console.log('Use these SVGs as input to the codex iteration loop.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
