import { type TennisAnalysisResult, type TennisSession } from '@/types';

export interface TennisAnalyzer {
  analyze(session: TennisSession): TennisAnalysisResult;
}
