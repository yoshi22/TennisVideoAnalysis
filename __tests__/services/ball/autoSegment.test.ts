// Tests for the rally window merge logic extracted from autoSegment.ts.
// Uses a local copy of the merge function to test pure logic without video I/O.

function mergeWindows(
  detections: number[],
  gapToleranceSec = 0.5,
  minDurationSec = 2,
  maxDurationSec = 30
): { startSec: number; endSec: number }[] {
  if (detections.length === 0) return [];

  const windows: { startSec: number; endSec: number }[] = [];
  let start = detections[0];
  let end = detections[0];

  for (let i = 1; i < detections.length; i++) {
    const t = detections[i];
    if (t - end <= gapToleranceSec) {
      end = t;
    } else {
      if (end - start >= minDurationSec) {
        windows.push({ startSec: start, endSec: Math.min(start + maxDurationSec, end) });
      }
      start = t;
      end = t;
    }
  }
  if (end - start >= minDurationSec) {
    windows.push({ startSec: start, endSec: Math.min(start + maxDurationSec, end) });
  }
  return windows;
}

// Generate evenly-spaced detections at given fps
function dets(startSec: number, endSec: number, fps = 10): number[] {
  const step = 1 / fps;
  const result: number[] = [];
  for (let t = startSec; t <= endSec + 0.001; t += step) {
    result.push(Math.round(t * 1000) / 1000);
  }
  return result;
}

describe('rally window merge logic', () => {
  it('returns empty for no detections', () => {
    expect(mergeWindows([])).toEqual([]);
  });

  it('single cluster → one window', () => {
    // 5s cluster at 10fps — all gaps 0.1s, tolerance 0.5s
    const windows = mergeWindows(dets(1, 6));
    expect(windows).toHaveLength(1);
    expect(windows[0].startSec).toBeCloseTo(1, 1);
    expect(windows[0].endSec).toBeCloseTo(6, 1);
  });

  it('two clusters separated by > tolerance → two windows', () => {
    // cluster A: 0–4s, cluster B: 10–14s, gap = 6s > 0.5s tolerance
    const windows = mergeWindows([...dets(0, 4), ...dets(10, 14)]);
    expect(windows).toHaveLength(2);
    expect(windows[0].startSec).toBeCloseTo(0, 1);
    expect(windows[1].startSec).toBeCloseTo(10, 1);
  });

  it('gap within tolerance merges into one window', () => {
    // cluster A: 0–3s, gap 0.3s, cluster B: 3.3–6.3s — total should merge
    const windows = mergeWindows([...dets(0, 3), ...dets(3.3, 6.3)], 0.5, 2);
    expect(windows).toHaveLength(1);
    expect(windows[0].endSec).toBeGreaterThan(6);
  });

  it('short window below minDuration is excluded', () => {
    // 1s cluster < minDuration 2s
    const windows = mergeWindows(dets(5, 6), 0.5, 2);
    expect(windows).toHaveLength(0);
  });

  it('clamps window end to maxDurationSec from start', () => {
    const longCluster = dets(0, 45); // 45s at 10fps
    const windows = mergeWindows(longCluster, 0.5, 2, 30);
    expect(windows).toHaveLength(1);
    expect(windows[0].endSec - windows[0].startSec).toBeLessThanOrEqual(30.01);
  });

  it('three separate clusters → three windows', () => {
    const windows = mergeWindows([...dets(0, 3), ...dets(10, 13), ...dets(20, 23)]);
    expect(windows).toHaveLength(3);
    expect(windows[2].startSec).toBeCloseTo(20, 1);
  });

  it('exactly at minDuration boundary is included', () => {
    // Exactly 2.0s window (inclusive)
    const windows = mergeWindows(dets(0, 2), 0.5, 2);
    expect(windows).toHaveLength(1);
  });
});
