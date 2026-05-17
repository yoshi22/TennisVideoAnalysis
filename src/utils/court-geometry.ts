import { type CourtCalibration, type CourtPoint, type ImagePoint } from '@/types/court';

import { applyHomography, invertMatrix3x3 } from './homography';

// コートSVG座標（ピクセル）↔ 正規化座標（0-1）の変換ユーティリティ
export interface NormalizedPoint {
  x: number; // 0..1 (左=0, 右=1)
  y: number; // 0..1 (手前=0, 奥=1)
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function toNormalized(canvas: CanvasPoint, width: number, height: number): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, canvas.x / width)),
    y: Math.max(0, Math.min(1, canvas.y / height)),
  };
}

export function toCanvas(normalized: NormalizedPoint, width: number, height: number): CanvasPoint {
  return {
    x: normalized.x * width,
    y: normalized.y * height,
  };
}

export function distanceBetween(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ---------------------------------------------------------------------------
// Homography-based image ↔ court coordinate projection — Phase 3
// ---------------------------------------------------------------------------

/**
 * Projects a normalized image point to normalized court coordinates
 * using the calibration homography.
 */
export function projectImageToCourt(image: ImagePoint, calibration: CourtCalibration): CourtPoint {
  return applyHomography(calibration.homography, image);
}

/**
 * Projects a normalized court point back to normalized image coordinates
 * using the inverse of the calibration homography.
 */
export function projectCourtToImage(court: CourtPoint, calibration: CourtCalibration): ImagePoint {
  const inv = invertMatrix3x3(calibration.homography);
  return applyHomography(inv, court);
}

/**
 * Returns true when `point` lies within the court boundaries [0,1]×[0,1],
 * with an optional inward margin (positive = shrink boundary, negative = expand).
 */
export function isInCourtBounds(point: CourtPoint, margin: number = 0): boolean {
  const lo = margin;
  const hi = 1 - margin;
  return point.x >= lo && point.x <= hi && point.y >= lo && point.y <= hi;
}
