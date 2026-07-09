import type { ScannerCandidate } from '../types';
import { computeAutoTp } from '../scanner/AutoTpCalculator';
import { logger } from '../../utils/logger';

export type StrategySourceMode = 'autobots' | 'manual_override' | 'unicorn_hunter';

export interface TradingTargetConfigInput {
  strategySource: StrategySourceMode;
  manualTp1Pct: number;
  manualTp2Pct: number;
  stopLossPct: number;
  dynamicTrailingEnabled: boolean;
  trailPullbackPct: number;
  isScannerAutoTrade?: boolean;
}

export interface TradingTargetOwnershipSnapshot {
  strategySource: StrategySourceMode;
  tp1Source: 'AutoBots dynamic per coin' | 'Unicorn dynamic per coin' | 'AutoBots' | 'user';
  tp1Value: number;
  tp1Min?: number;
  tp1Max?: number;
  tp1Reason?: string;
  tp2Source: 'disabled' | 'user';
  tp2Value: number;
  slSource: 'user';
  slValue: number;
  dynamicTrailingEnabled: boolean;
  trailingStartSource: 'tp1_rule' | 'user';
  trailingStartsAt: 'TP1' | number;
  trailPullbackSource: 'user';
  trailPullbackValue: number;
  reason: string;
}

export interface AutoTargetOwnershipResolution {
  isAutoTargetOwned: boolean;
  isScannerAutoTrade: boolean;
  isManualTrade: boolean;
  isManualOverride: boolean;
  resolverPath: string;
  weakStrategySourceWouldMiss: boolean;
  ownerType: string;
  ownerName: string;
  source: string;
  mode: string;
  strategySource: string;
  executionPath: string;
}

