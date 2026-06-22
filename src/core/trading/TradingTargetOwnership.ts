import type { ScannerCandidate } from '../types';
import { computeAutoTp } from '../scanner/AutoTpCalculator';
import { logger } from '../../utils/logger';

export type StrategySourceMode = 'autobots' | 'manual_override';

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
  tp1Source: 'AutoBots dynamic per coin' | 'AutoBots' | 'user';
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

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function resolveTradingTargetOwnership(candidate: ScannerCandidate, cfg: TradingTargetConfigInput): TradingTargetOwnershipSnapshot {
  const sl = clampPct(cfg.stopLossPct);
  const pullback = clampPct(cfg.trailPullbackPct);
  const effectiveSource: StrategySourceMode = cfg.isScannerAutoTrade ? 'autobots' : cfg.strategySource;
  if (effectiveSource === 'autobots') {
    const confidence = Math.round((candidate.confidence ?? 0) * 100);
    const autoTp = computeAutoTp({
      riskGroup: candidate.riskGroup ?? 'unknown',
      confidence,
      confidenceTier: candidate.autoStrategyDecision?.confidenceTier,
      groupTrend: candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend,
      dataQuality: candidate.dataQuality,
      tpRoomOk: candidate.tpRoomOk,
    });
    const tp1Value = clampPct(autoTp.tp1Pct);
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
        strategySource: 'autobots',
        tp1Source: 'AutoBots',
        tp1Value: 0,
        tp1Min: autoTp.rangeMin,
        tp1Max: autoTp.rangeMax,
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
    const tp1AuditDetails = `tp1Pct=${tp1Value} tp1TargetPrice=${tp1TargetPrice ?? 'n/a'} tp1Source=AutoBots dynamic per coin tp1Reason=${autoTp.reason} tp1Min=${autoTp.rangeMin} tp1Max=${autoTp.rangeMax} tp2Pct=0 slPct=${sl} snapshotPresent=false riskSnapshotPresent=false${enforcedNote}`;
    logger.info(`AUTOBOTS_TP1_SELECTION_AUDIT: symbol=${candidate.symbol} riskGroup=${candidate.riskGroup ?? 'unknown'} confidence=${confidence} strategy=${candidate.selectedStrategy ?? 'unknown'} entryRule=${candidate.traderBrainDecision?.selectedPlaybook ?? candidate.selectedPlaybook ?? candidate.mainReason ?? 'unknown'} entryPrice=${entryPrice ?? 'n/a'} ${tp1AuditDetails}`);
    logger.info(`AUTOBOTS_TP1_V3_PARITY_AUDIT: symbol=${candidate.symbol} v3Reference=hybrid_group_or_smart_strength v4Source=AutoTpCalculator riskGroup=${candidate.riskGroup ?? 'unknown'} confidence=${confidence} tp1Pct=${tp1Value} tp1Min=${autoTp.rangeMin} tp1Max=${autoTp.rangeMax} tp2Pct=0 slPct=${sl} parityStatus=behavior_reference_preserved reason=dynamic_per_coin_tp1_positive_tp2_zero_user_sl${enforcedNote}`);
    return {
      strategySource: 'autobots',
      tp1Source: 'AutoBots dynamic per coin',
      tp1Value,
      tp1Min: autoTp.rangeMin,
      tp1Max: autoTp.rangeMax,
      tp1Reason: autoTp.reason,
      tp2Source: 'disabled',
      tp2Value: 0,
      slSource: 'user',
      slValue: sl,
      dynamicTrailingEnabled: cfg.dynamicTrailingEnabled,
      trailingStartSource: 'tp1_rule',
      trailingStartsAt: 'TP1',
      trailPullbackSource: 'user',
      trailPullbackValue: pullback,
      reason: 'autobots_dynamic_tp1_user_sl_user_trailing_pullback',
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
  const strategySource = String(candidate?.autoStrategyDecision?.strategySource ?? candidate?.strategySource ?? '');

  const explicitManual = Boolean(input.manualBuyRequest)
    || includesAny(ownerType, ['manual'])
    || includesAny(ownerName, ['manual'])
    || includesAny(source, ['manual'])
    || includesAny(executionPath, ['manual']);

  const scannerPath = executionPath === 'scanner_auto'
    || includesAny(executionPath, ['executeplannedscannerbuy', 'executescannerbuy', 'planned_scanner_buy', 'scanner_auto']);
  const scannerOwned = includesAny(ownerType, ['scanner'])
    || includesAny(ownerName, ['the dipper', 'dipper', 'autobots'])
    || includesAny(source, ['autobots', 'the dipper', 'dipper', 'scanner'])
    || includesAny(strategySource, ['scanner', 'trader_brain', 'autobots'])
    || (includesAny(mode, ['auto']) && !!candidate && !explicitManual);
  const ownershipAuto = includesAny(ownership?.strategySource, ['autobots'])
    || includesAny(ownership?.tp1Source, ['autobots', 'dynamic', 'per coin', 'per_coin']);

  const isScannerAutoTrade = !!candidate && !explicitManual && (scannerPath || scannerOwned);
  const isAutoTargetOwned = ownershipAuto || isScannerAutoTrade;
  const isManualTrade = explicitManual && !isScannerAutoTrade && !ownershipAuto;
  const isManualOverride = isManualTrade;
  const weakStrategySourceWouldMiss = isAutoTargetOwned && !includesAny(strategySource, ['autobots']);

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
    ownerType: ownerType || 'unknown',
    ownerName: ownerName || 'unknown',
    source: source || 'unknown',
    mode: mode || 'unknown',
    strategySource: strategySource || 'unknown',
    executionPath: executionPath || 'unknown',
  };
}
