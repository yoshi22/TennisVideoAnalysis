import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export function sanitizeExportFilename(filename: string): string {
  const trimmed = filename.trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/^_+/, '')
    .slice(0, 120);

  return sanitized.length > 0 ? sanitized : 'export.txt';
}

/**
 * Writes content to a temp file and opens the system share sheet.
 */
export async function shareTextFile(content: string, filename: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('このデバイスでは共有がサポートされていません。');
  }

  const safeFilename = sanitizeExportFilename(filename);
  const file = new File(Paths.cache, safeFilename);
  await file.create({ overwrite: true });
  await file.write(content);
  await Sharing.shareAsync(file.uri, { UTI: 'public.plain-text' });
}
