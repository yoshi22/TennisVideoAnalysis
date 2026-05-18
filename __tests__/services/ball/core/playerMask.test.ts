import {
  removeLargeRegions,
  LARGE_REGION_MIN_AREA,
  DILATE_RADIUS,
} from '@/services/ball/core/playerMask';

function makeMask(
  width: number,
  height: number,
  rects: [number, number, number, number][]
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

describe('removeLargeRegions', () => {
  it('does not mutate the input mask', () => {
    const w = 40;
    const h = 40;
    const mask = makeMask(w, h, [[5, 5, 25, 25]]);
    const original = mask.slice();
    removeLargeRegions(mask, w, h);
    expect(mask).toEqual(original);
  });

  it('removes a large CC that exceeds minArea', () => {
    const w = 40;
    const h = 40;
    // 20×20 = 400px square — well above default LARGE_REGION_MIN_AREA=200
    const mask = makeMask(w, h, [[5, 5, 24, 24]]);
    const cleaned = removeLargeRegions(mask, w, h, 200, 0);
    // All pixels in the square should be zeroed
    for (let y = 5; y <= 24; y++) {
      for (let x = 5; x <= 24; x++) {
        expect(cleaned[y * w + x]).toBe(0);
      }
    }
  });

  it('keeps a small CC below minArea', () => {
    const w = 40;
    const h = 40;
    // 3×3 = 9px square — well below LARGE_REGION_MIN_AREA
    const mask = makeMask(w, h, [[5, 5, 7, 7]]);
    const cleaned = removeLargeRegions(mask, w, h, 200, 0);
    let kept = 0;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i]) kept++;
    }
    expect(kept).toBe(9);
  });

  it('dilation removes adjacent small blobs', () => {
    const w = 60;
    const h = 60;
    // Large player region: 20×20 = 400px at (0,0)
    // Small blob: 5-pixel cross at (27,5) — 5px to the right of the large region
    const playerRect: [number, number, number, number] = [0, 0, 19, 19];
    const mask = makeMask(w, h, [playerRect]);
    // Add a small cross adjacent to the player (within dilate radius)
    const cx = 25;
    const cy = 10;
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as [number, number][]) {
      mask[(cy + dy) * w + (cx + dx)] = 1;
    }
    // With dilateRadius=6, the 5px-away cross should be erased
    const cleaned = removeLargeRegions(mask, w, h, 200, 6);
    expect(cleaned[cy * w + cx]).toBe(0);
  });

  it('returns empty mask unchanged for empty input', () => {
    const mask = new Uint8Array(100);
    const cleaned = removeLargeRegions(mask, 10, 10);
    expect(cleaned.every((v) => v === 0)).toBe(true);
  });

  it('exports expected default constants', () => {
    expect(LARGE_REGION_MIN_AREA).toBe(200);
    expect(DILATE_RADIUS).toBe(5);
  });
});
