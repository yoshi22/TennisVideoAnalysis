import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { defaultStorage } from '@/services/storage';
import { type FormAnalysis } from '@/types';

interface FormAnalysisStoreState {
  analyses: FormAnalysis[];
  addAnalysis: (analysis: FormAnalysis) => void;
  deleteAnalysis: (id: string) => void;
  clearAll: () => void;
}

export const useFormAnalysisStore = create<FormAnalysisStoreState>()(
  persist(
    (set) => ({
      analyses: [],
      addAnalysis: (analysis) =>
        set((state) => ({
          analyses: [analysis, ...state.analyses],
        })),
      deleteAnalysis: (id) =>
        set((state) => ({
          analyses: state.analyses.filter((a) => a.id !== id),
        })),
      clearAll: () => set({ analyses: [] }),
    }),
    {
      name: 'courtlens-form-analyses',
      storage: createJSONStorage(() => defaultStorage),
    }
  )
);
