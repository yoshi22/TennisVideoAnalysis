import { detectBlobs } from '@/services/ball/blobDetect';

function makeMask(width: number, height: number, filled: [number, number][]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of filled) {
    mask[y * width + x] = 1;
  }
  return mask;
}

describe('detectBlobs', () => {
  it('finds one blob for a small circle-like cluster', () => {
    // 5-pixel cross shape ≈ circular, area=5
    const w = 20;
    const h = 20;
    const cx = 10;
    const cy = 10;
    const mask = makeMask(w, h, [
      [cx, cy],
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ]);
    const blobs = detectBlobs(mask, w, h);
    expect(blobs.length).toBe(1);
    expect(Math.abs(blobs[0].imageX - cx / w)).toBeLessThan(0.05);
    expect(Math.abs(blobs[0].imageY - cy / h)).toBeLessThan(0.05);
  });

  it('returns empty array for empty mask', () => {
    const mask = new Uint8Array(100);
    expect(detectBlobs(mask, 10, 10)).toHaveLength(0);
  });

  it('rejects blobs that are too large', () => {
    // 100 pixel-wide square — exceeds MAX_AREA
    const w = 200;
    const h = 200;
    const mask = new Uint8Array(w * h);
    for (let y = 50; y < 150; y++) {
      for (let x = 50; x < 150; x++) {
        mask[y * w + x] = 1;
      }
    }
    expect(detectBlobs(mask, w, h)).toHaveLength(0);
  });

  it('rejects blobs that are too small', () => {
    const w = 20;
    const h = 20;
    const mask = makeMask(w, h, [[5, 5]]);
    expect(detectBlobs(mask, w, h)).toHaveLength(0);
  });

  it('separates two distinct blobs', () => {
    const w = 50;
    const h = 20;
    // Two 5-pixel crosses, far apart
    const points: [number, number][] = [
      [5, 10],
      [4, 10],
      [6, 10],
      [5, 9],
      [5, 11],
      [40, 10],
      [39, 10],
      [41, 10],
      [40, 9],
      [40, 11],
    ];
    const mask = makeMask(w, h, points);
    const blobs = detectBlobs(mask, w, h);
    expect(blobs.length).toBe(2);
  });
});
