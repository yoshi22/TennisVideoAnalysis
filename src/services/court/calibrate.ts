import { type CourtCalibration, type ImagePoint } from '@/types/court';
import { computeHomographyDLT } from '@/utils/homography';

// The 4 canonical court corners in court-normalized coordinates:
// near-left, near-right, far-right, far-left (clockwise from bottom-left)
const COURT_CORNERS = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
];

/**
 * Builds a CourtCalibration from 4 user-tapped image corners.
 * Corner order must match: near-left, near-right, far-right, far-left.
 */
export function buildCalibration(
  imageCorners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
  referenceTimeSec: number,
  referenceThumbnailUri?: string
): CourtCalibration {
  const homography = computeHomographyDLT(imageCorners, COURT_CORNERS);
  return {
    imageCorners,
    homography,
    referenceTimeSec,
    referenceThumbnailUri,
    createdAt: new Date().toISOString(),
  };
}
