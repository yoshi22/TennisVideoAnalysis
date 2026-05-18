import { File } from 'expo-file-system';
import jpeg from 'jpeg-js';

import { type DecodedFrame } from './core/types';

export type { DecodedFrame } from './core/types';

const TARGET_WIDTH = 320;

/**
 * Reads a JPEG file URI, decodes it, and returns a grayscale pixel buffer
 * resized to TARGET_WIDTH (nearest-neighbor). Keeps aspect ratio.
 * React Native only — use decodeFrame.node.ts for Node environments.
 */
export async function decodeFrameGray(uri: string): Promise<DecodedFrame> {
  const file = new File(uri);
  const bytes = await file.bytes();
  const { data: rgba, width: srcW, height: srcH } = jpeg.decode(bytes, { useTArray: true });

  const scale = TARGET_WIDTH / srcW;
  const dstW = TARGET_WIDTH;
  const dstH = Math.round(srcH * scale);

  const gray = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(Math.floor(x / scale), srcW - 1);
      const srcY = Math.min(Math.floor(y / scale), srcH - 1);
      const idx = (srcY * srcW + srcX) * 4;
      gray[y * dstW + x] = Math.round(
        0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]
      );
    }
  }

  return { gray, width: dstW, height: dstH };
}
