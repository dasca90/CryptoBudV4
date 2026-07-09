export type AiTakeoverMode = 'OFF' | 'ON';

export type AiProviderName = 'OFF' | 'OpenCode' | 'OpenCode Go' | 'OpenAI' | 'DeepSeek' | 'Ollama Local';

export type AiDecisionAction = 'BUY' | 'WAIT' | 'AVOID' | 'BLOCK';

export type AiExecutionStatus =
  | 'PENDING'
  | 'SKIPPED_OFF'
  | 'SCHEMA_VALIDATED'
  | 'RETRO_ANALYZED'
  | 'RISK_CHECKED'
  | 'BUY_INTENT_CREATED'
  | 'BLOCKED'
  | 'SUBMITTED'
  | 'FAILED';

export interface AiTakeoverConfig {
  mode: AiTakeoverMode;
  provider: AiProviderName;
  model: string;
  timeoutMs: number;
  maxCandidatesPerScan: number;
  maxResultsPerMission: number;
  minCleanUpsidePct: number;
  minConfidence: number;
  minTp1Pct: number;
  maxTp1Pct: number;
}

export interface AiRetrospectiveMetrics {
  range1hPct: number;
  range4hPct: number;
  range24hPct: number;
  range3dPct: number;
  range7dPct: number;
  range21dPct: number;
  recentHighDistancePct: number;
  recentLowDistancePct: number;
  supportDistancePct: number;
  resistanceDistancePct: number;
  cleanUpsidePct: number;
  downsideRiskPct: number;
  volatilityPct: number;
  averageReboundAfterDipPct: number;
  pumpRiskPct: number;
  candleExhaustion: boolean;
  overextended: boolean;
  liquidityDepthStatus: 'PASS' | 'WARN' | 'FAIL';
  spreadStabilityStatus: 'PASS' | 'WARN' | 'FAIL';
  volumeStabilityStatus: 'PASS' | 'WARN' | 'FAIL';
}

export interface AiDecisionInput {
  symbol: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  volume24h: number;
  change5m: number;
  change15m: number;
  change1h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  marketRegime: string;
  btcRegime: string;
  ethRegime?: string;
  riskGroup: string | null;
  strategy: string;
  confidence: number;
  priceFresh?: boolean;
  bookFresh?: boolean;
  duplicateOpenPosition?: boolean;
  maxOpenPositionsOk?: boolean;
  maxCapitalPerTradeOk?: boolean;
  maxDailyLossOk?: boolean;
  maxTradesPerDayOk?: boolean;
  cooldownOk?: boolean;
  minOrderNotionalOk?: boolean;
  slDefined?: boolean;
  tpRoomOk?: boolean;
  retrospective?: AiRetrospectiveMetrics | null;
}

export interface AiDecisionOutput {
  decision: AiDecisionAction;
  confidence: number;
  professionalVerdict: string;
  strategy: string;
  marketRead: {
    regime: string;
    btcEthAlignment: string;
    trendQuality: string;
    entryQuality: string;
    riskLevel: string;
  };
  retrospectiveSummary: {
    expectedUpsidePct: number;
    expectedDownsidePct: number;
    rangeClass: string;
    supportDistancePct: number;
    resistanceDistancePct: number;
    volatilityRisk: string;
  };
  tpPlan: {
    tp1Pct: number;
    tp1Reason: string;
    tp2Pct: number;
  };
  riskPlan: {
    slPct: number;
    maxCapitalUsd: number;
    riskRewardRatio: number;
  };
  executionIntent: {
    wantsBuy: boolean;
    urgency: 'low' | 'normal' | 'high';
    rejectIf: string[];
  };
  reason: string;
}

export interface AiDecisionRecord {
  id: string;
  timestamp: number;
  symbol: string;
  input: AiDecisionInput | null;
  rawResponse: string;
  parsedOutput: AiDecisionOutput | null;
  validationErrors: string[];
  validationWarnings: string[];
  riskVerdict: 'PENDING' | 'ALLOWED' | 'BLOCKED';
  retrospectiveVerdict: string | null;
  status: AiExecutionStatus;
  mode: AiTakeoverMode;
  executionMode: string;
  executionId: string | null;
  buyIntentCreated: boolean;
  submitAttempted: boolean;
  blockedReason: string | null;
  auditEntries: AiAuditEntry[];
}

export interface AiAuditEntry {
  timestamp: number;
  event: AiAuditEvent;
  message: string;
  data: Record<string, unknown>;
}

export type AiAuditEvent =
  | 'AI_TAKEOVER_MODE_AUDIT'
  | 'AI_CONTEXT_BUILD_AUDIT'
  | 'AI_PROFESSIONAL_RULES_AUDIT'
  | 'AI_RETROSPECTIVE_ANALYSIS_AUDIT'
  | 'AI_DECISION_REQUEST_AUDIT'
  | 'AI_DECISION_RESPONSE_AUDIT'
  | 'AI_SCHEMA_VALIDATION_AUDIT'
  | 'AI_TP1_DYNAMIC_SELECTION_AUDIT'
  | 'AI_TP1_BOUNDARY_AUDIT'
  | 'AI_TP2_FORCED_ZERO_AUDIT'
  | 'AI_RISK_GUARD_AUDIT'
  | 'AI_BUY_INTENT_AUDIT'
  | 'AI_BUY_BLOCKED_AUDIT'
  | 'AI_BUY_SUBMIT_AUDIT'
  | 'AI_POSITION_SOURCE_AUDIT'
  | 'AI_COMMAND_RECEIVED_AUDIT'
  | 'AI_MISSION_PARSED_AUDIT'
  | 'AI_MISSION_STARTED_AUDIT'
  | 'AI_OPPORTUNITY_RANKING_AUDIT'
  | 'AI_ANTI_FOMO_GUARD_AUDIT'
  | 'AI_ANTI_RUGPULL_GUARD_AUDIT'
  | 'AI_NEW_LISTING_GUARD_AUDIT'
  | 'AI_MISSION_DECISION_AUDIT'
  | 'AI_MISSION_BUY_INTENT_AUDIT'
  | 'AI_MISSION_BUY_BLOCKED_AUDIT'
  | 'AI_MISSION_BUY_SUBMIT_AUDIT'
  | 'AI_COMMAND_CENTER_UI_AUDIT';

export interface AiPositionRecord {
  id: string;
  decisionId: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  notional: number;
  stopLoss: number;
  tp1: number;
  tp2: 0;
  owner: 'AI_TAKEOVER';
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
  status: 'OPEN' | 'CLOSED' | 'REJECTED';
}

export const AI_TAKEOVER_STORAGE_KEYS = {
  settings: 'cryptobud_v5_ai_settings',
  decisions: 'cryptobud_v5_ai_decisions',
  missions: 'cryptobud_v5_ai_missions',
  audit: 'cryptobud_v5_ai_audit',
  positions: 'cryptobud_v5_ai_positions',
  journal: 'cryptobud_v5_ai_journal',
} as const;

export const AI_TAKEOVER_DEFAULT_CONFIG: AiTakeoverConfig = {
  mode: 'OFF',
  provider: 'OFF',
  model: '',
  timeoutMs: 12000,
  maxCandidatesPerScan: 3,
  maxResultsPerMission: 3,
  minCleanUpsidePct: 3,
  minConfidence: 0.7,
  minTp1Pct: 1.2,
  maxTp1Pct: 5.0,
};

export function isAiTakeoverActive(config: AiTakeoverConfig): boolean {
  return config.mode === 'ON';
}

export function canAiCreateBuyIntent(config: AiTakeoverConfig): boolean {
  return config.mode === 'ON';
}
