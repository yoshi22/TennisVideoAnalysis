import { type ShotType } from './point';

// COCO 17-keypoint names in MoveNet order
export type KeypointName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle';

export interface Keypoint {
  name: KeypointName;
  // Normalized [0, 1] — x: left→right, y: top→bottom (image coords)
  x: number;
  y: number;
  score: number;
}

export interface PoseFrame {
  timeSec: number;
  keypoints: Keypoint[];
}

export type SwingRating = 'good' | 'fair' | 'poor';

export interface SwingMetric {
  id: string;
  label: string;
  value: number;
  unit?: string;
  rating: SwingRating;
  comment: string;
}

export interface FormAnalysisResult {
  shotType: ShotType;
  overallScore: number; // 0–100
  summary: string;
  /** Empty when the player could not be detected clearly enough to measure. */
  metrics: SwingMetric[];
  impactFrameIndex: number; // index into poseFrames[]
  /**
   * Pose at the impact frame. Only this one frame is kept — it is what the
   * result screen draws, and 17 keypoints cost far less than every frame.
   */
  impactKeypoints?: Keypoint[];
}

/** Persisted still of the impact frame, with the size the overlay maps onto. */
export interface ImpactFrameImage {
  uri: string;
  widthPx: number;
  heightPx: number;
}

export interface FormAnalysis {
  id: string;
  shotType: ShotType;
  sourceVideoUri: string;
  thumbnailUri?: string;
  createdAt: string;
  result: FormAnalysisResult;
  /** Still of the impact frame, so the saved result can show the pose. */
  impactFrame?: ImpactFrameImage;
  // Stored as summary only — full frame data is too large to persist
  frameCount: number;
  durationSec: number;
}
