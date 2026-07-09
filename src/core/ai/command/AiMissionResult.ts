import type { AiCommandCenterCard, AiMission } from './AiCommandCenterTypes';

export interface AiMissionResult {
  mission: AiMission;
  cards: AiCommandCenterCard[];
  blockedReason?: string | null;
  providerCallCount?: number;
  diagnostics?: {
    providerStatus: string;
    topK: number;
    candidatesSent: number;
    promptSizeChars: number;
    timeoutMs: number;
    latencyMs: number;
    retryCount: number;
    responseParsed: boolean;
    schemaValid: boolean;
    responseShape?: string;
    contentSource?: string;
    contentPreviewSafe?: string;
    marketSnapshotStatus?: string;
    marketSnapshotFreshness?: string;
    marketSnapshotSource?: string;
    marketSnapshotAgeMs?: number;
    scannerCandidatesCount?: number;
    usablePreRankCount?: number;
    usableDecisionCount?: number;
    bookTickerCacheAgeMs?: number;
    priceCacheAgeMs?: number;
    ticker24hrCacheAgeMs?: number;
    retrospectiveCacheAgeMs?: number;
    bookTickerFresh?: boolean;
    priceFresh?: boolean;
    retrospectiveFresh?: boolean;
    missingFields?: string[];
    staleFields?: string[];
    nextRetryInMs?: number;
    refreshAttempted?: boolean;
    refreshType?: string;
    refreshEndpoint?: string;
    refreshSuccess?: boolean;
    snapshotIdBefore?: string;
    snapshotIdAfter?: string;
    marketDataAction?: string;
    failureReason: string | null;
  };
  audit: string[];
}
