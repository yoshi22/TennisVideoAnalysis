#!/usr/bin/env tsx
/**
 * score-stage1.ts — Compute evaluation metrics by comparing run output to ground truth.
 *
 * Usage:
 *   npm run eval:score -- --run-id <id> --dataset <name> [--baseline-run-id <id>]
 *
 * Reads:  eval/results/<run-id>/per-video/<videoId>.json
 *         eval/datasets/<name>/labels/<videoId>.json
 * Writes: eval/results/<run-id>/metrics.json
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computePerVideoMetrics, aggregateMetrics } from './lib/metrics';
import type {
  EvalMetrics,
  VideoRunResult,
  GroundTruth,
  PerVideoMetrics,
  RegressionGuard,
} from './lib/types';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const runId = get('--run-id');
  const dataset = get('--dataset');
  const baselineRunId = get('--baseline-run-id');
  if (!runId || !dataset) {
    console.error(
      'Usage: npm run eval:score -- --run-id <id> --dataset <name> [--baseline-run-id <id>]'
    );
    process.exit(1);
  }
  return { runId, dataset, baselineRunId };
}

async function main() {
  const { runId, dataset, baselineRunId } = parseArgs();

  const perVideoDir = join('eval', 'results', runId, 'per-video');
  const labelsDir = join('eval', 'datasets', dataset, 'labels');

  if (!existsSync(perVideoDir)) {
    console.error(`No per-video results found at ${perVideoDir}`);
    console.error('Run eval:run1 first.');
    process.exit(1);
  }

  const perVideoMetrics: PerVideoMetrics[] = [];

  const resultFiles = readdirSync(perVideoDir).filter((f) => f.endsWith('.json'));
  for (const f of resultFiles) {
    const videoId = f.replace('.json', '');
    const labelPath = join(labelsDir, `${videoId}.json`);
    if (!existsSync(labelPath)) {
      console.warn(`⚠ No label for ${videoId}, skipping`);
      continue;
    }

    const run = JSON.parse(readFileSync(join(perVideoDir, f), 'utf8')) as VideoRunResult;
    const gt = JSON.parse(readFileSync(labelPath, 'utf8')) as GroundTruth;
    const m = computePerVideoMetrics(run, gt);
    perVideoMetrics.push(m);

    console.log(
      `  ${videoId.padEnd(40)} F1=${m.eventF1.toFixed(3)}  P=${m.eventPrecision.toFixed(3)}  R=${m.eventRecall.toFixed(3)}  IoU=${m.iouMean.toFixed(3)}`
    );
  }

  const agg = aggregateMetrics(perVideoMetrics);
  console.log('\n── Aggregate ──────────────────────────────────────────');
  console.log(`  Event F1:   ${agg.eventF1.toFixed(3)}  (target ≥ 0.85)`);
  console.log(`  Precision:  ${agg.eventPrecision.toFixed(3)}`);
  console.log(`  Recall:     ${agg.eventRecall.toFixed(3)}`);
  console.log(`  IoU mean:   ${agg.iouMean.toFixed(3)}`);
  console.log(`  IoU p10:    ${agg.iouP10.toFixed(3)}`);
  console.log(`  Start MAE:  ${agg.boundaryStartMaeSec.toFixed(2)}s`);
  console.log(`  End MAE:    ${agg.boundaryEndMaeSec.toFixed(2)}s`);
  console.log(`  FP sec/min: ${agg.fpSecondsPerMinute.toFixed(2)}`);

  // Regression guard
  let regressionGuard: RegressionGuard | undefined;
  if (baselineRunId) {
    const baselinePath = join('eval', 'results', baselineRunId, 'metrics.json');
    if (existsSync(baselinePath)) {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalMetrics;
      const deltas: Record<string, number> = {};
      let rejected = false;
      for (const m of perVideoMetrics) {
        const base = baseline.perVideo[m.videoId];
        if (!base) continue;
        const delta = m.eventF1 - base.eventF1;
        deltas[m.videoId] = +delta.toFixed(3);
        if (delta < -0.05) rejected = true;
      }
      regressionGuard = { baselineRunId, perVideoF1Delta: deltas, rejected };
      if (rejected) {
        console.log('\n🚫 REGRESSION GUARD: Some videos degraded > 0.05 F1 vs baseline');
      } else {
        console.log('\n✅ Regression guard passed');
      }
    }
  }

  const metrics: EvalMetrics = {
    runId,
    stage: 1,
    createdAt: new Date().toISOString(),
    perVideo: Object.fromEntries(perVideoMetrics.map((m) => [m.videoId, m])),
    aggregate: agg,
    regressionGuard,
  };

  const metricsPath = join('eval', 'results', runId, 'metrics.json');
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  console.log(`\nMetrics written to ${metricsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
