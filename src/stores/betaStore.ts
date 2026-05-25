import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';
import { generateId } from '@/utils/id';

export const CONSENT_VERSION = 1;

interface BetaState {
  participantId: string;
  consentVersion?: number;
  consentAcceptedAt?: string;
  giveConsent: () => void;
  revokeConsent: () => void;
}

export const useBetaStore = create<BetaState>()(
  persist(
    (set) => ({
      participantId: generateId(),
      consentVersion: undefined,
      consentAcceptedAt: undefined,
      giveConsent: () =>
        set({
          consentVersion: CONSENT_VERSION,
          consentAcceptedAt: new Date().toISOString(),
        }),
      revokeConsent: () =>
        set({
          consentVersion: undefined,
          consentAcceptedAt: undefined,
        }),
    }),
    {
      name: 'courtlens-beta',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);

export function hasValidConsent(
  state: Pick<BetaState, 'consentVersion' | 'consentAcceptedAt'>
): boolean {
  return (
    state.consentVersion === CONSENT_VERSION &&
    typeof state.consentAcceptedAt === 'string' &&
    !Number.isNaN(new Date(state.consentAcceptedAt).getTime())
  );
}
