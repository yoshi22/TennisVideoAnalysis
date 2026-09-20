import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

import { type DecodedFrame } from './core/types';

export type { DecodedFrame } from './core/types';

const TARGET_WIDTH = 320;

/**
 * Reads a JPEG file URI, decodes it, and returns a grayscale pixel buffer
 * resized to TARGET_WIDTH (nearest-neighbor). Keeps aspect ratio.
 * React Native only — use decodeFrame.node.ts for Node environments.
 *
 * The frame is shrunk natively before it reaches jpeg-js. Decoding is pure
 * JavaScript and costs time proportional to the source pixel count, so
 * decoding a 1280x720 still only to throw away 93% of it dominated the whole
 * rally scan. Resizing first makes that step roughly an order of magnitude
 * cheaper; the native resize is a fraction of what it saves.
 */
export async function decodeFrameGray(uri: string): Promise<DecodedFrame> {
  const bytes = await readResizedJpeg(uri);
  const { data: rgba, width: srcW, height: srcH } = jpeg.decode(bytes, { useTArray: true });

  // Already at or below the target width in the common path, but a fallback to
  // the original file (see readResizedJpeg) can still arrive full size.
  const scale = Math.min(TARGET_WIDTH / srcW, 1);
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

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

/**
 * Returns the frame as JPEG bytes no wider than TARGET_WIDTH. Falls back to the
 * untouched file if the native resize fails, so a scan degrades in speed rather
 * than losing the frame.
 */
async function readResizedJpeg(uri: string): Promise<Uint8Array> {
  try {
    const image = await ImageManipulator.manipulate(uri)
      .resize({ width: TARGET_WIDTH })
      .renderAsync();
    const resized = await image.saveAsync({ compress: 1, format: SaveFormat.JPEG });
    const bytes = await new File(resized.uri).bytes();
    // The manipulator writes to the cache directory; nothing else reads this file.
    try {
      new File(resized.uri).delete();
    } catch {
      // Cache cleanup is best effort.
    }
    return bytes;
  } catch {
    return new File(uri).bytes();
  }
}
