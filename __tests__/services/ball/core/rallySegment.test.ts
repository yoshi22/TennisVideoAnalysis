import { mergeDetectionsIntoWindows } from '../../../../src/services/ball/core/rallySegment';

const DEFAULT_OPTS = {
  minDurationSec: 4,
  maxDurationSec: 30,
  gapToleranceSec: 3,
};

describe('mergeDetectionsIntoWindows', () => {
  it('returns empty for no detections', () => {
    expect(mergeDetectionsIntoWindows([], DEFAULT_OPTS)).toEqual([]);
  });

  it('pads a single window then trims lightly back toward visual activity', () => {
    // 5s raw cluster at t=10-15 -> initial [7,19], refined to [7.5,18].
    const dets = [10, 11, 12, 13, 14, 15];
    const [w] = mergeDetectionsIntoWindows(dets, DEFAULT_OPTS);
    expect(w.startSec).toBeCloseTo(7.5, 1);
    expect(w.endSec).toBeCloseTo(18, 1);
  });

  it('two clusters split by gap > gapTolerance stay as separate windows', () => {
    // cluster A: t=5-10, cluster B: t=20-25, gap=10s > 3s tol
    const a = [5, 6, 7, 8, 9, 10];
    const b = [20, 21, 22, 23, 24, 25];
    const windows = mergeDetectionsIntoWindows([...a, ...b], DEFAULT_OPTS);
    expect(windows).toHaveLength(2);
  });

  it('gap_tol-split clusters are re-merged when padded boundaries overlap', () => {
    // cluster A: t=36-46s, cluster B: t=50-55s.
    // Raw gap = 50-46 = 4s > gapTol=3s → two separate raw clusters, each appended individually.
    // Padding: A padded to [33,50], B padded to [47,59].
    // Padded B.startSec=47 ≤ A.endSec=50 + epsilon → baseline mergeOverlappingWindows re-merges
    // into a single window; visual refinement then trims only the outer quiet padding.
    const a: number[] = [];
    const b: number[] = [];
    for (let t = 36; t <= 46; t++) a.push(t);
    for (let t = 50; t <= 55; t++) b.push(t);
    const windows = mergeDetectionsIntoWindows([...a, ...b], DEFAULT_OPTS);
    expect(windows).toHaveLength(1);
    expect(windows[0].startSec).toBeCloseTo(33.5, 1);
    expect(windows[0].endSec).toBeCloseTo(58, 1);
  });

  it('two clusters split by tiny rounding gap merge correctly', () => {
    // clusters with raw gap < epsilon (0.25s) — should still merge
    const a = [10, 11, 12, 13];
    const b = [13.1, 14, 15, 16, 17]; // gap = 0.1s < epsilon
    const windows = mergeDetectionsIntoWindows([...a, ...b], DEFAULT_OPTS);
    expect(windows).toHaveLength(1);
  });

  it('does not exceed maxDurationSec', () => {
    const longCluster: number[] = [];
    for (let t = 0; t <= 40; t++) longCluster.push(t);
    const [w] = mergeDetectionsIntoWindows(longCluster, DEFAULT_OPTS);
    expect(w.endSec - w.startSec).toBeLessThanOrEqual(30.01);
  });
});
