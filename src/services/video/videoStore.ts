import { Directory, File, Paths } from 'expo-file-system';

import { generateId } from '@/utils/id';

function videosDir(): Directory {
  return new Directory(Paths.document, 'videos');
}

/**
 * Copies a volatile camera/library video URI to app documentDirectory
 * and returns the stable persistent URI. Safe to call if the URI
 * already lives inside documentDirectory (returns it as-is).
 */
export async function persistVideo(uri: string): Promise<string> {
  const dir = videosDir();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }

  const src = new File(uri);
  // If it's already inside document directory, return as-is
  if (src.uri.startsWith(Paths.document.uri)) {
    return src.uri;
  }

  const dest = new File(dir, `${generateId()}.mp4`);
  src.copy(dir);
  // copy() places the file in dir with its original name; rename to dest
  const copied = new File(dir, src.name);
  if (copied.uri !== dest.uri) {
    copied.move(dest);
  }
  return dest.uri;
}
