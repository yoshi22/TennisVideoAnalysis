import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type VideoPlayerRef } from '@/components/video';
import { consumePendingSeek } from '@/services/video';
import { useSessionStore } from '@/stores/sessionStore';
import { type PointOutcome, type PointRecord, type TennisSession } from '@/types';
import { computeCumulativeScores } from '@/utils/cumulativeScore';
import { generateId } from '@/utils/id';
import { isConfirmed } from '@/utils/pointDetails';
import { countLost, countWon } from '@/utils/reportStats';

export type TimestampedPoint = PointRecord & { videoTimestamp: number };

export function hasVideoTimestamp(point: PointRecord): point is TimestampedPoint {
  return point.videoTimestamp !== undefined;
}

export function useSessionVideo(session: TennisSession | undefined, sessionId: string) {
  const addPoint = useSessionStore((state) => state.addPoint);
  const updatePoint = useSessionStore((state) => state.updatePoint);
  const deletePoint = useSessionStore((state) => state.deletePoint);
  const setVideoDuration = useSessionStore((state) => state.setVideoDuration);
  const playerRef = useRef<VideoPlayerRef>(null);
  const requestedSeekRef = useRef<number | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [initialSeekSec, setInitialSeekSec] = useState<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [rallyStartMark, setRallyStartMark] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<
    { id: string; outcome: PointOutcome; timeSec: number }[]
  >([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  const timestampedPoints = useMemo(
    () =>
      session
        ? session.points
            .filter(hasVideoTimestamp)
            .sort((a, b) => a.videoTimestamp - b.videoTimestamp)
        : [],
    [session]
  );

  const score = useMemo(() => {
    const confirmed = (session?.points ?? []).filter(isConfirmed);
    return {
      won: countWon(confirmed),
      lost: countLost(confirmed),
    };
  }, [session]);

  const cumulativeScores = useMemo(
    () => computeCumulativeScores(timestampedPoints.filter(isConfirmed)),
    [timestampedPoints]
  );

  const selectedPoint = useMemo(
    () =>
      selectedPointId ? (session?.points.find((p) => p.id === selectedPointId) ?? null) : null,
    [selectedPointId, session]
  );

  const selectedPointIndex = useMemo(
    () => (selectedPointId ? timestampedPoints.findIndex((p) => p.id === selectedPointId) : -1),
    [selectedPointId, timestampedPoints]
  );

  const seekTo = useCallback((seconds: number) => {
    requestedSeekRef.current = seconds;
    setInitialSeekSec(seconds);
    playerRef.current?.seekTo(seconds);
  }, []);

  const consumeSeek = useCallback(() => {
    const seconds = consumePendingSeek(sessionId);
    if (seconds !== null) {
      seekTo(seconds);
    }
  }, [seekTo, sessionId]);

  useEffect(() => {
    consumeSeek();
  }, [consumeSeek]);

  useFocusEffect(
    useCallback(() => {
      consumeSeek();
    }, [consumeSeek])
  );

  const handleDurationLoaded = (seconds: number) => {
    setDurationSec(seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      setVideoDuration(sessionId, seconds);
    }
    if (requestedSeekRef.current !== null) {
      playerRef.current?.seekTo(requestedSeekRef.current);
    }
  };

  const handleMarkRallyStart = () => {
    const t = Math.max(0, playerRef.current?.getCurrentTime() ?? currentTimeSec ?? 0);
    setRallyStartMark(t);
  };

  const handleQuickLog = (outcome: PointOutcome) => {
    const videoTimestamp = Math.max(0, playerRef.current?.getCurrentTime() ?? currentTimeSec ?? 0);
    const hasInterval = rallyStartMark !== null && rallyStartMark < videoTimestamp;
    const point: PointRecord = {
      id: generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      outcome,
      videoTimestamp,
      detailStatus: 'quick',
      ...(hasInterval && {
        rallyStartSec: rallyStartMark,
        rallyEndSec: videoTimestamp,
      }),
    };

    addPoint(sessionId, point);
    setUndoStack((prev) => [...prev, { id: point.id, outcome, timeSec: videoTimestamp }]);
    setRallyStartMark(null);
  };

  const handleUndoLast = () => {
    const lastEntry = undoStack[undoStack.length - 1];
    if (!lastEntry) return;
    deletePoint(sessionId, lastEntry.id);
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const handleSelectPoint = useCallback(
    (point: TimestampedPoint) => {
      setSelectedPointId(point.id);
      seekTo(point.rallyStartSec ?? point.videoTimestamp);
    },
    [seekTo]
  );

  const handlePrevPoint = useCallback(() => {
    if (selectedPointIndex > 0 && selectedPointIndex !== -1) {
      handleSelectPoint(timestampedPoints[selectedPointIndex - 1]);
    }
  }, [selectedPointIndex, timestampedPoints, handleSelectPoint]);

  const handleNextPoint = useCallback(() => {
    if (selectedPointIndex !== -1 && selectedPointIndex < timestampedPoints.length - 1) {
      handleSelectPoint(timestampedPoints[selectedPointIndex + 1]);
    }
  }, [selectedPointIndex, timestampedPoints, handleSelectPoint]);

  const latestUndoEntry = undoStack[undoStack.length - 1];

  const updateDraftOutcome = (pointId: string, outcome: PointOutcome) =>
    updatePoint(sessionId, pointId, { outcome });

  return {
    playerRef,
    initialSeekSec,
    currentTimeSec,
    setCurrentTimeSec,
    durationSec,
    rallyStartMark,
    undoStack,
    latestUndoEntry,
    timestampedPoints,
    score,
    cumulativeScores,
    selectedPoint,
    selectedPointId,
    setSelectedPointId,
    selectedPointIndex,
    handleDurationLoaded,
    handleMarkRallyStart,
    handleQuickLog,
    handleUndoLast,
    handleSelectPoint,
    handlePrevPoint,
    handleNextPoint,
    updateDraftOutcome,
  };
}
