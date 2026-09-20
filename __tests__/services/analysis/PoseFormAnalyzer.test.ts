import { analyzeForm } from '@/services/analysis/PoseFormAnalyzer';
import { type Keypoint, type KeypointName, type PoseFrame } from '@/types/pose';

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

function makeFrames(score: number, count = 20): PoseFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    timeSec: index * 0.1,
    keypoints: KEYPOINT_NAMES.map<Keypoint>((name, kpIndex) => ({
      name,
      // Spread points apart so angle/distance maths stays well-defined.
      x: 0.3 + (kpIndex % 4) * 0.1,
      y: 0.1 + kpIndex * 0.04 + index * 0.005,
      score,
    })),
  }));
}

describe('analyzeForm', () => {
  it('reports no score when every keypoint is below the confidence floor', () => {
    // A wide shot where the player is a few pixels tall produces exactly this:
    // MoveNet still returns 17 points, all with low scores.
    const result = analyzeForm(makeFrames(0.05), 'forehand');

    expect(result.metrics).toHaveLength(0);
    expect(result.overallScore).toBe(0);
    expect(result.summary).toContain('検出できませんでした');
  });

  it('scores the swing when keypoints are confident', () => {
    const result = analyzeForm(makeFrames(0.9), 'forehand');

    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.summary).not.toContain('検出できませんでした');
  });

  it('returns a neutral result for an empty clip', () => {
    const result = analyzeForm([], 'serve');

    expect(result.metrics).toHaveLength(0);
    expect(result.overallScore).toBe(0);
  });
});
