/** 2D point. */
interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Gauss-Jordan elimination — solves Ax = b for a square matrix
// Returns null if the matrix is singular.
// ---------------------------------------------------------------------------

function gaussJordan(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix [A | b]
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null; // singular
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

// ---------------------------------------------------------------------------
// DLT — compute 3×3 homography from 4 point correspondences
// src[i] → dst[i]
// Returns the 9-element row-major matrix H such that dst ~= H * src (homogeneous).
// ---------------------------------------------------------------------------

export function computeHomographyDLT(src: Pt[], dst: Pt[]): number[] {
  if (src.length < 4 || dst.length < 4) throw new Error('DLT requires at least 4 point pairs');

  // Build 8×8 linear system (h33 = 1 convention)
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];

    // Row for x equation
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    // Row for y equation
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const h = gaussJordan(A, b);
  if (!h) throw new Error('Degenerate point configuration — cannot compute homography');

  // h = [h11,h12,h13,h21,h22,h23,h31,h32], h33=1
  return [...h, 1];
}

// ---------------------------------------------------------------------------
// Apply homography to a single point
// ---------------------------------------------------------------------------

export function applyHomography(matrix: number[], pt: Pt): Pt {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = matrix;
  const w = h31 * pt.x + h32 * pt.y + h33;
  if (Math.abs(w) < 1e-12) throw new Error('Homography: point maps to infinity');
  return {
    x: (h11 * pt.x + h12 * pt.y + h13) / w,
    y: (h21 * pt.x + h22 * pt.y + h23) / w,
  };
}

// ---------------------------------------------------------------------------
// Invert a 3×3 matrix (needed for inverse projection)
// ---------------------------------------------------------------------------

export function invertMatrix3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, k] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('Homography matrix is singular — cannot invert');
  const inv = 1 / det;
  return [
    (e * k - f * h) * inv,
    (c * h - b * k) * inv,
    (b * f - c * e) * inv,
    (f * g - d * k) * inv,
    (a * k - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}
