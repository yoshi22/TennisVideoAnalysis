import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { EvalMetrics, PerVideoMetrics } from './types';

export interface CodexHandoffContext {
  stage: 1 | 2 | 3;
  currentMetrics: EvalMetrics;
  baselineMetrics?: EvalMetrics;
  failingVideos: PerVideoMetrics[];
  /** SVG content keyed by videoId */
  svgTimelines?: Record<string, string>;
  allowedFiles: string[];
  forbiddenFiles: string[];
  constraints: string[];
}

/**
 * Builds a structured JSON prompt for a codex session.
 * Paste or stream to mcp__codex__codex as the `prompt` field.
 */
export function buildCodexPrompt(ctx: CodexHandoffContext): string {
  const {
    stage,
    currentMetrics,
    baselineMetrics,
    failingVideos,
    svgTimelines,
    allowedFiles,
    forbiddenFiles,
    constraints,
  } = ctx;

  const metricsDiff = baselineMetrics
    ? {
        eventF1Delta: +(
          currentMetrics.aggregate.eventF1 - baselineMetrics.aggregate.eventF1
        ).toFixed(3),
        iouMeanDelta: +(
          currentMetrics.aggregate.iouMean - baselineMetrics.aggregate.iouMean
        ).toFixed(3),
      }
    : null;

  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* ignore */
  }

  const prompt = {
    task: `Improve Stage ${stage} rally detection accuracy in CourtLens`,
    gitSha,
    currentAggregate: currentMetrics.aggregate,
    baselineDiff: metricsDiff,
    failingVideos: failingVideos.map((v) => ({
      videoId: v.videoId,
      eventF1: v.eventF1,
      eventPrecision: v.eventPrecision,
      eventRecall: v.eventRecall,
      iouMean: v.iouMean,
      boundaryStartMaeSec: v.boundaryStartMaeSec,
      boundaryEndMaeSec: v.boundaryEndMaeSec,
      fpSecondsPerMinute: v.fpSecondsPerMinute,
      rallyCountTrue: v.rallyCountTrue,
      rallyCountDetected: v.rallyCountDetected,
    })),
    svgTimelines: svgTimelines ?? {},
    allowedFiles,
    forbiddenFiles,
    constraints: [
      'npm run type-check && npm run lint && npm test must all pass after changes',
      'No magic numbers: extract all thresholds as named constants with comments',
      'Do not overfit to the failing videos — improvements must generalize',
      'Only modify files in allowedFiles',
      ...constraints,
    ],
    targetMetrics: {
      eventF1: '≥ 0.85 (dev set mean)',
      boundaryP90Sec: '< 2.0',
    },
  };

  return JSON.stringify(prompt, null, 2);
}

/**
 * Reads an existing EvalMetrics JSON from disk.
 */
export function loadMetrics(metricsPath: string): EvalMetrics {
  return JSON.parse(readFileSync(metricsPath, 'utf8')) as EvalMetrics;
}
