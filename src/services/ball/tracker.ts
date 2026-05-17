import { type BallDetection, type BallTrajectory } from '@/types/ball';

import { type BlobCandidate } from './blobDetect';

const MAX_JUMP = 0.08; // max normalized-distance between frames (image coords)
const MIN_TRACK_LENGTH = 5; // discard tracks shorter than this

interface FrameInput {
  timeSec: number;
  candidates: BlobCandidate[];
}

interface Track {
  detections: BallDetection[];
  lastX: number;
  lastY: number;
  vx: number; // velocity (image coords / sec)
  vy: number;
  lastTime: number;
}

/**
 * Greedy nearest-neighbor tracker across frames.
 * Returns the longest plausible ball trajectory.
 */
export function trackBall(frames: FrameInput[]): BallTrajectory {
  const tracks: Track[] = [];
  const completedTracks: BallDetection[][] = [];

  for (const frame of frames) {
    const matched = new Set<Track>();

    for (const cand of frame.candidates) {
      let bestTrack: Track | null = null;
      let bestDist = MAX_JUMP;

      for (const track of tracks) {
        // Predict position using velocity
        const dt = frame.timeSec - track.lastTime;
        const predX = track.lastX + track.vx * dt;
        const predY = track.lastY + track.vy * dt;
        const d = Math.sqrt((cand.imageX - predX) ** 2 + (cand.imageY - predY) ** 2);
        if (d < bestDist) {
          bestDist = d;
          bestTrack = track;
        }
      }

      if (bestTrack && !matched.has(bestTrack)) {
        matched.add(bestTrack);
        const dt = frame.timeSec - bestTrack.lastTime;
        if (dt > 0) {
          bestTrack.vx = (cand.imageX - bestTrack.lastX) / dt;
          bestTrack.vy = (cand.imageY - bestTrack.lastY) / dt;
        }
        bestTrack.lastX = cand.imageX;
        bestTrack.lastY = cand.imageY;
        bestTrack.lastTime = frame.timeSec;
        bestTrack.detections.push({
          timeSec: frame.timeSec,
          imageX: cand.imageX,
          imageY: cand.imageY,
          radiusPx: cand.radiusPx,
          confidence: cand.score,
        });
      } else {
        // Start new track
        tracks.push({
          detections: [
            {
              timeSec: frame.timeSec,
              imageX: cand.imageX,
              imageY: cand.imageY,
              radiusPx: cand.radiusPx,
              confidence: cand.score,
            },
          ],
          lastX: cand.imageX,
          lastY: cand.imageY,
          vx: 0,
          vy: 0,
          lastTime: frame.timeSec,
        });
      }
    }

    // Expire tracks that weren't matched
    const alive: Track[] = [];
    for (const track of tracks) {
      if (matched.has(track)) {
        alive.push(track);
      } else {
        if (track.detections.length >= MIN_TRACK_LENGTH) {
          completedTracks.push(track.detections);
        }
      }
    }
    tracks.length = 0;
    tracks.push(...alive);
  }

  // Flush remaining tracks
  for (const track of tracks) {
    if (track.detections.length >= MIN_TRACK_LENGTH) {
      completedTracks.push(track.detections);
    }
  }

  if (completedTracks.length === 0) return { detections: [] };

  // Return the longest track
  const best = completedTracks.reduce((a, b) => (a.length >= b.length ? a : b));
  return { detections: best };
}
