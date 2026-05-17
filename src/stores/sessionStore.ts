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
  deletePoint: (sessionId: string, pointId: string) => void;
  setCourtCalibration: (sessionId: string, calibration: CourtCalibration | undefined) => void;
  clearAll: () => void;
}

function nowISO(): string {
  return new Date().toISOString();
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
          sessions: state.sessions.map((session) =>
            session.id === id
              ? {
                  ...session,
                  ...patch,
                  updatedAt: patch.updatedAt ?? nowISO(),
                }
              : session
          ),
        })),
      deleteSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== id),
        })),
      addPoint: (sessionId, point) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  points: [...session.points, point],
                  updatedAt: nowISO(),
                }
              : session
          ),
        })),
      deletePoint: (sessionId, pointId) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  points: session.points.filter((point) => point.id !== pointId),
                  updatedAt: nowISO(),
                }
              : session
          ),
        })),
      setCourtCalibration: (sessionId, calibration) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, courtCalibration: calibration, updatedAt: nowISO() }
              : session
          ),
        })),
      clearAll: () => set({ sessions: [] }),
    }),
    {
      name: 'courtlens-sessions',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
