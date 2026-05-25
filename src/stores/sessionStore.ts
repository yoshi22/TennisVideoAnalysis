import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';
import { type CourtCalibration, type PointRecord, type TennisSession } from '@/types';

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
  clearAll: () => void;
}

function nowISO(): string {
  return new Date().toISOString();
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
      clearAll: () => set({ sessions: [] }),
    }),
    {
      name: 'courtlens-sessions',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
