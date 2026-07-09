import type {
  EntryGateOutput,
  MLPredictBuyDecision,
  MLPredictBuyMode,
  MLPredictBuyPrediction,
  MLPredictBuySettings,
} from '../types';
import { DEFAULT_ML_PREDICT_BUY_SETTINGS, normalizeMLPredictBuySettings } from './ml-brain-store';

export interface MLPredictBuyGateContext {
  symbol: string;
  scanCycleId: string;
  executionAdapter: 'paper_simulated' | 'binance_live';
  strategy: string;
  riskGroup: string | null;
  modelStatus: 'TRAINED' | 'UNTRAINED' | 'ERROR';
  brainLoaded: boolean;
  preMlGatePassed: boolean;
  mlGuardBlocked: boolean;
  priceFreshOk: boolean;
  bookFreshOk: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  notAlreadyOpen: boolean;
  notDuplicatePosition: boolean;
  notInCooldown: boolean;
  maxPositionsOk: boolean;
  groupCapOk: boolean;
  mlMaxOpenPositionsOk: boolean;
  mlMaxBuysPerHourOk: boolean;
  banlistOk: boolean;
  capitalOk: boolean;
  marketGuardOk: boolean;
  btcAnchorOk: boolean;
  professionalGateOk: boolean;
  strategyValidatorOk: boolean;
  scannerAgreementOk: boolean;
  emergencyStopOk: boolean;
  executionAdapterHealthy: boolean;
  dbOk: boolean;
  persistenceOk: boolean;
  entryGateDecision: EntryGateOutput | null;
}

export interface MLPredictBuyRouterInput {
  settings?: Partial<MLPredictBuySettings> | null;
  prediction: MLPredictBuyPrediction;
  context: MLPredictBuyGateContext;
}

type GateCheck = {
  name: string;
  passed: boolean;
};

function blocked(input: MLPredictBuyRouterInput, mode: MLPredictBuyMode, reason: string, failedGate: string): MLPredictBuyDecision {
  const { prediction, context } = input;
  return {
    symbol: context.symbol,
    scanCycleId: context.scanCycleId,
    predictedAction: prediction.predictedAction,
    predictedWinProb: prediction.predictedWinProb,
    badEntryRisk: prediction.badEntryRisk,
    expectedPnlPct: prediction.expectedPnlPct,
    modelConfidence: prediction.modelConfidence,
    featureCompleteness: prediction.featureCompleteness,
    rowsUsed: prediction.rowsUsed,
    sampleSizeOk: prediction.sampleSizeOk,
    strategy: context.strategy,
    riskGroup: context.riskGroup,
    preMlGatePassed: context.preMlGatePassed,
    mlGuardBlocked: context.mlGuardBlocked,
    postMlHardGatesPassed: false,
    entryGateApproved: context.entryGateDecision?.decision === 'ALLOW',
    finalDecision: 'BLOCKED',
    blockedReason: reason,
    failedGate,
    executionMode: context.executionAdapter === 'binance_live' ? 'live' : 'demo',
    executionAdapter: context.executionAdapter,
    mode,
    source: 'ML_PREDICT_BUY',
  };
}

function passiveDecision(input: MLPredictBuyRouterInput, mode: MLPredictBuyMode, finalDecision: MLPredictBuyDecision['finalDecision']): MLPredictBuyDecision {
  const { prediction, context } = input;
  return {
    symbol: context.symbol,
    scanCycleId: context.scanCycleId,
    predictedAction: prediction.predictedAction,
    predictedWinProb: prediction.predictedWinProb,
    badEntryRisk: prediction.badEntryRisk,
    expectedPnlPct: prediction.expectedPnlPct,
    modelConfidence: prediction.modelConfidence,
    featureCompleteness: prediction.featureCompleteness,
    rowsUsed: prediction.rowsUsed,
    sampleSizeOk: prediction.sampleSizeOk,
    strategy: context.strategy,
    riskGroup: context.riskGroup,
    preMlGatePassed: context.preMlGatePassed,
    mlGuardBlocked: context.mlGuardBlocked,
    postMlHardGatesPassed: false,
    entryGateApproved: context.entryGateDecision?.decision === 'ALLOW',
    finalDecision,
    blockedReason: null,
    failedGate: null,
    executionMode: context.executionAdapter === 'binance_live' ? 'live' : 'demo',
    executionAdapter: context.executionAdapter,
    mode,
    source: 'ML_PREDICT_BUY',
  };
}

function firstFailedGate(checks: GateCheck[]): GateCheck | null {
  return checks.find((check) => !check.passed) ?? null;
}

