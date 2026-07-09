export type AiTakeoverMode = 'OFF' | 'PAPER_ONLY' | 'LIVE_LOCKED' | 'LIVE_ENABLED';

export type AiDecisionAction = 'BUY' | 'WAIT' | 'AVOID';

export type AiExecutionStatus = 'PENDING' | 'SCHEMA_VALIDATED' | 'RISK_CHECKED' | 'RETRO_ANALYZED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';

export interface AiTakeoverConfig {
  mode: AiTakeoverMode;
  provider: 'openai' | 'deepseek';
  apiKey: string;
  model: string;
  maxDecisionAgeMs: number;
  minConfidenceScore: number;
  maxConcurrentAiPositions: number;
  maxAiTradesPerDay: number;
  paperAutoExecutionEnabled: boolean;
  requireRetrospectiveAnalysis: boolean;
  requireRiskGuard: boolean;
  requireSchemaValidation: boolean;
  requireHardGuardsBeforeLive: boolean;
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
  riskGroup: string | null;
  strategy: string;
  confidence: number;
}

export interface AiDecisionOutput {
  action: AiDecisionAction;
  confidenceScore: number;
  reason: string;
  suggestedEntryPrice: number | null;
  suggestedStopLossPct: number | null;
  suggestedTp1Pct: number | null;
  tp2Pct: number;
  maxHoldHours: number;
  metadata: Record<string, unknown>;
}

export interface AiDecisionRecord {
  id: string;
  timestamp: number;
  symbol: string;
  input: AiDecisionInput;
  rawResponse: string;
  parsedOutput: AiDecisionOutput | null;
  validationErrors: string[];
  riskVerdict: string;
  retrospectiveVerdict: string | null;
  status: AiExecutionStatus;
  finalMode: AiTakeoverMode;
  executionId: string | null;
  auditEntries: AiAuditEntry[];
}

export interface AiAuditEntry {
  timestamp: number;
  stage: string;
  message: string;
  data: Record<string, unknown>;
}

export interface AiPositionRecord {
  id: string;
  decisionId: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  notional: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  mode: AiTakeoverMode;
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
  status: 'OPEN' | 'CLOSED' | 'REJECTED';
}

export const AI_TAKEOVER_STORAGE_KEYS = {
  settings: 'cryptobud_v5_ai_settings',
  positions: 'cryptobud_v5_ai_positions',
  journal: 'cryptobud_v5_ai_journal',
  decisions: 'cryptobud_v5_ai_decisions',
  audit: 'cryptobud_v5_ai_audit',
} as const;

export const AI_TAKEOVER_DEFAULT_CONFIG: AiTakeoverConfig = {
  mode: 'OFF',
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  maxDecisionAgeMs: 30000,
  minConfidenceScore: 60,
  maxConcurrentAiPositions: 3,
  maxAiTradesPerDay: 10,
  paperAutoExecutionEnabled: false,
  requireRetrospectiveAnalysis: true,
  requireRiskGuard: true,
  requireSchemaValidation: true,
  requireHardGuardsBeforeLive: true,
};

export function isAiTakeoverActive(config: AiTakeoverConfig): boolean {
  return config.mode !== 'OFF';
}

export function canAiExecutePaper(config: AiTakeoverConfig): boolean {
  return config.mode === 'PAPER_ONLY' || config.mode === 'LIVE_LOCKED' || config.mode === 'LIVE_ENABLED';
}

export function canAiExecuteLive(config: AiTakeoverConfig): boolean {
  return config.mode === 'LIVE_ENABLED';
}

export function canAiCreateBuyIntent(config: AiTakeoverConfig): boolean {
  return config.mode === 'LIVE_LOCKED' || config.mode === 'LIVE_ENABLED';
}
