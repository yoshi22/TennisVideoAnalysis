import { Directory, File, Paths } from 'expo-file-system';

import { generateId } from '@/utils/id';

function videosDir(): Directory {
  return new Directory(Paths.document, 'videos');
}

function framesDir(): Directory {
  return new Directory(Paths.document, 'frames');
}

function persistInto(dir: Directory, uri: string, extension: string): string {
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }

  const src = new File(uri);
  if (src.uri.startsWith(Paths.document.uri)) {
    return src.uri;
  }

  const dest = new File(dir, `${generateId()}.${extension}`);
  src.copy(dir);
  // copy() places the file in dir with its original name; rename to dest
  const copied = new File(dir, src.name);
  if (copied.uri !== dest.uri) {
    copied.move(dest);
  }
  return dest.uri;
}

/**
 * Copies a cache-directory still (a video thumbnail) into documentDirectory so
 * it survives cache eviction. Thumbnails are written to the cache, which iOS
 * may clear at any time, and the impact frame has to outlive the analysis.
 */
export async function persistFrameImage(uri: string): Promise<string> {
  return persistInto(framesDir(), uri, 'jpg');
}

/**
 * Copies a volatile camera/library video URI to app documentDirectory
 * and returns the stable persistent URI. Safe to call if the URI
 * already lives inside documentDirectory (returns it as-is).
 */
export async function persistVideo(uri: string): Promise<string> {
  return persistInto(videosDir(), uri, 'mp4');
}
