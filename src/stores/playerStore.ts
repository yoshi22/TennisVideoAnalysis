import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';
import { type PlayerProfile } from '@/types';

interface PlayerStoreState {
  profile: PlayerProfile | null;
  setProfile: (profile: PlayerProfile) => void;
  updateProfile: (patch: Partial<PlayerProfile>) => void;
  clearProfile: () => void;
}

function nowISO(): string {
  return new Date().toISOString();
}

export const usePlayerStore = create<PlayerStoreState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (profile) => set({ profile }),
      updateProfile: (patch) =>
        set((state) => ({
          profile:
            state.profile === null
              ? null
              : {
                  ...state.profile,
                  ...patch,
                  updatedAt: patch.updatedAt ?? nowISO(),
                },
        })),
      clearProfile: () => set({ profile: null }),
    }),
    {
      name: 'courtlens-player-profile',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
