import * as Sentry from '@sentry/react-native';
import { useEvent } from 'expo';
import { useRouter } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { runCloudAnalysis, type CourtCornersNormalized } from '@/services/analysis/cloudAnalyze';
import { cloudResultToRallyAnalysis } from '@/services/analysis/rallyHistory';
import { uploadVideoForAnalysis } from '@/services/analysis/videoUpload';
import { analyzeRally, analyzeRallyBatch, detectRallyWindows } from '@/services/ball';
import { proposeCandidates } from '@/services/scoring';
import { useSessionStore } from '@/stores';
import { type AutoPointCandidate, type PointRecord, type TennisSession } from '@/types';
import { generateId } from '@/utils/id';

export type PlayerSideValue = 'near' | 'far';
export type ServeMode = 'yes' | 'no';
export type ServeAttemptValue = '1' | '2';

export const SLIDER_MIN = 0;
export const SLIDER_STEP = 0.5;
/** Low-confidence threshold — windows below this are marked 要確認 in the draft summary */
export const DRAFT_LOW_CONFIDENCE_THRESHOLD = 0.5;

export function useAutoScore(
  session: TennisSession | null,
  sessionId: string,
  router: ReturnType<typeof useRouter>
) {
  const addPoint = useSessionStore((state) => state.addPoint);
  const addRallyAnalysis = useSessionStore((state) => state.addRallyAnalysis);
  const setVideoDuration = useSessionStore((state) => state.setVideoDuration);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(10);
  const [playerSide, setPlayerSide] = useState<PlayerSideValue>('near');
  const [serveMode, setServeMode] = useState<ServeMode>('no');
  const [serveAttempt, setServeAttempt] = useState<ServeAttemptValue>('1');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isCloudAnalyzing, setIsCloudAnalyzing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [candidates, setCandidates] = useState<AutoPointCandidate[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  /** Number of rally windows added as drafts when running without court calibration. null = not in draft-only mode */
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [confirmingCandidate, setConfirmingCandidate] = useState<AutoPointCandidate | null>(null);
  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);

  const videoPlayer = useVideoPlayer(session?.videoUri ?? null, (p) => {
    p.muted = true;
  });
  const { status: videoStatus } = useEvent(videoPlayer, 'statusChange', {
    status: videoPlayer.status,
  });
  const loadedVideoDurationSec = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : 0;
  const videoDurationSec =
    loadedVideoDurationSec > 0 ? loadedVideoDurationSec : (session?.videoDurationSec ?? 0);
  const canAutoDetect =
    videoStatus === 'readyToPlay' || (Number.isFinite(videoDurationSec) && videoDurationSec > 0);
  // Dynamic slider max: full video duration (floor to 0.5s grid), minimum 60s fallback
  const sliderMax = Math.max(60, Math.ceil(videoDurationSec / SLIDER_STEP) * SLIDER_STEP);

  useEffect(() => {
    if (session && loadedVideoDurationSec > 0) {
      setVideoDuration(session.id, loadedVideoDurationSec);
    }
  }, [loadedVideoDurationSec, session, setVideoDuration]);

  const resetCandidates = () => {
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);
  };

  const handleStartChange = (value: number) => {
    setStartSec(Math.min(value, endSec - SLIDER_STEP));
    resetCandidates();
  };

  const handleEndChange = (value: number) => {
    setEndSec(Math.max(value, startSec + SLIDER_STEP));
    resetCandidates();
  };

  const handleAnalyze = async () => {
    if (!session?.videoUri || !session.courtCalibration || endSec <= startSec || isAutoDetecting) {
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);

    try {
      const rally = await analyzeRally({
        videoUri: session.videoUri,
        startSec,
        endSec,
        calibration: session.courtCalibration,
        onProgress: (value) => setProgress(Math.max(0, Math.min(1, value))),
      });
      const proposed = proposeCandidates(rally, {
        playerSide,
        isServe: serveMode === 'yes',
        serveAttempt: serveAttempt === '1' ? 1 : 2,
      }).map((candidate) => ({
        ...candidate,
        rallyStartSec: startSec,
        rallyEndSec: endSec,
      }));

      setCandidates(proposed);
      setHasAnalyzed(true);
    } catch (error) {
      Sentry.captureException(error);
      Alert.alert(
        '解析に失敗しました',
        '範囲、動画、コート較正を確認して、もう一度お試しください。'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAutoDetectBatch = async () => {
    if (
      !session?.videoUri ||
      isAnalyzing ||
      !Number.isFinite(videoDurationSec) ||
      videoDurationSec <= 0
    ) {
      return;
    }

    const controller = new AbortController();
    setIsAutoDetecting(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec,
        onProgress: (value) => setProgress(Math.max(0, Math.min(0.35, value * 0.35))),
        signal: controller.signal,
      });

      if (!session.courtCalibration) {
        // No calibration — add rally windows as draft PointRecords directly.
        // Outcome is a placeholder ('won'); user must correct each draft in the Video tab.
        for (const win of windows) {
          const midSec = Math.round(((win.startSec + win.endSec) / 2) * 10) / 10;
          const point: PointRecord = {
            id: generateId(),
            sessionId,
            timestamp: new Date().toISOString(),
            outcome: 'won',
            videoTimestamp: midSec,
            source: 'auto',
            confidence: win.confidence,
            reviewStatus: 'draft',
            detailStatus: 'quick',
            rallyStartSec: win.startSec,
            rallyEndSec: win.endSec,
          };
          addPoint(sessionId, point);
        }
        setProgress(1);
        setDraftCount(windows.length);
        setHasAnalyzed(true);
        return;
      }

      const results = await analyzeRallyBatch(windows, {
        videoUri: session.videoUri,
        calibration: session.courtCalibration,
        onProgress: (value) => setProgress(Math.max(0.35, Math.min(1, 0.35 + value * 0.65))),
        signal: controller.signal,
      });

      const allCandidates = results.flatMap(({ window: win, result }) =>
        proposeCandidates(result, {
          playerSide,
          isServe: serveMode === 'yes',
          serveAttempt: serveAttempt === '1' ? 1 : 2,
        }).map((c) => ({ ...c, rallyStartSec: win.startSec, rallyEndSec: win.endSec }))
      );

      setProgress(1);
      setCandidates(allCandidates);
      setHasAnalyzed(true);
    } catch (error) {
      Sentry.captureException(error);
      Alert.alert('一括採点に失敗しました', '動画、撮影範囲を確認して、もう一度お試しください。');
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleCloudAnalyze = async () => {
    if (
      !session?.videoUri ||
      !session.courtCalibration ||
      isAnalyzing ||
      isAutoDetecting ||
      isCloudAnalyzing ||
      !Number.isFinite(videoDurationSec) ||
      videoDurationSec <= 0
    ) {
      return;
    }

    const controller = new AbortController();
    setIsCloudAnalyzing(true);
    setProgress(0);
    setCandidates([]);
    setHasAnalyzed(false);
    setDraftCount(null);
    setCloudStatus('ラリー検出中...');

    try {
      const windows = await detectRallyWindows({
        videoUri: session.videoUri,
        videoDurationSec,
        onProgress: (value) => setProgress(Math.max(0, Math.min(0.2, value * 0.2))),
        signal: controller.signal,
      });
      if (windows.length === 0) {
        Alert.alert('ラリーが検出できませんでした', '撮影範囲や動画を確認してください。');
        return;
      }

      const corners = session.courtCalibration.imageCorners.map((p) => [
        p.x,
        p.y,
      ]) as unknown as CourtCornersNormalized;
      const clipId = generateId();

      setCloudStatus('動画をアップロード中...');
      const { videoUrl } = await uploadVideoForAnalysis({
        videoUri: session.videoUri,
        clipId,
        onProgress: (value) => setProgress(Math.max(0.2, Math.min(0.4, 0.2 + value * 0.2))),
      });

      setCloudStatus('クラウド解析中...(数分かかることがあります)');
      const result = await runCloudAnalysis(
        {
          clipId,
          videoUrl,
          courtCorners: corners,
          courtType: 'singles',
          rallies: windows.map((w) => ({ startSec: w.startSec, endSec: w.endSec })),
          handedness: 'right',
        },
        {
          onStatus: (status) =>
            setCloudStatus(
              status === 'running' || status === 'queued'
                ? 'クラウド解析中...(数分かかることがあります)'
                : `状態: ${status}`
            ),
          signal: controller.signal,
        }
      );

      const analysis = cloudResultToRallyAnalysis(result, { playerSide });
      addRallyAnalysis(sessionId, analysis);
      setProgress(1);
      setHasAnalyzed(true);
      if (analysis.rallies.length > 0) {
        router.push(`/session/${sessionId}/rally-history` as never);
      } else {
        Alert.alert('解析結果が空でした', 'ラリーが検出できませんでした。動画を確認してください。');
      }
    } catch (error) {
      Sentry.captureException(error);
      Alert.alert(
        'クラウド解析に失敗しました',
        error instanceof Error ? error.message : '時間をおいて再試行してください。'
      );
    } finally {
      setIsCloudAnalyzing(false);
      setCloudStatus('');
    }
  };

  const handleDraftCandidate = (candidateId: string, point: PointRecord) => {
    addPoint(sessionId, point);
    setCandidates((current) => current.filter((c) => c.id !== candidateId));
  };

  const handleOpenConfirm = (candidate: AutoPointCandidate) => {
    setConfirmingCandidate(candidate);
    setConfirmSheetOpen(true);
  };

  const handleConfirmSheetClose = () => {
    setConfirmSheetOpen(false);
    setConfirmingCandidate(null);
  };

  const handleConfirmSheetCommit = (data: Omit<PointRecord, 'id' | 'sessionId' | 'timestamp'>) => {
    if (!confirmingCandidate) return;
    const point: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      ...data,
      source: 'auto',
      confidence: confirmingCandidate.confidence,
      reviewStatus: 'confirmed',
      videoTimestamp: confirmingCandidate.videoTimestamp,
      rallyStartSec: confirmingCandidate.rallyStartSec,
      rallyEndSec: confirmingCandidate.rallyEndSec,
    };
    addPoint(sessionId, point);
    setCandidates((current) => current.filter((c) => c.id !== confirmingCandidate.id));
    setConfirmingCandidate(null);
    setConfirmSheetOpen(false);
  };

  const removeCandidate = (candidateId: string) => {
    setCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
  };

  const confirmInitialPoint: PointRecord | undefined = confirmingCandidate
    ? {
        id: '',
        sessionId,
        timestamp: new Date().toISOString(),
        outcome: confirmingCandidate.suggestedOutcome,
        shotType: confirmingCandidate.suggestedShotType,
        resultReason: confirmingCandidate.suggestedResultReason,
        rallyCount: confirmingCandidate.suggestedRallyCount,
        serveResult: confirmingCandidate.suggestedServeResult,
        shotLocation: confirmingCandidate.suggestedShotLocation,
        videoTimestamp: confirmingCandidate.videoTimestamp,
        source: 'auto',
        confidence: confirmingCandidate.confidence,
        rallyStartSec: confirmingCandidate.rallyStartSec,
        rallyEndSec: confirmingCandidate.rallyEndSec,
      }
    : undefined;

  return {
    startSec,
    endSec,
    playerSide,
    setPlayerSide,
    serveMode,
    setServeMode,
    serveAttempt,
    setServeAttempt,
    isAnalyzing,
    isAutoDetecting,
    isCloudAnalyzing,
    cloudStatus,
    progress,
    candidates,
    hasAnalyzed,
    draftCount,
    confirmingCandidate,
    confirmSheetOpen,
    videoDurationSec,
    canAutoDetect,
    sliderMax,
    confirmInitialPoint,
    handleStartChange,
    handleEndChange,
    handleAnalyze,
    handleAutoDetectBatch,
    handleCloudAnalyze,
    handleDraftCandidate,
    handleOpenConfirm,
    handleConfirmSheetClose,
    handleConfirmSheetCommit,
    removeCandidate,
  };
}
