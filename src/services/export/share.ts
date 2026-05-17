import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Writes content to a temp file and opens the system share sheet.
 */
export async function shareTextFile(content: string, filename: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('このデバイスでは共有がサポートされていません。');
  }

  const filePath = `${Paths.cache}/${filename}`;
  const file = new File(filePath);
  await file.create();
  await file.write(content);
  await Sharing.shareAsync(filePath, { UTI: 'public.plain-text' });
}
