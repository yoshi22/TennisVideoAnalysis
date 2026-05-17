import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { type Keypoint, type KeypointName, type PoseFrame } from '@/types';

import { jpegUriToTensor } from './imageToTensor';
import { type SampledFrame } from './frameSampler';

// COCO 17-keypoint order used by MoveNet
const KEYPOINT_NAMES: KeypointName[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

let _model: TfliteModel | null = null;

export async function getPoseModel(): Promise<TfliteModel> {
  if (_model) return _model;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _model = await loadTensorflowModel(require('../../../assets/models/movenet-lightning.tflite'), [
    'core-ml',
  ]);
  return _model;
}

/**
 * Runs MoveNet on a single JPEG frame URI.
 * MoveNet output layout: [1, 1, 17, 3] — each keypoint is [y, x, score] in [0, 1].
 */
async function inferFrame(frameUri: string, model: TfliteModel): Promise<Keypoint[]> {
  const inputBuffer = await jpegUriToTensor(frameUri);
  const [outputBuffer] = model.runSync([inputBuffer]);
  const out = new Float32Array(outputBuffer);

  const keypoints: Keypoint[] = [];
  for (let k = 0; k < 17; k++) {
    const base = k * 3;
    keypoints.push({
      name: KEYPOINT_NAMES[k],
      y: out[base],
      x: out[base + 1],
      score: out[base + 2],
    });
  }
  return keypoints;
}

/**
 * Runs MoveNet on all sampled frames.
 * Reports progress via the optional callback (0–1).
 */
export async function inferFrames(
  frames: SampledFrame[],
  onProgress?: (progress: number) => void
): Promise<PoseFrame[]> {
  const model = await getPoseModel();
  const poseFrames: PoseFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const keypoints = await inferFrame(frame.uri, model);
    poseFrames.push({ timeSec: frame.timeSec, keypoints });
    onProgress?.((i + 1) / frames.length);
  }

  return poseFrames;
}
