const MIN_AREA = 3;
const MAX_AREA = 80;
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 2.5;
const MIN_CIRCULARITY = 0.35; // 4πA / P²

export interface BlobCandidate {
  /** Normalized [0,1] image coordinates of blob centroid. */
  imageX: number;
  imageY: number;
  radiusPx: number;
  score: number;
}

/**
 * Two-pass connected component labeling on a binary mask (1=foreground).
 * Returns one BlobCandidate per blob that passes size/shape filters.
 */
export function detectBlobs(mask: Uint8Array, width: number, height: number): BlobCandidate[] {
  const labels = new Int32Array(mask.length).fill(-1);
  const parent: number[] = [];

  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(a: number, b: number): void {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  }

  let nextLabel = 0;

  // First pass
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

  // Second pass — resolve labels
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== -1) labels[i] = find(labels[i]);
  }

  // Accumulate stats per label
  const stats: Map<
    number,
    {
      sumX: number;
      sumY: number;
      area: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      perimeter: number;
    }
  > = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] === -1) continue;
      const lbl = labels[idx];
      if (!stats.has(lbl)) {
        stats.set(lbl, {
          sumX: 0,
          sumY: 0,
          area: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          perimeter: 0,
        });
      }
      const s = stats.get(lbl)!;
      s.sumX += x;
      s.sumY += y;
      s.area++;
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;

      // Count perimeter pixels (has at least one background 4-neighbor)
      const isEdge =
        y === 0 ||
        !mask[(y - 1) * width + x] ||
        y === height - 1 ||
        !mask[(y + 1) * width + x] ||
        x === 0 ||
        !mask[y * width + x - 1] ||
        x === width - 1 ||
        !mask[y * width + x + 1];
      if (isEdge) s.perimeter++;
    }
  }

  const results: BlobCandidate[] = [];

  for (const [, s] of stats) {
    if (s.area < MIN_AREA || s.area > MAX_AREA) continue;

    const bboxW = s.maxX - s.minX + 1;
    const bboxH = s.maxY - s.minY + 1;
    const aspect = bboxW > 0 && bboxH > 0 ? Math.max(bboxW, bboxH) / Math.min(bboxW, bboxH) : 99;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;

    const circularity = s.perimeter > 0 ? (4 * Math.PI * s.area) / s.perimeter ** 2 : 0;
    if (circularity < MIN_CIRCULARITY) continue;

    const cx = s.sumX / s.area;
    const cy = s.sumY / s.area;
    const radius = Math.sqrt(s.area / Math.PI);

    results.push({
      imageX: cx / width,
      imageY: cy / height,
      radiusPx: radius,
      score: Math.min(1, circularity),
    });
  }

  return results;
}