export function evaluateMLPredictBuy(input: MLPredictBuyRouterInput): MLPredictBuyDecision {
  const settings = normalizeMLPredictBuySettings(input.settings ?? DEFAULT_ML_PREDICT_BUY_SETTINGS);
  const mode = settings.mlPredictBuyMode;
  const { prediction, context } = input;

  if (!settings.mlPredictBuyEnabled || mode === 'OFF') {
    return passiveDecision(input, 'OFF', 'NO_INFLUENCE');
  }

  if (mode === 'PREDICT_ONLY') {
    return passiveDecision(input, mode, 'PREDICTED');
  }

  if (mode === 'SUGGEST_BUY') {
    return passiveDecision(input, mode, prediction.predictedAction === 'BUY' ? 'SUGGESTED' : 'PREDICTED');
  }

  const checks: GateCheck[] = [
    { name: 'model_trained', passed: context.modelStatus === 'TRAINED' },
    { name: 'brain_loaded', passed: context.brainLoaded },
    { name: 'rows_used', passed: prediction.rowsUsed >= settings.minTrainingRowsForAutoBuy },
    { name: 'predicted_action_buy', passed: prediction.predictedAction === 'BUY' },
    { name: 'predicted_win_prob', passed: prediction.predictedWinProb >= settings.minPredictedWinProb },
    { name: 'bad_entry_risk', passed: prediction.badEntryRisk <= settings.maxBadEntryRisk },
    { name: 'expected_pnl', passed: prediction.expectedPnlPct >= settings.minExpectedPnlPct },
    { name: 'feature_completeness', passed: prediction.featureCompleteness > 0 && prediction.featureCompleteness <= 1 },
    { name: 'pre_ml_gate', passed: context.preMlGatePassed },
    { name: 'ml_guard', passed: !settings.requireMlGuardNotBlocked || !context.mlGuardBlocked },
    { name: 'price_fresh', passed: context.priceFreshOk },
    { name: 'book_fresh', passed: context.bookFreshOk },
    { name: 'spread', passed: context.spreadOk },
    { name: 'tp_room', passed: context.tpRoomOk },
    { name: 'already_open', passed: context.notAlreadyOpen },
    { name: 'duplicate_position', passed: context.notDuplicatePosition },
    { name: 'cooldown', passed: context.notInCooldown },
    { name: 'max_positions', passed: context.maxPositionsOk },
    { name: 'group_cap', passed: context.groupCapOk },
    { name: 'ml_max_open_positions', passed: context.mlMaxOpenPositionsOk },
    { name: 'ml_max_buys_per_hour', passed: context.mlMaxBuysPerHourOk },
    { name: 'banlist', passed: context.banlistOk },
    { name: 'capital', passed: context.capitalOk },
    { name: 'market_guard', passed: !settings.requireMarketGuard || context.marketGuardOk },
    { name: 'btc_anchor', passed: !settings.requireBtcAnchorIfEnabled || context.btcAnchorOk },
    { name: 'professional_gate', passed: !settings.requireProfessionalGate || context.professionalGateOk },
    { name: 'strategy_validator', passed: !settings.requireStrategyValidator || context.strategyValidatorOk },
    { name: 'scanner_agreement', passed: !settings.requireScannerAgreement || context.scannerAgreementOk },
    { name: 'emergency_stop', passed: context.emergencyStopOk },
    { name: 'execution_adapter_healthy', passed: context.executionAdapterHealthy },
    { name: 'db', passed: context.dbOk },
    { name: 'persistence', passed: context.persistenceOk },
    { name: 'entry_gate', passed: context.entryGateDecision?.decision === 'ALLOW' },
  ];
  const failed = firstFailedGate(checks);
  if (failed) {
    return blocked(input, mode, failed.name, failed.name);
  }

  return {
    ...passiveDecision(input, mode, 'BUY_READY'),
    postMlHardGatesPassed: true,
    entryGateApproved: true,
  };
}

export function buildMLPredictBuyPredictionFromBrain(input: {
  symbol: string;
  winProbability: number | null;
  badEntryRisk: number;
  expectedMovePct: number | null;
  confidenceAdjustment: number;
  suggestedAction: 'ALLOW' | 'WAIT' | 'BLOCK';
  rowsUsed: number;
  modelVersion?: string | null;
  featureSchemaVersion?: string | null;
  reason: string;
}): MLPredictBuyPrediction {
  const predictedAction = input.suggestedAction === 'BLOCK'
    ? 'BLOCK'
    : input.winProbability !== null && input.winProbability >= DEFAULT_ML_PREDICT_BUY_SETTINGS.minPredictedWinProb
      ? 'BUY'
      : 'HOLD';
  return {
    symbol: input.symbol,
    predictedAction,
    predictedWinProb: input.winProbability ?? 0,
    badEntryRisk: input.badEntryRisk,
    expectedPnlPct: input.expectedMovePct ?? 0,
    modelConfidence: Math.max(0, Math.min(1, 1 + input.confidenceAdjustment)),
    featureCompleteness: 1,
    rowsUsed: input.rowsUsed,
    sampleSizeOk: input.rowsUsed >= DEFAULT_ML_PREDICT_BUY_SETTINGS.minTrainingRowsForAutoBuy,
    modelVersion: input.modelVersion ?? null,
    featureSchemaVersion: input.featureSchemaVersion ?? null,
    reason: input.reason,
  };
}
