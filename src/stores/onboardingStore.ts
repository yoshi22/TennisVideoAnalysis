import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';

/** Increment this when adding new onboarding steps that existing users should see. */
export const CURRENT_ONBOARDING_VERSION = 2;

interface OnboardingStoreState {
  hasCompletedOnboarding: boolean;
  onboardingVersion: number;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  /** Returns true if the user needs to see new onboarding steps (version outdated). */
  needsVersionUpdate: () => boolean;
  markVersionCurrent: () => void;
}

export const useOnboardingStore = create<OnboardingStoreState>()(
  persist(
    (set, get) => ({
      hasCompletedOnboarding: false,
      onboardingVersion: 0,
      completeOnboarding: () =>
        set({ hasCompletedOnboarding: true, onboardingVersion: CURRENT_ONBOARDING_VERSION }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false, onboardingVersion: 0 }),
      needsVersionUpdate: () => get().onboardingVersion < CURRENT_ONBOARDING_VERSION,
      markVersionCurrent: () => set({ onboardingVersion: CURRENT_ONBOARDING_VERSION }),
    }),
    {
      name: 'courtlens-onboarding',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
