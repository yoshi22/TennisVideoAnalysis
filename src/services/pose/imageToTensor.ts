import { File } from 'expo-file-system';
import jpeg from 'jpeg-js';

const MODEL_INPUT_SIZE = 192;

/**
 * Reads a JPEG file URI and converts it to a Float32Array tensor
 * of shape [1 * 192 * 192 * 3] with values in [0, 1].
 * Applies center-crop (to square) then nearest-neighbor resize.
 */
export async function jpegUriToTensor(uri: string): Promise<ArrayBuffer> {
  const file = new File(uri);
  const bytes = await file.bytes(); // Uint8Array

  const { data: rgba, width, height } = jpeg.decode(bytes, { useTArray: true });

  return centerCropAndResize(rgba as Uint8Array, width, height, MODEL_INPUT_SIZE)
    .buffer as ArrayBuffer;
}

function centerCropAndResize(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  size: number
): Float32Array {
  const cropSide = Math.min(srcW, srcH);
  const cropX = Math.floor((srcW - cropSide) / 2);
  const cropY = Math.floor((srcH - cropSide) / 2);
  const scale = cropSide / size;

  const tensor = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.min(cropX + Math.floor(x * scale), srcW - 1);
      const srcY = Math.min(cropY + Math.floor(y * scale), srcH - 1);
      const srcIdx = (srcY * srcW + srcX) * 4;
      const dstIdx = (y * size + x) * 3;
      tensor[dstIdx] = rgba[srcIdx] / 255;
      tensor[dstIdx + 1] = rgba[srcIdx + 1] / 255;
      tensor[dstIdx + 2] = rgba[srcIdx + 2] / 255;
    }
  }
  return tensor;
}