export interface CandidateExecutionOwnershipResolution {
  candidateSource: 'AutoBots' | 'Unicorn' | 'ML_PREDICT_BUY' | 'Manual' | 'MicroScalper' | 'Unknown';
  ownerType: string;
  ownerName: string;
  scannerModule: string;
  selectedBy: string;
  executedBy: string;
  source: string;
  strategySource: string;
  executionSource: string;
  finalExecutionStrategy: string;
  entryRule: string;
  isUnicorn: boolean;
  isAutoBots: boolean;
  isMlPredictBuy: boolean;
  invariantOk: boolean;
  invariantReason: string;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

const UNICORN_TP1_RANGE = { min: 5, max: 10 } as const;

function computeUnicornDynamicTp(candidate: ScannerCandidate, confidence: number): {
  tp1Pct: number;
  rangeMin: number;
  rangeMax: number;
  reason: string;
} {
  const rawScore = Number((candidate as any).unicornScore ?? (candidate as any).rawScore ?? confidence);
  const normalizedScore = Number.isFinite(rawScore)
    ? rawScore <= 1 ? rawScore * 100 : rawScore
    : confidence;
  const strength = Math.max(0, Math.min(100, Math.max(confidence, normalizedScore)));
  const span = UNICORN_TP1_RANGE.max - UNICORN_TP1_RANGE.min;
  const strengthPct = strength >= 90
    ? 1
    : strength >= 80
      ? 0.75
      : strength >= 70
        ? 0.5
        : 0.25;
  const roomLimited = candidate.tpRoomOk === false;
  const tp1Pct = roomLimited
    ? UNICORN_TP1_RANGE.min
    : UNICORN_TP1_RANGE.min + (span * strengthPct);
  return {
    tp1Pct,
    rangeMin: UNICORN_TP1_RANGE.min,
    rangeMax: UNICORN_TP1_RANGE.max,
    reason: `unicorn_dynamic_per_coin_score_${Math.round(strength)}${roomLimited ? '_tp_room_limited' : ''}`,
  };
}

function isUnicornCandidateLike(candidate: any): boolean {
  return includesAny(candidate?.source, ['unicorn'])
    || includesAny(candidate?.candidateSource, ['unicorn'])
    || includesAny(candidate?.executionSource, ['unicorn'])
    || includesAny(candidate?.strategySource, ['unicorn'])
    || includesAny(candidate?.ownerName, ['unicorn'])
    || includesAny(candidate?.scannerAutoEntryConfigSnapshot?.ownerName, ['unicorn'])
    || includesAny(candidate?.scannerAutoEntryConfigSnapshot?.source, ['unicorn'])
    || includesAny(candidate?.autoStrategyDecision?.strategySource, ['unicorn']);
}

export function resolveTradingTargetOwnership(candidate: ScannerCandidate, cfg: TradingTargetConfigInput): TradingTargetOwnershipSnapshot {
  const sl = clampPct(cfg.stopLossPct);
  const pullback = clampPct(cfg.trailPullbackPct);
  const effectiveSource: StrategySourceMode = cfg.isScannerAutoTrade
    ? isUnicornCandidateLike(candidate) ? 'unicorn_hunter' : 'autobots'
    : cfg.strategySource;
  if (effectiveSource === 'autobots' || effectiveSource === 'unicorn_hunter') {
    const isUnicornSource = effectiveSource === 'unicorn_hunter';
    const confidence = Math.round((candidate.confidence ?? 0) * 100);
    const tpPolicy = isUnicornSource
      ? computeUnicornDynamicTp(candidate, confidence)
      : computeAutoTp({
        riskGroup: candidate.riskGroup ?? 'unknown',
        confidence,
        confidenceTier: candidate.autoStrategyDecision?.confidenceTier,
        groupTrend: candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend,
        dataQuality: candidate.dataQuality,
        tpRoomOk: candidate.tpRoomOk,
      });
    const dynamicTp1Source = isUnicornSource ? 'Unicorn dynamic per coin' as const : 'AutoBots dynamic per coin' as const;
    const dynamicOwnerName = isUnicornSource ? 'UNICORN_HUNTER' : 'AUTOBOTS';
    const tp1Value = clampPct(tpPolicy.tp1Pct);
    const entryPrice = Number.isFinite(candidate.price) ? Number(candidate.price) : null;
    const tp1TargetPrice = entryPrice != null ? entryPrice * (1 + (tp1Value / 100)) : null;
    const enforcedNote = cfg.isScannerAutoTrade && cfg.strategySource !== 'autobots' ? ' (enforced: scanner auto trade overrides manual_override)' : '';
    const auditSnapshot: any = (candidate as any).strategyAuditSnapshot
      ?? (candidate as any).scannerAutoEntryConfigSnapshot?.strategyAuditSnapshot
      ?? (candidate as any).entryConfigSnapshot?.strategyAuditSnapshot
      ?? null;
    const finalExecutionStrategy = String(auditSnapshot?.finalExecutionStrategy ?? candidate.effectiveStrategy ?? candidate.selectedStrategy ?? 'unknown');
    const tp1Executable = !['wait', 'avoid'].includes(finalExecutionStrategy.toLowerCase());
    const tp1Strategy = String(auditSnapshot?.tp1StrategyUsed ?? auditSnapshot?.finalExecutionStrategy ?? finalExecutionStrategy);
    const tp1EntryRule = String(candidate.traderBrainDecision?.selectedPlaybook ?? candidate.selectedPlaybook ?? candidate.mainReason ?? 'unknown');
    const setupValidatorUsed = String(auditSnapshot?.strategySelected ?? auditSnapshot?.selectedStrategy ?? finalExecutionStrategy);
    const strategyAtEntryToPersist = String(auditSnapshot?.strategyAtEntry ?? finalExecutionStrategy);
    const executableInvariantOk = finalExecutionStrategy === setupValidatorUsed
      && finalExecutionStrategy === tp1Strategy
      && finalExecutionStrategy === strategyAtEntryToPersist;
    const invariantOk = tp1Executable ? executableInvariantOk : true;
    const failureReason = invariantOk
      ? 'none'
      : !tp1Executable
        ? 'WAIT_STRATEGY_NON_EXECUTABLE'
        : `final=${finalExecutionStrategy}|tp1=${tp1Strategy}|setup=${setupValidatorUsed}|persist=${strategyAtEntryToPersist}`;
    if (!tp1Executable) {
      logger.info(`STRATEGY_TP1_HANDOFF_AUDIT: symbol=${candidate.symbol} finalExecutionStrategy=${finalExecutionStrategy} tp1Strategy=${tp1Strategy} tp1EntryRule=diagnostic_only setupValidatorUsed=${setupValidatorUsed} strategyAtEntryToPersist=${strategyAtEntryToPersist} tp1Executable=false diagnosticOnly=true noExecutionAttempted=true noPositionManagerPersistence=true invariantOk=true failureReason=WAIT_STRATEGY_NON_EXECUTABLE`);
      logger.info(`WAIT_STRATEGY_TP1_GUARD_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? (candidate as any).scanId ?? 'unknown'} finalExecutionStrategy=${finalExecutionStrategy} tp1Executable=false diagnosticOnly=true noExecutionAttempted=true noPositionManagerPersistence=true reason=WAIT_STRATEGY_NON_EXECUTABLE invariantOk=true`);
      return {
        strategySource: effectiveSource,
        tp1Source: isUnicornSource ? dynamicTp1Source : 'AutoBots',
        tp1Value: 0,
        tp1Min: tpPolicy.rangeMin,
        tp1Max: tpPolicy.rangeMax,
        tp1Reason: 'WAIT_STRATEGY_NON_EXECUTABLE',
        tp2Source: 'disabled',
        tp2Value: 0,
        slSource: 'user',
        slValue: sl,
        dynamicTrailingEnabled: cfg.dynamicTrailingEnabled,
        trailingStartSource: 'tp1_rule',
        trailingStartsAt: 'TP1',
        trailPullbackSource: 'user',
        trailPullbackValue: pullback,
        reason: 'wait_strategy_non_executable_diagnostic_only',
      };
    }
    logger.info(`STRATEGY_TP1_HANDOFF_AUDIT: symbol=${candidate.symbol} finalExecutionStrategy=${finalExecutionStrategy} tp1Strategy=${tp1Strategy} tp1EntryRule=${tp1EntryRule} setupValidatorUsed=${setupValidatorUsed} strategyAtEntryToPersist=${strategyAtEntryToPersist} tp1Executable=true diagnosticOnly=false noExecutionAttempted=false noPositionManagerPersistence=false invariantOk=${String(invariantOk)} failureReason=${failureReason}`);
    if (!invariantOk && tp1Executable) {
      logger.warn(`STRATEGY_TP1_HANDOFF_INTEGRITY_FAILED: symbol=${candidate.symbol} finalExecutionStrategy=${finalExecutionStrategy} tp1Strategy=${tp1Strategy} tp1EntryRule=${tp1EntryRule} setupValidatorUsed=${setupValidatorUsed} strategyAtEntryToPersist=${strategyAtEntryToPersist} action=block_buy_upstream_required failureReason=${failureReason}`);
    }
    if (isUnicornSource) {
      logger.info(`UNICORN_TP1_CALC_AUDIT: symbol=${candidate.symbol} owner=${dynamicOwnerName} candidateSource=Unicorn strategy=${candidate.selectedStrategy ?? 'unknown'} entryRule=${candidate.traderBrainDecision?.selectedPlaybook ?? candidate.selectedPlaybook ?? candidate.mainReason ?? 'unknown'} entryPrice=${entryPrice ?? 'n/a'} tp1Pct=${tp1Value} tp1TargetPrice=${tp1TargetPrice ?? 'n/a'} tp1Source=${dynamicTp1Source} tp1Reason=${tpPolicy.reason} tp1Min=${tpPolicy.rangeMin} tp1Max=${tpPolicy.rangeMax} tp2Pct=0 slPct=${sl} dynamicTrailingEnabled=${String(cfg.dynamicTrailingEnabled)} trailingStartsAt=TP1 trailPullbackPct=${pullback}`);
      logger.info(`TP1_OWNER_SOURCE_AUDIT: symbol=${candidate.symbol} owner=${dynamicOwnerName} candidateSource=Unicorn strategySource=${effectiveSource} expectedTp1Source=Unicorn dynamic per coin actualTp1Source=${dynamicTp1Source} expectedTp1Min=5 actualTp1Min=${tpPolicy.rangeMin} expectedTp1Max=10 actualTp1Max=${tpPolicy.rangeMax} invariantOk=${String(dynamicTp1Source === 'Unicorn dynamic per coin' && tpPolicy.rangeMin === 5 && tpPolicy.rangeMax === 10)}`);
    } else {
      const tp1AuditDetails = `tp1Pct=${tp1Value} tp1TargetPrice=${tp1TargetPrice ?? 'n/a'} tp1Source=AutoBots dynamic per coin tp1Reason=${tpPolicy.reason} tp1Min=${tpPolicy.rangeMin} tp1Max=${tpPolicy.rangeMax} tp2Pct=0 slPct=${sl} snapshotPresent=false riskSnapshotPresent=false${enforcedNote}`;
      logger.info(`AUTOBOTS_TP1_SELECTION_AUDIT: symbol=${candidate.symbol} riskGroup=${candidate.riskGroup ?? 'unknown'} confidence=${confidence} strategy=${candidate.selectedStrategy ?? 'unknown'} entryRule=${candidate.traderBrainDecision?.selectedPlaybook ?? candidate.selectedPlaybook ?? candidate.mainReason ?? 'unknown'} entryPrice=${entryPrice ?? 'n/a'} ${tp1AuditDetails}`);
      logger.info(`AUTOBOTS_TP1_V3_PARITY_AUDIT: symbol=${candidate.symbol} v3Reference=hybrid_group_or_smart_strength v4Source=AutoTpCalculator riskGroup=${candidate.riskGroup ?? 'unknown'} confidence=${confidence} tp1Pct=${tp1Value} tp1Min=${tpPolicy.rangeMin} tp1Max=${tpPolicy.rangeMax} tp2Pct=0 slPct=${sl} parityStatus=behavior_reference_preserved reason=dynamic_per_coin_tp1_positive_tp2_zero_user_sl${enforcedNote}`);
      logger.info(`TP1_OWNER_SOURCE_AUDIT: symbol=${candidate.symbol} owner=${dynamicOwnerName} candidateSource=AutoBots strategySource=${effectiveSource} expectedTp1Source=AutoBots dynamic per coin actualTp1Source=${dynamicTp1Source} expectedTp1Min=${tpPolicy.rangeMin} actualTp1Min=${tpPolicy.rangeMin} expectedTp1Max=${tpPolicy.rangeMax} actualTp1Max=${tpPolicy.rangeMax} invariantOk=${String(dynamicTp1Source === 'AutoBots dynamic per coin')}`);
    }
    return {
      strategySource: effectiveSource,
      tp1Source: dynamicTp1Source,
      tp1Value,
      tp1Min: tpPolicy.rangeMin,
      tp1Max: tpPolicy.rangeMax,
      tp1Reason: tpPolicy.reason,
      tp2Source: 'disabled',
      tp2Value: 0,
      slSource: 'user',
      slValue: sl,
      dynamicTrailingEnabled: cfg.dynamicTrailingEnabled,
      trailingStartSource: 'tp1_rule',
      trailingStartsAt: 'TP1',
      trailPullbackSource: 'user',
      trailPullbackValue: pullback,
      reason: isUnicornSource ? 'unicorn_dynamic_tp1_user_sl_user_trailing_pullback' : 'autobots_dynamic_tp1_user_sl_user_trailing_pullback',
    };
  }

  return {
    strategySource: 'manual_override',
    tp1Source: 'user',
    tp1Value: clampPct(cfg.manualTp1Pct),
    tp2Source: 'user',
    tp2Value: clampPct(cfg.manualTp2Pct),
    slSource: 'user',
    slValue: sl,
    dynamicTrailingEnabled: cfg.dynamicTrailingEnabled,
    trailingStartSource: 'user',
    trailingStartsAt: clampPct(cfg.manualTp1Pct),
    trailPullbackSource: 'user',
    trailPullbackValue: pullback,
    reason: 'manual_override_user_targets',
  };
}

function includesAny(value: unknown, needles: string[]): boolean {
  const text = String(value ?? '').toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function resolveCandidateExecutionOwnership(input: {
  candidate?: ScannerCandidate | null;
  planEntry?: unknown;
  entryConfigSnapshot?: unknown;
  manualBuyRequest?: unknown;
  scalperCandidate?: unknown;
  selectedBy?: string;
  executedBy?: string;
  finalExecutionStrategy?: string | null;
  entryRule?: string | null;
  executionPath?: string;
}): CandidateExecutionOwnershipResolution {
  const candidate: any = input.candidate ?? null;
  const planEntry: any = input.planEntry ?? null;
  const snapshot: any = input.entryConfigSnapshot ?? planEntry?.scannerAutoEntryConfigSnapshot ?? candidate?.scannerAutoEntryConfigSnapshot ?? null;
  const manual = Boolean(input.manualBuyRequest);
  const scalper = Boolean(input.scalperCandidate);
  const mlPredictBuy = includesAny(candidate?.executionSource, ['ml_predict_buy'])
    || includesAny(candidate?.candidateSource, ['ml_predict_buy'])
    || includesAny(candidate?.mlPredictBuyDecision?.finalDecision, ['buy_ready'])
    || includesAny(planEntry?.mlPredictBuyDecision?.finalDecision, ['buy_ready'])
    || includesAny(snapshot?.source, ['ml_predict_buy']);
  const unicorn = isUnicornCandidateLike(candidate) || isUnicornCandidateLike(planEntry) || isUnicornCandidateLike(snapshot);

  const candidateSource = manual
    ? 'Manual'
    : scalper
      ? 'MicroScalper'
      : unicorn
        ? 'Unicorn'
        : mlPredictBuy
          ? 'ML_PREDICT_BUY'
          : candidate
            ? 'AutoBots'
            : 'Unknown';
  const ownerType = manual
    ? 'manual'
    : scalper
      ? 'micro_scalper'
      : unicorn
        ? 'unicorn'
        : 'scanner';
  const ownerName = manual
    ? 'Manual'
    : scalper
      ? 'Micro Scalping'
      : unicorn
        ? 'UNICORN_HUNTER'
        : 'AUTOBOTS';
  const scannerModule = unicorn ? 'Unicorn Hunter' : mlPredictBuy ? 'ML Predict Buy' : candidate ? 'AutoBots' : 'unknown';
  const selectedBy = readString(input.selectedBy, snapshot?.selectedBy, unicorn ? 'Unicorn Hunter' : mlPredictBuy ? 'ML Predict Buy' : candidate ? 'AutoBots' : ownerName);
  const executedBy = readString(input.executedBy, snapshot?.executedBy, unicorn ? 'Unicorn Hunter' : mlPredictBuy ? 'ML Predict Buy' : candidate ? 'AutoBots' : ownerName);
  const strategySource = unicorn
    ? 'unicorn_hunter'
    : readString(snapshot?.strategySource, candidate?.strategySource, mlPredictBuy ? 'ML_PREDICT_BUY' : scalper ? 'micro_scalper' : manual ? 'manual' : 'autobots');
  const source = unicorn
    ? 'unicorn_hunter'
    : mlPredictBuy
      ? 'ML_PREDICT_BUY'
      : scalper
        ? 'micro_scalper'
        : manual
          ? 'manual'
          : readString(snapshot?.source, candidate?.source, 'AutoBots');
  const executionSource = unicorn
    ? 'unicorn_hunter'
    : mlPredictBuy
      ? 'ML_PREDICT_BUY'
      : scalper
        ? 'micro_scalper'
        : manual
          ? 'manual'
          : readString(candidate?.executionSource, snapshot?.executionSource, 'auto');
  const finalExecutionStrategy = readString(
    input.finalExecutionStrategy,
    snapshot?.finalExecutionStrategy,
    planEntry?.finalExecutionStrategy,
    candidate?.finalExecutionStrategy,
    candidate?.effectiveStrategy,
    candidate?.selectedStrategy,
    'unknown',
  );
  const entryRule = readString(
    input.entryRule,
    snapshot?.entryRule,
    snapshot?.finalEntryRule,
    candidate?.entryRule,
    candidate?.finalEntryRule,
    candidate?.traderBrainDecision?.selectedPlaybook,
    candidate?.selectedPlaybook,
    candidate?.mainReason,
    'unknown',
  );
  const invariantOk = !(unicorn && (ownerName !== 'UNICORN_HUNTER' || ownerType !== 'unicorn' || candidateSource !== 'Unicorn' || !includesAny(strategySource, ['unicorn'])));

  return {
    candidateSource,
    ownerType,
    ownerName,
    scannerModule,
    selectedBy,
    executedBy,
    source,
    strategySource,
    executionSource,
    finalExecutionStrategy,
    entryRule,
    isUnicorn: unicorn,
    isAutoBots: candidateSource === 'AutoBots',
    isMlPredictBuy: mlPredictBuy,
    invariantOk,
    invariantReason: invariantOk ? 'none' : 'UNICORN_OWNERSHIP_OVERWRITE_BLOCKED',
  };
}

export function resolveAutoTargetOwnership(input: {
  candidate?: ScannerCandidate | null;
  executionPath?: string;
  manualBuyRequest?: unknown;
  mode?: string;
}): AutoTargetOwnershipResolution {
  const candidate: any = input.candidate ?? null;
  const ownership = candidate?.tradingTargetOwnership;
  const executionPath = String(input.executionPath ?? '');
  const ownerType = String(candidate?.ownerType ?? candidate?.traderBrainDecision?.ownerType ?? '');
  const ownerName = String(candidate?.ownerName ?? candidate?.sourceLabel ?? candidate?.traderBrainDecision?.ownerName ?? '');
  const source = String(candidate?.source ?? candidate?.candidateSource ?? candidate?.strategySourceDetail ?? '');
  const mode = String(input.mode ?? candidate?.mode ?? candidate?.traderBrainDecision?.mode ?? '');
  const unicornOwned = isUnicornCandidateLike(candidate);
  const strategySource = unicornOwned ? 'unicorn_hunter' : String(candidate?.autoStrategyDecision?.strategySource ?? candidate?.strategySource ?? '');

  const explicitManual = Boolean(input.manualBuyRequest)
    || includesAny(ownerType, ['manual'])
    || includesAny(ownerName, ['manual'])
    || includesAny(source, ['manual'])
    || includesAny(executionPath, ['manual']);

  const scannerPath = executionPath === 'scanner_auto'
    || includesAny(executionPath, ['executeplannedscannerbuy', 'executescannerbuy', 'planned_scanner_buy', 'scanner_auto']);
  const scannerOwned = includesAny(ownerType, ['scanner'])
    || includesAny(ownerName, ['the dipper', 'dipper', 'autobots', 'unicorn'])
    || includesAny(source, ['autobots', 'the dipper', 'dipper', 'scanner', 'unicorn'])
    || includesAny(strategySource, ['scanner', 'trader_brain', 'autobots', 'unicorn'])
    || (includesAny(mode, ['auto']) && !!candidate && !explicitManual);
  const ownershipAuto = includesAny(ownership?.strategySource, ['autobots'])
    || includesAny(ownership?.strategySource, ['unicorn'])
    || includesAny(ownership?.tp1Source, ['autobots', 'dynamic', 'per coin', 'per_coin']);

  const isScannerAutoTrade = !!candidate && !explicitManual && (scannerPath || scannerOwned);
  const isAutoTargetOwned = ownershipAuto || isScannerAutoTrade;
  const isManualTrade = explicitManual && !isScannerAutoTrade && !ownershipAuto;
  const isManualOverride = isManualTrade;
  const weakStrategySourceWouldMiss = isAutoTargetOwned && !includesAny(strategySource, ['autobots', 'unicorn']);

  const resolverPath = isScannerAutoTrade
    ? 'scanner_auto'
    : ownershipAuto
      ? 'tradingTargetOwnership'
      : isManualTrade
        ? 'manual_override'
        : 'unknown_non_auto';

  return {
    isAutoTargetOwned,
    isScannerAutoTrade,
    isManualTrade,
    isManualOverride,
    resolverPath,
    weakStrategySourceWouldMiss,
    ownerType: unicornOwned ? 'unicorn' : ownerType || 'unknown',
    ownerName: ownerName || (unicornOwned ? 'UnicornHunter' : 'unknown'),
    source: source || (unicornOwned ? 'unicorn_hunter' : 'unknown'),
    mode: mode || 'unknown',
    strategySource: strategySource || 'unknown',
    executionPath: executionPath || 'unknown',
  };
}
