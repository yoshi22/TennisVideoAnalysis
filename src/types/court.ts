export type CourtArea =
  | 'deuce-service-box'
  | 'ad-service-box'
  | 'deuce-baseline'
  | 'ad-baseline'
  | 'net-area'
  | 'out';

export interface CourtAreaStat {
  area: CourtArea;
  count: number;
  wonCount: number;
}

// ---------------------------------------------------------------------------
// Court calibration — Phase 3
// ---------------------------------------------------------------------------

/** Image coordinate normalized to [0,1] relative to image width/height. */
export interface ImagePoint {
  x: number;
  y: number;
}

/** Court coordinate normalized to [0,1] (left=0→right=1, near=0→far=1). */
export interface CourtPoint {
  x: number;
  y: number;
}

/**
 * Homography-based court calibration produced by user tapping 4 court corners.
 * Corner order: near-left, near-right, far-right, far-left (clockwise from bottom-left).
 */
export interface CourtCalibration {
  imageCorners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  /** 3×3 homography matrix (image→court) stored row-major as 9 elements. */
  homography: number[];
  /** Video timestamp (seconds) of the reference still frame. */
  referenceTimeSec: number;
  /** JPEG URI of the reference frame thumbnail (optional, for UI display). */
  referenceThumbnailUri?: string;
  createdAt: string;
}
