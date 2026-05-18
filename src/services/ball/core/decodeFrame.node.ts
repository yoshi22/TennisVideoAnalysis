import { readFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

import { type DecodedFrame } from './types';

const TARGET_WIDTH = 320;

/**
 * Node.js variant of decodeFrameGray — reads a JPEG file path (not a URI)
 * and returns a grayscale pixel buffer resized to TARGET_WIDTH.
 */
export async function decodeFrameGrayNode(filePath: string): Promise<DecodedFrame> {
  const bytes = await readFile(filePath);
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
