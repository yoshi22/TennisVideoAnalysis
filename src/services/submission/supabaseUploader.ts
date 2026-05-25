import * as FileSystem from 'expo-file-system/legacy';

import { type SubmissionManifest } from '@/types';

import { type SubmissionUploadArgs, type SubmissionUploader } from './uploader';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  bucket: string;
}

export function createSupabaseUploader(cfg: SupabaseConfig): SubmissionUploader {
  return {
    async upload({ videoUri, manifest, onProgress }: SubmissionUploadArgs): Promise<void> {
      const { participantId, submissionId } = manifest;
      const base = `${cfg.url}/storage/v1/object/${cfg.bucket}/${participantId}/${submissionId}`;
      const authHeader = `Bearer ${cfg.anonKey}`;

      onProgress?.(0);

      const uploadResult = await FileSystem.uploadAsync(`${base}/video.mp4`, videoUri, {
        httpMethod: 'PUT',
        headers: {
          Authorization: authHeader,
          'content-type': 'video/mp4',
          'x-upsert': 'true',
        },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Video upload failed (HTTP ${uploadResult.status}): ${uploadResult.body}`);
      }

      onProgress?.(0.9);

      const manifestResponse = await fetch(`${base}/manifest.json`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'content-type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(manifest, null, 2),
      });

      if (!manifestResponse.ok) {
        const body = await manifestResponse.text();
        throw new Error(`Manifest upload failed (HTTP ${manifestResponse.status}): ${body}`);
      }

      onProgress?.(1);
    },
  };
}

export type { SubmissionManifest };
