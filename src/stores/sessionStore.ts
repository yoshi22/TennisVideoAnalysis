import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';
import {
  type CourtCalibration,
  type PointRecord,
  type RallyAnalysis,
  type RallyOutcome,
  type ShotType,
  type StrokeKind,
  type TennisSession,
} from '@/types';
import { generateId } from '@/utils/id';

interface SessionStoreState {
  sessions: TennisSession[];
  addSession: (session: TennisSession) => void;
  updateSession: (id: string, patch: Partial<TennisSession>) => void;
  deleteSession: (id: string) => void;
  addPoint: (sessionId: string, point: PointRecord) => void;
  updatePoint: (sessionId: string, pointId: string, patch: Partial<PointRecord>) => void;
  deletePoint: (sessionId: string, pointId: string) => void;
  setVideoDuration: (sessionId: string, videoDurationSec: number) => void;
  setCourtCalibration: (sessionId: string, calibration: CourtCalibration | undefined) => void;
  addRallyAnalysis: (sessionId: string, analysis: RallyAnalysis) => void;
  confirmRallyOutcome: (
    sessionId: string,
    analysisId: string,
    rallyNo: number,
    outcome: RallyOutcome
  ) => void;
  clearAll: () => void;
}

function nowISO(): string {
  return new Date().toISOString();
}

function strokeToShotType(stroke: StrokeKind | undefined): ShotType {
  if (stroke === 'serve' || stroke === 'forehand' || stroke === 'backhand') return stroke;
  return 'forehand';
}

function mapSession(
  sessions: TennisSession[],
  id: string,
  updater: (s: TennisSession) => TennisSession
): TennisSession[] {
  return sessions.map((s) => (s.id === id ? updater(s) : s));
}

export const useSessionStore = create<SessionStoreState>()(
  persist(
    (set) => ({
      sessions: [],
      addSession: (session) =>
        set((state) => ({
          sessions: [...state.sessions, session],
        })),
      updateSession: (id, patch) =>
        set((state) => ({
          sessions: mapSession(state.sessions, id, (s) => ({
            ...s,
            ...patch,
            updatedAt: patch.updatedAt ?? nowISO(),
          })),
        })),
      deleteSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== id),
        })),
      addPoint: (sessionId, point) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => ({
            ...s,
            points: [...s.points, point],
            updatedAt: nowISO(),
          })),
        })),
      updatePoint: (sessionId, pointId, patch) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => ({
            ...s,
            points: s.points.map((p) => (p.id === pointId ? { ...p, ...patch } : p)),
            updatedAt: nowISO(),
          })),
        })),
      deletePoint: (sessionId, pointId) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => ({
            ...s,
            points: s.points.filter((p) => p.id !== pointId),
            updatedAt: nowISO(),
          })),
        })),
      setVideoDuration: (sessionId, videoDurationSec) =>
        set((state) => {
          const target = state.sessions.find((s) => s.id === sessionId);
          if (!target || target.videoDurationSec === videoDurationSec) return state;
          return {
            sessions: mapSession(state.sessions, sessionId, (s) => ({
              ...s,
              videoDurationSec,
              updatedAt: nowISO(),
            })),
          };
        }),
      setCourtCalibration: (sessionId, calibration) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => ({
            ...s,
            courtCalibration: calibration,
            updatedAt: nowISO(),
          })),
        })),
      addRallyAnalysis: (sessionId, analysis) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => ({
            ...s,
            rallyAnalyses: [...(s.rallyAnalyses ?? []), analysis],
            updatedAt: nowISO(),
          })),
        })),
      confirmRallyOutcome: (sessionId, analysisId, rallyNo, outcome) =>
        set((state) => ({
          sessions: mapSession(state.sessions, sessionId, (s) => {
            let points = s.points;
            const analyses = (s.rallyAnalyses ?? []).map((a) => {
              if (a.id !== analysisId) return a;
              return {
                ...a,
                rallies: a.rallies.map((r) => {
                  if (r.rally !== rallyNo) return r;
                  let pointId = r.pointId;
                  if (outcome === 'unknown') {
                    if (pointId) {
                      points = points.filter((p) => p.id !== pointId);
                      pointId = undefined;
                    }
                  } else {
                    const lastShot = r.shots[r.shots.length - 1];
                    const shotType = strokeToShotType(lastShot?.stroke);
                    const resultReason = outcome === 'won' ? 'winner' : 'unforcedError';
                    if (pointId && points.some((p) => p.id === pointId)) {
                      points = points.map((p) =>
                        p.id === pointId
                          ? { ...p, outcome, resultReason, reviewStatus: 'confirmed' }
                          : p
                      );
                    } else {
                      pointId = generateId();
                      points = [
                        ...points,
                        {
                          id: pointId,
                          sessionId,
                          timestamp: nowISO(),
                          outcome,
                          resultReason,
                          shotType,
                          rallyCount: r.shotCount,
                          rallyStartSec: r.startSec,
                          rallyEndSec: r.endSec,
                          videoTimestamp: r.endSec,
                          shotLocation: lastShot?.location,
                          source: 'auto',
                          reviewStatus: 'confirmed',
                          detailStatus: 'quick',
                        },
                      ];
                    }
                  }
                  return { ...r, outcome, outcomeSource: 'confirmed' as const, pointId };
                }),
              };
            });
            return { ...s, rallyAnalyses: analyses, points, updatedAt: nowISO() };
          }),
        })),
      clearAll: () => set({ sessions: [] }),
    }),
    {
      name: 'courtlens-sessions',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
