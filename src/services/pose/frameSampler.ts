import { Image } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';

export interface SampledFrame {
  timeSec: number;
  uri: string;
}

export interface StillFrame {
  uri: string;
  widthPx: number;
  heightPx: number;
  timeSec: number;
}

/**
 * Samples `count` evenly-spaced frames from [startSec, endSec] of a video file.
 * Returns frames whose thumbnail URI can be read as JPEG.
 */
export async function sampleFrames(
  videoUri: string,
  startSec: number,
  endSec: number,
  count: number = 20
): Promise<SampledFrame[]> {
  const duration = Math.max(endSec - startSec, 0.1);
  const step = duration / (count - 1);

  const frames: SampledFrame[] = [];
  for (let i = 0; i < count; i++) {
    const timeSec = startSec + i * step;
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: Math.round(timeSec * 1000), // ms
        quality: 0.7,
      });
      frames.push({ timeSec, uri });
    } catch {
      // Skip frames that can't be extracted (near end of file etc.)
    }
  }

  return frames;
}

/**
 * Extracts a single still frame at the given timestamp.
 * Returns the JPEG URI plus its pixel dimensions.
 */
export async function extractStillFrame(videoUri: string, timeSec: number): Promise<StillFrame> {
  const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
    time: Math.round(timeSec * 1000),
    quality: 0.85,
  });

  const { width, height } = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
    }
  );

  return { uri, widthPx: width, heightPx: height, timeSec };
}
