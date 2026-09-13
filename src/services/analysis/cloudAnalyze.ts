import Constants from 'expo-constants';

/**
 * Client for the CourtLens cloud analysis endpoint (Modal `tennis-ball` app).
 *
 * Flow (see docs/cloud-analysis-api.md):
 *   1. Upload the clip somewhere fetchable (existing Supabase uploader → signed URL).
 *   2. submitAnalysis({ videoUrl, courtCorners, rallies, ... }) → callId.
 *   3. pollAnalysis(callId) until status 'done' → CloudAnalyzeResult.
 *
 * Endpoint URLs come from expo.extra.cloudAnalysis; callers must handle null
 * (feature disabled / not configured) rather than crashing.
 */

export interface CloudAnalysisConfig {
  submitUrl: string;
  resultUrl: string;
}

/** 4 normalized [x, y] pairs in [0,1]: near-left, near-right, far-right, far-left. */
export type CourtCornersNormalized = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export interface CloudRallyWindow {
  startSec: number;
  endSec: number;
}

export interface CloudAnalyzeRequest {
  /** App-generated id (e.g. submissionId). */
  clipId: string;
  /** Publicly/temporarily fetchable mp4 (e.g. Supabase signed URL). */
  videoUrl: string;
  courtCorners: CourtCornersNormalized;
  courtType?: 'singles' | 'doubles';
  rallies: CloudRallyWindow[];
  handedness?: 'right' | 'left';
}

export interface CloudShotZone {
  side: string;
  depth: string;
  half: string;
  label: string;
  in_bounds: boolean;
}

export interface CloudContact {
  type: 'contact';
  rally: number;
  frameIdx: number;
  timeSec: number;
  court_xy_m?: [number, number];
  zone?: CloudShotZone;
  speed_kmh?: number | null;
}

export interface CloudBounce {
  type?: 'bounce';
  rally: number;
  frameIdx: number;
  timeSec: number;
  court_xy_m?: [number, number];
  zone?: CloudShotZone;
  speed_kmh?: number | null;
}

export interface CloudRally {
  rally: number;
  n_points: number;
  bounces: CloudBounce[];
  contacts: CloudContact[];
  p95_kmh?: number | null;
  median_kmh?: number | null;
}

export interface CloudShotEvents {
  summary: Record<string, unknown>;
  rallies: CloudRally[];
  shots: unknown[];
}

export interface CloudStrokeContact {
  rally: number;
  frameIdx: number;
  timeSec: number;
  stroke: 'forehand' | 'backhand' | null;
  stroke_confidence?: number | null;
}

export interface CloudStrokes {
  summary: { counts?: Record<string, number> };
  contacts: CloudStrokeContact[];
}

export interface CloudAnalyzeResult {
  clip_id: string;
  status: 'ok' | 'error';
  court_type?: string;
  normalized?: boolean;
  frames?: number;
  summary?: Record<string, unknown>;
  events?: CloudShotEvents | null;
  strokes?: CloudStrokes | null;
}

export type CloudJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface CloudSubmitResponse {
  call_id: string;
  clip_id?: string;
  status?: CloudJobStatus;
  error?: string;
}

export interface CloudResultResponse {
  call_id: string;
  status: CloudJobStatus;
  result?: CloudAnalyzeResult;
  error?: string;
}

export function getCloudAnalysisConfig(): CloudAnalysisConfig | null {
  const cfg = Constants.expoConfig?.extra?.cloudAnalysis as
    | Partial<CloudAnalysisConfig>
    | undefined;
  if (!cfg?.submitUrl || !cfg?.resultUrl) return null;
  return { submitUrl: cfg.submitUrl, resultUrl: cfg.resultUrl };
}

export function isCloudAnalysisEnabled(): boolean {
  return getCloudAnalysisConfig() !== null;
}

export async function submitAnalysis(
  request: CloudAnalyzeRequest,
  config = getCloudAnalysisConfig()
): Promise<CloudSubmitResponse> {
  if (!config) throw new Error('Cloud analysis is not configured (expo.extra.cloudAnalysis)');
  const body = {
    clip_id: request.clipId,
    video_url: request.videoUrl,
    court_corners: request.courtCorners,
    court_type: request.courtType ?? 'singles',
    rallies: request.rallies,
    handedness: request.handedness ?? 'right',
  };
  const response = await fetch(config.submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Cloud submit failed: HTTP ${response.status}`);
  const json = (await response.json()) as CloudSubmitResponse;
  if (json.error) throw new Error(`Cloud submit rejected: ${json.error}`);
  if (!json.call_id) throw new Error('Cloud submit returned no call_id');
  return json;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (status: CloudJobStatus) => void;
  signal?: AbortSignal;
}

export async function pollAnalysis(
  callId: string,
  options: PollOptions = {},
  config = getCloudAnalysisConfig()
): Promise<CloudAnalyzeResult> {
  if (!config) throw new Error('Cloud analysis is not configured (expo.extra.cloudAnalysis)');
  const intervalMs = options.intervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (options.signal?.aborted) throw new Error('Cloud analysis polling aborted');
    const url = `${config.resultUrl}?call_id=${encodeURIComponent(callId)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cloud result failed: HTTP ${response.status}`);
    const json = (await response.json()) as CloudResultResponse;
    options.onStatus?.(json.status);

    if (json.status === 'done') {
      if (!json.result) throw new Error('Cloud result done but payload missing');
      return json.result;
    }
    if (json.status === 'error') {
      throw new Error(`Cloud analysis failed: ${json.error ?? 'unknown error'}`);
    }
    if (Date.now() >= deadline) throw new Error('Cloud analysis timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Convenience: submit then poll to completion. */
export async function runCloudAnalysis(
  request: CloudAnalyzeRequest,
  options: PollOptions = {}
): Promise<CloudAnalyzeResult> {
  const { call_id } = await submitAnalysis(request);
  return pollAnalysis(call_id, options);
}
