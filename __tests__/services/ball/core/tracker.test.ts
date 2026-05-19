import {
  trackBall,
  trackAllBalls,
  MAX_JUMP,
  MIN_TRACK_LENGTH,
} from '../../../../src/services/ball/core/tracker';

function makeCand(x: number, y: number) {
  return { imageX: x, imageY: y, radiusPx: 4, score: 0.8 };
}

describe('trackAllBalls', () => {
  it('returns empty array when no frames', () => {
    expect(trackAllBalls([])).toEqual([]);
  });

  it('returns empty when all tracks are shorter than MIN_TRACK_LENGTH', () => {
    // 4 frames — track length 4 < MIN_TRACK_LENGTH=5
    const frames = Array.from({ length: MIN_TRACK_LENGTH - 1 }, (_, i) => ({
      timeSec: i * (1 / 30),
      candidates: [makeCand(0.5, 0.5)],
    }));
    expect(trackAllBalls(frames)).toEqual([]);
  });

  it('returns a single trajectory when one track meets MIN_TRACK_LENGTH', () => {
    const frames = Array.from({ length: MIN_TRACK_LENGTH }, (_, i) => ({
      timeSec: i * (1 / 30),
      candidates: [makeCand(0.3 + i * 0.01, 0.5)],
    }));
    const result = trackAllBalls(frames);
    expect(result).toHaveLength(1);
    expect(result[0].detections).toHaveLength(MIN_TRACK_LENGTH);
  });

  it('returns ALL completed tracks, not just the longest', () => {
    // Two separate tracks: A moves near x=0.2, B moves near x=0.8
    // They are far apart (gap >> MAX_JUMP) so the tracker keeps them separate
    const frames: { timeSec: number; candidates: ReturnType<typeof makeCand>[] }[] = [];
    for (let i = 0; i < MIN_TRACK_LENGTH + 2; i++) {
      const t = i * (1 / 30);
      frames.push({
        timeSec: t,
        candidates: [makeCand(0.2 + i * 0.001, 0.3), makeCand(0.8 + i * 0.001, 0.7)],
      });
    }
    const result = trackAllBalls(frames);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('trackBall still returns only the longest track (unchanged)', () => {
    const frames: { timeSec: number; candidates: ReturnType<typeof makeCand>[] }[] = [];
    for (let i = 0; i < MIN_TRACK_LENGTH + 2; i++) {
      frames.push({
        timeSec: i * (1 / 30),
        candidates: [makeCand(0.2 + i * 0.001, 0.3), makeCand(0.8 + i * 0.001, 0.7)],
      });
    }
    const single = trackBall(frames);
    expect(single.detections.length).toBeGreaterThanOrEqual(MIN_TRACK_LENGTH);
    // trackBall returns exactly one trajectory (the longest)
    expect(Array.isArray(single.detections)).toBe(true);
  });

  it('treats blobs separated by more than MAX_JUMP as separate tracks', () => {
    // frame 0: blob at x=0.1. frame 1: blob at x=0.1+MAX_JUMP*2 (too far to link)
    const frames = [
      { timeSec: 0, candidates: [makeCand(0.1, 0.5)] },
      { timeSec: 1 / 30, candidates: [makeCand(0.1 + MAX_JUMP * 2, 0.5)] },
    ];
    // Both tracks are length 1 < MIN_TRACK_LENGTH, so nothing completed
    const result = trackAllBalls(frames);
    expect(result).toHaveLength(0);
  });
});
