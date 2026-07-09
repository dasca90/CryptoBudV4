import type { AiDecisionOutput } from '../AiTakeoverTypes';
import type { AiGuardResult } from '../guards/AiAntiFomoGuard';

export type AiMissionType = 'FIND_UNICORNS' | 'FIND_COINS_WITH_UPSIDE' | 'ANALYZE_SYMBOL' | 'RANK_CANDIDATES' | 'APPLY_GUARDS';

export interface AiMission {
  missionType: AiMissionType;
  maxResults: number;
  minCleanUpsidePct: number;
  requireRetrospectiveAnalysis: boolean;
  antiFomo: boolean;
  antiRugpull: boolean;
  antiManipulation: boolean;
  newListingGuard: boolean;
  allowBuyIntent: boolean;
}

export interface AiCommandCenterCard {
  symbol: string;
  decision: 'BUY_INTENT' | 'WAIT' | 'AVOID' | 'BLOCK';
  confidence: number;
  expectedUpsidePct: number;
  expectedDownsidePct: number;
  riskRewardRatio: number;
  tp1SuggestedPct: number;
  tp2Pct: 0;
  slPct: number;
  antiFomo: AiGuardResult['status'];
  antiRugpullManipulation: AiGuardResult['status'];
  newListingGuard: AiGuardResult['status'];
  aiReason: string;
  executionStatus: 'WAITING_FOR_GUARDS' | 'SUBMITTED' | 'BLOCKED';
  blockedReason: string | null;
  rawDecision?: AiDecisionOutput;
}
