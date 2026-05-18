// At 320px frame width, a player silhouette covers 200-3000+ motion pixels.
// 200 is well above any single ball-bounce fragment (<80px) while reliably
// catching leg/torso movement visible in amateur fixed-camera footage.
export const LARGE_REGION_MIN_AREA = 200;

// Dilating by 5px removes ball-sized satellite blobs (racket tip, shirt flutter)
// that appear immediately adjacent to the player's motion region.
export const DILATE_RADIUS = 5;

/**
 * Returns a copy of `mask` with all connected components whose area exceeds
 * `minArea` zeroed out (dilated by `dilateRadius` before zeroing).
 *
 * Purpose: on fixed-camera footage, large motion CCs are player silhouettes.
 * Removing them prevents adjacent false ball-sized blobs from triggering
 * rally detection. Pure function — does not mutate input.
 */
export function removeLargeRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number = LARGE_REGION_MIN_AREA,
  dilateRadius: number = DILATE_RADIUS
): Uint8Array {
  const n = width * height;

  // --- Union-Find CCL (single pass with neighbour lookup) ---
  const labels = new Int32Array(n).fill(-1);
  const parent: number[] = [];

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number): void {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  }

  let nextLabel = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;

      const top = y > 0 ? labels[(y - 1) * width + x] : -1;
      const left = x > 0 ? labels[y * width + x - 1] : -1;

      if (top === -1 && left === -1) {
        labels[idx] = nextLabel;
        parent.push(nextLabel);
        nextLabel++;
      } else if (top !== -1 && left === -1) {
        labels[idx] = top;
      } else if (top === -1 && left !== -1) {
        labels[idx] = left;
      } else {
        labels[idx] = Math.min(top, left);
        union(top, left);
      }
    }
  }

  // Resolve labels to roots
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) labels[i] = find(labels[i]);
  }

  // Compute area per root label
  const area = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const lbl = labels[i];
    if (lbl === -1) continue;
    area.set(lbl, (area.get(lbl) ?? 0) + 1);
  }

  // Build a binary "large-region" mask
  const largeRegion = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const lbl = labels[i];
    if (lbl !== -1 && (area.get(lbl) ?? 0) > minArea) {
      largeRegion[i] = 1;
    }
  }

  // Dilate the large-region mask (box-dilate for speed)
  const dilated = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!largeRegion[y * width + x]) continue;
      const y0 = Math.max(0, y - dilateRadius);
      const y1 = Math.min(height - 1, y + dilateRadius);
      const x0 = Math.max(0, x - dilateRadius);
      const x1 = Math.min(width - 1, x + dilateRadius);
      for (let dy = y0; dy <= y1; dy++) {
        for (let dx = x0; dx <= x1; dx++) {
          dilated[dy * width + dx] = 1;
        }
      }
    }
  }

  // Return cleaned mask: zero out anywhere the dilated player region covers
  const cleaned = new Uint8Array(mask);
  for (let i = 0; i < n; i++) {
    if (dilated[i]) cleaned[i] = 0;
  }
  return cleaned;
}
