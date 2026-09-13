import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';

/**
 * Upload a clip to Supabase Storage and return a fetchable signed URL for the
 * cloud analysis endpoint to download. Reuses the existing submission config
 * (expo.extra.submission), so no new backend project is required.
 *
 * A *signed* URL is used (not a raw object URL) because the Modal downloader
 * fetches with no auth headers — the token must live in the query string.
 */

interface SupabaseSubmissionConfig {
  url: string;
  anonKey: string;
  bucket: string;
}

function getConfig(): SupabaseSubmissionConfig | null {
  const cfg = Constants.expoConfig?.extra?.submission as
    | Partial<SupabaseSubmissionConfig>
    | undefined;
  if (!cfg?.url || !cfg?.anonKey || !cfg?.bucket) return null;
  return { url: cfg.url, anonKey: cfg.anonKey, bucket: cfg.bucket };
}

export function isVideoUploadConfigured(): boolean {
  return getConfig() !== null;
}

export interface UploadVideoArgs {
  videoUri: string;
  /** App-generated id; becomes the storage path segment. */
  clipId: string;
  /** Signed URL lifetime in seconds (default 2h — must outlast the analysis). */
  expiresInSec?: number;
  onProgress?: (ratio: number) => void;
}

export interface UploadVideoResult {
  videoUrl: string;
  objectPath: string;
}

export async function uploadVideoForAnalysis(args: UploadVideoArgs): Promise<UploadVideoResult> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Video upload is not configured (expo.extra.submission)');

  const objectPath = `analysis/${args.clipId}/video.mp4`;
  const putUrl = `${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`;
  const authHeader = `Bearer ${cfg.anonKey}`;

  args.onProgress?.(0);
  const uploadResult = await FileSystem.uploadAsync(putUrl, args.videoUri, {
    httpMethod: 'PUT',
    headers: {
      Authorization: authHeader,
      apikey: cfg.anonKey,
      'content-type': 'video/mp4',
      'x-upsert': 'true',
    },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Video upload failed (HTTP ${uploadResult.status}): ${uploadResult.body}`);
  }
  args.onProgress?.(0.85);

  const signUrl = `${cfg.url}/storage/v1/object/sign/${cfg.bucket}/${objectPath}`;
  const signResponse = await fetch(signUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      apikey: cfg.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: args.expiresInSec ?? 7200 }),
  });
  if (!signResponse.ok) {
    const body = await signResponse.text();
    throw new Error(`Signed URL creation failed (HTTP ${signResponse.status}): ${body}`);
  }
  const signed = (await signResponse.json()) as { signedURL?: string };
  if (!signed.signedURL) throw new Error('Signed URL response missing signedURL');

  args.onProgress?.(1);
  return {
    videoUrl: `${cfg.url}/storage/v1${signed.signedURL}`,
    objectPath,
  };
}
