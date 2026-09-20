import { Image } from 'react-native';

import { analyzeForm } from '@/services/analysis/PoseFormAnalyzer';
import {
  type FormAnalysis,
  type FormAnalysisResult,
  type ImpactFrameImage,
  type ShotType,
} from '@/types';
import { generateId } from '@/utils/id';

import { sampleFrames } from './frameSampler';
import { inferFrames } from './poseModel';
import { persistFrameImage, persistVideo } from '../video/videoStore';

/**
 * Persists the still the overlay is drawn on, together with its pixel size —
 * the overlay maps normalized keypoints onto that exact aspect ratio.
 * Returns undefined rather than throwing: the pose picture is a nicety, and
 * losing it must not fail an otherwise complete analysis.
 */
async function buildImpactFrame(uri: string): Promise<ImpactFrameImage | undefined> {
  try {
    const persisted = await persistFrameImage(uri);
    const { width, height } = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        Image.getSize(persisted, (w, h) => resolve({ width: w, height: h }), reject);
      }
    );
    return { uri: persisted, widthPx: width, heightPx: height };
  } catch {
    return undefined;
  }
}

export interface AnalyzeClipOptions {
  videoUri: string;
  startSec: number;
  endSec: number;
  shotType: ShotType;
  thumbnailUri?: string;
  /** 0–1 progress, called between steps */
  onProgress?: (progress: number) => void;
}

/**
 * Full pipeline: persist video → sample frames → infer poses → analyse form.
 * Returns a FormAnalysis record ready to store.
 */
export async function analyzeClip(opts: AnalyzeClipOptions): Promise<FormAnalysis> {
  const { videoUri, startSec, endSec, shotType, thumbnailUri, onProgress } = opts;

  onProgress?.(0.02);

  // 1. Persist video so the URI stays valid for future re-analysis
  const persistedUri = await persistVideo(videoUri);
  onProgress?.(0.08);

  // 2. Sample ~20 frames across the clip window
  const FRAME_COUNT = 20;
  const frames = await sampleFrames(persistedUri, startSec, endSec, FRAME_COUNT);
  onProgress?.(0.25);

  // 3. Pose inference — report per-frame progress (0.25 → 0.85)
  const poseFrames = await inferFrames(frames, (p) => {
    onProgress?.(0.25 + p * 0.6);
  });
  onProgress?.(0.88);

  // 4. Swing metrics
  const result: FormAnalysisResult = analyzeForm(poseFrames, shotType);
  onProgress?.(0.92);

  // 5. Keep the impact frame so the result screen can show the pose.
  // inferFrames emits one PoseFrame per sampled frame, so the indices line up.
  const impactFrame = frames[result.impactFrameIndex]
    ? await buildImpactFrame(frames[result.impactFrameIndex].uri)
    : undefined;
  onProgress?.(0.98);

  const now = new Date().toISOString();
  return {
    id: generateId(),
    shotType,
    sourceVideoUri: persistedUri,
    thumbnailUri,
    createdAt: now,
    result: {
      ...result,
      impactKeypoints: poseFrames[result.impactFrameIndex]?.keypoints,
    },
    impactFrame,
    frameCount: poseFrames.length,
    durationSec: endSec - startSec,
  };
}
