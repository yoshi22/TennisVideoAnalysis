#!/usr/bin/env tsx
/**
 * Detector-assisted label pre-fill tool.
 *
 * Reads an existing detector run (VideoRunResult) and writes a DRAFT label JSON
 * that the user can correct manually before committing as ground-truth.
 *
 * Usage:
 *   npm run eval:prefill -- --run-id <run-id> --clip-id <clip-id> [--dataset fixed-camera-v2]
 *
 * Workflow:
 *   1. Run the blob detector: npm run eval:run1 -- --run-id draft-<clip-id> --dataset <dataset>
 *   2. Pre-fill: npm run eval:prefill -- --run-id draft-<clip-id> --clip-id <clip-id>
 *   3. Open eval/datasets/<dataset>/labels/<clip-id>_DRAFT.json and correct boundaries.
 *   4. Remove the _DRAFT suffix when the labels are accurate.
 *   5. Validate: python3.11 scripts/eval/validate-rally-labels.py --dataset <dataset>
 *
 * IMPORTANT: Detector-assisted labels are for TRAINING clips only.
 * Held-out (test) clips must be labeled from scratch without detector pre-fill
 * to keep the evaluation unbiased.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

const BASE = path.resolve(__dirname, '..', '..');
const DATASETS_DIR = path.join(BASE, 'eval', 'datasets');
const RESULTS_DIR = path.join(BASE, 'eval', 'results');

interface DetectedRallyWindow {
  startSec: number;
  endSec: number;
  confidence: number;
}

interface VideoRunResult {
  videoId: string;
  videoDurationSec: number;
  scanFps: number;
  detectedRallies: DetectedRallyWindow[];
  runtimeMs: number;
}

interface CandidateClip {
  clipId: string;
  sourceVideoId: string;
  offsetSec: number;
  durationSec?: number;
  status?: string;
  notes?: string;
}

interface CandidateVideo {
  id: string;
  url?: string;
  selectedClips?: CandidateClip[];
}

interface CandidatesJson {
  candidateVideos?: CandidateVideo[];
  seedClips?: CandidateClip[];
}

interface DraftRally {
  startSec: number;
  endSec: number;
  server: null;
  winner: null;
  endReason: null;
}

interface DraftLabel {
  schemaVersion: 1;
  videoId: string;
  sourceUrl: string;
  sourceSha256: string;
  fps: number;
  clipOffsetSec: number;
  clipDurationSec: number;
  note: string;
  rallies: DraftRally[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function findCandidateInfo(
  candidates: CandidatesJson,
  clipId: string
): { sourceUrl: string; clipOffsetSec: number; clipDurationSec: number } | null {
  for (const video of candidates.candidateVideos ?? []) {
    for (const clip of video.selectedClips ?? []) {
      if (clip.clipId === clipId) {
        return {
          sourceUrl: video.url ?? '',
          clipOffsetSec: clip.offsetSec ?? 0,
          clipDurationSec: clip.durationSec ?? 0,
        };
      }
    }
  }
  return null;
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'run-id': { type: 'string' },
      'clip-id': { type: 'string' },
      dataset: { type: 'string', default: 'fixed-camera-v2' },
      fps: { type: 'string', default: '30' },
      'min-confidence': { type: 'string', default: '0' },
    },
  });

  const runId = values['run-id'];
  const clipId = values['clip-id'];
  const dataset = values['dataset'] ?? 'fixed-camera-v2';
  const fps = Number(values['fps'] ?? '30');
  const minConfidence = Number(values['min-confidence'] ?? '0');

  if (!runId || !clipId) {
    console.error(
      'Usage: npm run eval:prefill -- --run-id <run-id> --clip-id <clip-id> [--dataset fixed-camera-v2]'
    );
    process.exit(1);
  }

  // Load VideoRunResult
  const resultPath = path.join(RESULTS_DIR, runId, 'per-video', `${clipId}.json`);
  if (!fs.existsSync(resultPath)) {
    console.error(`Run result not found: ${resultPath}`);
    console.error(
      `Run the detector first: npm run eval:run1 -- --run-id ${runId} --dataset ${dataset}`
    );
    process.exit(1);
  }
  const result = readJson<VideoRunResult>(resultPath);

  // Load candidates metadata
  const candidatesPath = path.join(DATASETS_DIR, dataset, 'candidates.json');
  let candidateInfo: ReturnType<typeof findCandidateInfo> = null;
  if (fs.existsSync(candidatesPath)) {
    const candidates = readJson<CandidatesJson>(candidatesPath);
    candidateInfo = findCandidateInfo(candidates, clipId);
  }

  // Prefer metadata from existing stub label (written by add-new-clip.py) over candidates.json.
  // New clips won't be in candidates.json, so this is the only reliable source.
  const stubLabelPath = path.join(DATASETS_DIR, dataset, 'labels', `${clipId}.json`);
  const stubLabel = fs.existsSync(stubLabelPath)
    ? readJson<Partial<DraftLabel>>(stubLabelPath)
    : null;

  const clipOffsetSec =
    stubLabel != null ? (stubLabel.clipOffsetSec ?? 0) : (candidateInfo?.clipOffsetSec ?? 0);
  const clipDurationSec =
    stubLabel != null && (stubLabel.clipDurationSec ?? 0) > 0
      ? stubLabel.clipDurationSec!
      : candidateInfo != null && (candidateInfo.clipDurationSec ?? 0) > 0
        ? (candidateInfo.clipDurationSec ?? result.videoDurationSec)
        : result.videoDurationSec;
  const sourceUrl =
    stubLabel != null ? (stubLabel.sourceUrl ?? '') : (candidateInfo?.sourceUrl ?? '');

  // Filter by confidence and convert to rally format
  const rallies: DraftRally[] = result.detectedRallies
    .filter((r) => r.confidence >= minConfidence)
    .map((r) => ({
      startSec: Math.max(0, Math.round(r.startSec * 10) / 10),
      endSec: Math.min(clipDurationSec, Math.round(r.endSec * 10) / 10),
      server: null,
      winner: null,
      endReason: null,
    }));

  const draftLabel: DraftLabel = {
    schemaVersion: 1,
    videoId: clipId,
    sourceUrl,
    sourceSha256: '',
    fps,
    clipOffsetSec,
    clipDurationSec,
    note: [
      `DETECTOR-ASSISTED DRAFT — generated from run "${runId}" (blob detector, confidence≥${minConfidence}).`,
      'This file must be manually reviewed and corrected before use as ground truth.',
      'Adjust rally boundaries to ±1–2s accuracy by watching the source video.',
      'Remove _DRAFT from the filename when the labels are accurate.',
      `TRAINING USE ONLY: held-out test clips must be labeled without detector pre-fill.`,
    ].join(' '),
    rallies,
  };

  // Write draft
  const labelsDir = path.join(DATASETS_DIR, dataset, 'labels');
  fs.mkdirSync(labelsDir, { recursive: true });
  const outPath = path.join(labelsDir, `${clipId}_DRAFT.json`);
  fs.writeFileSync(outPath, JSON.stringify(draftLabel, null, 2) + '\n', 'utf8');

  console.log(`\nWrote ${rallies.length} rally windows to: ${outPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open ${outPath} and correct rally boundaries by watching the video.`);
  console.log(`  2. Rename to ${clipId}.json when done.`);
  console.log(`  3. Run: python3.11 scripts/eval/validate-rally-labels.py --dataset ${dataset}`);
  console.log(
    `\n⚠️  TRAINING USE ONLY — do not use detector-assisted labels for held-out evaluation.`
  );

  if (rallies.length === 0) {
    console.warn(
      `\nWarning: no rallies above confidence=${minConfidence}. Try --min-confidence 0.`
    );
  }
}

main();
