import { type DecodedFrame } from './decodeFrame';

const DIFF_THRESHOLD = 25; // grayscale intensity delta to consider "changed"

/**
 * Computes a binary motion mask from 3 consecutive frames using the AND of:
 *   |f_t - f_(t-1)| > threshold  AND  |f_(t+1) - f_t| > threshold
 *
 * This suppresses stationary noise while retaining fast-moving objects.
 * All three frames must have the same dimensions.
 */
export function computeMotionMask(
  prev: DecodedFrame,
  curr: DecodedFrame,
  next: DecodedFrame
): Uint8Array {
  const n = curr.gray.length;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d1 = Math.abs(curr.gray[i] - prev.gray[i]);
    const d2 = Math.abs(next.gray[i] - curr.gray[i]);
    mask[i] = d1 > DIFF_THRESHOLD && d2 > DIFF_THRESHOLD ? 1 : 0;
  }
  return mask;
}
