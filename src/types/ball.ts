import { type CourtPoint, type ImagePoint } from './court';

export interface BallDetection {
  timeSec: number;
  /** Normalized image coordinate [0,1]. */
  imageX: number;
  /** Normalized image coordinate [0,1]. */
  imageY: number;
  /** Approximate radius in pixels at the detection-frame scale. */
  radiusPx: number;
  confidence: number;
}

export interface BallTrajectory {
  detections: BallDetection[];
}

export interface Bounce {
  timeSec: number;
  imagePoint: ImagePoint;
  courtPoint: CourtPoint;
  /** Whether the bounce landed within the court boundaries. */
  inBounds: boolean;
}
