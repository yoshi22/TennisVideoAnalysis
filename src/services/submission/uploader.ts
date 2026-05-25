import Constants from 'expo-constants';

import { type SubmissionManifest } from '@/types';

import { createSupabaseUploader } from './supabaseUploader';

export interface SubmissionUploadArgs {
  videoUri: string;
  manifest: SubmissionManifest;
  onProgress?: (ratio: number) => void;
}

export interface SubmissionUploader {
  upload(args: SubmissionUploadArgs): Promise<void>;
}

interface SubmissionConfig {
  provider: string;
  url: string;
  anonKey: string;
  bucket: string;
}

function getConfig(): SubmissionConfig | null {
  const cfg = Constants.expoConfig?.extra?.submission as Partial<SubmissionConfig> | undefined;
  if (!cfg?.url || !cfg?.anonKey || !cfg?.bucket) return null;
  return {
    provider: cfg.provider ?? 'supabase',
    url: cfg.url,
    anonKey: cfg.anonKey,
    bucket: cfg.bucket,
  };
}

/**
 * Returns a configured uploader, or null when expo.extra.submission is not set.
 * Callers must handle null (show "未設定" message rather than crashing).
 */
export function createUploader(): SubmissionUploader | null {
  const cfg = getConfig();
  if (!cfg) return null;

  if (cfg.provider === 'supabase') {
    return createSupabaseUploader(cfg);
  }

  return null;
}
