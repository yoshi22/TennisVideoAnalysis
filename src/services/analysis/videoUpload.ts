import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';

const SIGNED_URL_TIMEOUT_MS = 20_000;
const VIDEO_UPLOAD_TIMEOUT_MS = 120_000;

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
  signal?: AbortSignal;
}

export interface UploadVideoResult {
  videoUrl: string;
  objectPath: string;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('動画アップロードをキャンセルしました');
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    abortListener = () => reject(new Error('動画アップロードをキャンセルしました'));
    signal?.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (abortListener) {
      signal?.removeEventListener('abort', abortListener);
    }
  }
}

export async function uploadVideoForAnalysis(args: UploadVideoArgs): Promise<UploadVideoResult> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Video upload is not configured (expo.extra.submission)');

  const objectPath = `analysis/${args.clipId}/video.mp4`;
  const putUrl = `${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`;
  const authHeader = `Bearer ${cfg.anonKey}`;

  args.onProgress?.(0);
  const uploadResult = await withTimeout(
    FileSystem.uploadAsync(putUrl, args.videoUri, {
      httpMethod: 'PUT',
      headers: {
        Authorization: authHeader,
        apikey: cfg.anonKey,
        'content-type': 'video/mp4',
        'x-upsert': 'true',
      },
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    }),
    VIDEO_UPLOAD_TIMEOUT_MS,
    '動画アップロードがタイムアウトしました',
    args.signal
  );
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Video upload failed (HTTP ${uploadResult.status}): ${uploadResult.body}`);
  }
  args.onProgress?.(0.85);

  const signUrl = `${cfg.url}/storage/v1/object/sign/${cfg.bucket}/${objectPath}`;
  const signController = new AbortController();
  let didSignTimeout = false;
  const signTimeoutId = setTimeout(() => {
    didSignTimeout = true;
    signController.abort();
  }, SIGNED_URL_TIMEOUT_MS);
  const abortSignRequest = () => signController.abort();
  args.signal?.addEventListener('abort', abortSignRequest, { once: true });

  let signResponse: Response;
  try {
    throwIfAborted(args.signal);
    signResponse = await fetch(signUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        apikey: cfg.anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: args.expiresInSec ?? 7200 }),
      signal: signController.signal,
    });
  } catch (error) {
    if (didSignTimeout) {
      throw new Error('署名URLの取得がタイムアウトしました');
    }
    throw error;
  } finally {
    clearTimeout(signTimeoutId);
    args.signal?.removeEventListener('abort', abortSignRequest);
  }

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
