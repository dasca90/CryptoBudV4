import type { ScannerCandidate, ScannerSnapshot, ExecutionPlan, PlannedCandidate, SkippedCandidate, PlannedAction, AutoStrategyDecision } from '../types';
import { logger } from '../../utils/logger';
import { buildCanonicalEntryGateSnapshot } from '../entry-gate/EntryGate';
import { buildStrategyAuditSnapshotFromCandidate } from '../strategy-audit/strategy-audit-builder';
import { resolveEntryRiskParams } from '../trading/entry-risk-resolver';
import { resolveAutoTargetOwnership, resolveTradingTargetOwnership } from '../trading/TradingTargetOwnership';

export interface ExecutionPlannerInput {
  scannerSnapshot: ScannerSnapshot;
  executionPool: ScannerCandidate[];
  watchPool: ScannerCandidate[];
  nearMissPool: ScannerCandidate[];
  openSymbols: string[];
  pendingOrderSymbols: string[];
  capital: number;
  usedCapital: number;
  maxPositions: number;
  maxEntriesPerCycle: number;
  capitalPerTrade: number;
  maxSpreadPct: number;
  decisionMode: 'unified';
  executionAdapter: 'paper_simulated' | 'binance_live';
  enabledRiskGroups: Record<string, boolean>;
}

function computeExecutionScore(c: ScannerCandidate): number {
  let score = 0;
  if (c.entryGateDecision?.decision === 'ALLOW') score += 1000;
  if (c.riskDecision?.verdict === 'ALLOW') score += 500;
  score += c.confidence * 200;
  const strategyWeight: Record<string, number> = { momentum: 40, balanced: 30, dip_and_rebound: 20, conservative: 10, wait: 0, avoid: 0 };
  score += strategyWeight[c.autoStrategyDecision?.effectiveStrategy ?? 'conservative'] ?? 10;
  if (!c.mlBadEntryRisk) score += 50;
  score += Math.max(0, 100 - c.spreadPct * 500);
  if (c.tpRoomOk) score += 40;
  if (c.reboundConfirmed) score += 25;
  if (c.momentumConfirmed) score += 25;
  if (c.riskGroup === 'top_caps') score += 20;
  else if (c.riskGroup === 'large_caps') score += 16;
  else if (c.riskGroup === 'mid_caps') score += 10;
  else if (c.riskGroup === 'very_high_risk') score -= 30;
  score -= c.blockReasons.length * 10;
  return Math.max(0, score);
}

function normalizeNoBuyReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('rebound')) return 'REBOUND_NOT_CONFIRMED';
  if (r.includes('spread')) return 'SPREAD_TOO_HIGH';
  if (r.includes('tp') || r.includes('room')) return 'NO_TP_ROOM';
  if (r.includes('stale')) return 'PRICE_STALE';
  if (r.includes('position') || r.includes('max')) return 'MAX_POSITIONS_REACHED';
  if (r.includes('capital')) return 'CAPITAL_BLOCKED';
  if (r.includes('duplicate')) return 'DUPLICATE_POSITION';
  if (r.includes('order') || r.includes('lock') || r.includes('pending')) return 'DUPLICATE_PENDING_ORDER';
  if (r.includes('group') || r.includes('disabled')) return 'GROUP_DISABLED';
  if (r.includes('live')) return 'LIVE_DISABLED';
  if (r.includes('watchlist') || r.includes('empty')) return 'WATCHLIST_EMPTY';
  return reason.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function isValidEntryPlan(plan: unknown): plan is { side: 'BUY' | 'SELL'; price: number; quantity: number; reason: string } {
  if (!plan || typeof plan !== 'object') return false;
  const p = plan as Record<string, unknown>;
  return (p.side === 'BUY' || p.side === 'SELL')
    && typeof p.price === 'number' && p.price > 0
    && typeof p.quantity === 'number' && p.quantity > 0
    && typeof p.reason === 'string' && p.reason.length > 0;
}

function emitEntryPlanObjectTrace(candidate: ScannerCandidate, stage: string, sourceFunction: string): void {
  const objectKeysShort = Object.keys(candidate).slice(0, 12).join('|') || 'none';
  logger.info(
    `ENTRY_PLAN_OBJECT_TRACE: scanId=${candidate.candidateId ?? 'unknown'} symbol=${candidate.symbol} stage=${stage} hasEntryPlan=${String(!!candidate.entryPlan)} hasExecutionPlan=${String(!!candidate.executionPlan)} hasTraderBrainDecision=${String(!!candidate.traderBrainDecision)} traderBrainDecisionHasEntryPlan=${String(!!candidate.traderBrainDecision?.entryPlan)} hasEntryDecisionSnapshot=${String(!!candidate.entryGateDecision?.snapshot)} entryStatus=${candidate.status} allowCandidate=${String(candidate.entryGateDecision?.decision === 'ALLOW')} price=${candidate.price} bookFresh=${String(candidate.bookFresh !== false)} snapshotDecision=${candidate.entryGateDecision?.snapshot?.decision ?? candidate.entryGateDecision?.decision ?? 'none'} sourceFunction=${sourceFunction} objectKeysShort=${objectKeysShort}`
  );
}

export function buildExecutionPlan(input: ExecutionPlannerInput): ExecutionPlan {
  const {
    scannerSnapshot, executionPool, watchPool, nearMissPool,
    openSymbols, pendingOrderSymbols, capital, usedCapital,
    maxPositions, maxEntriesPerCycle, capitalPerTrade, maxSpreadPct, decisionMode, executionAdapter, enabledRiskGroups,
  } = input;
  const availableSlots = Math.max(0, maxPositions - openSymbols.length);
  const capitalAvailable = Math.max(0, capital - usedCapital);
  const capitalLimitedSlots = capitalPerTrade > 0 ? Math.floor(capitalAvailable / capitalPerTrade) : 0;
  logger.info(`CAPITAL_PER_COIN_ORDER_SIZE_AUDIT: symbol=none mode=${executionAdapter === 'paper_simulated' ? 'demo' : 'live'} userTradingCapital=${capital} userCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${capitalPerTrade} finalOrderNotionalUsd=0 qty=0 entryPrice=0 availableCapital=${capital} usedCapitalBefore=${usedCapital} usedCapitalAfter=${usedCapital} adjustmentReason=planner_limits source=persisted`);
  const hardSelectionLimit = Math.max(0, Math.min(availableSlots, capitalLimitedSlots, Math.max(1, maxEntriesPerCycle)));
  const noBuyReasons: string[] = [];
  const selectedCandidates: PlannedCandidate[] = [];
  const skippedCandidates: SkippedCandidate[] = [];
  const skippedReasons: string[] = [];
  let generatedEntryPlanCount = 0;
  let plannerInputWithEntryPlan = 0;
  let entryPlanBlockedCount = 0;
  let confirmationBlockedCount = 0;
  let spreadBlockedCount = 0;

  const scoredExecutionPool = executionPool.map(c => ({ candidate: c, score: computeExecutionScore(c) }));
  scoredExecutionPool.sort((a, b) => b.score - a.score);

  for (const { candidate, score } of scoredExecutionPool) {
    emitEntryPlanObjectTrace(candidate, 'insideExecutionPlanner', 'ExecutionPlanner.buildExecutionPlan');
    const candidateWithPlan: ScannerCandidate = { ...candidate };
    const fromCandidateEntryPlan = candidate.entryPlan;
    const fromExecutionPlan = (candidate.executionPlan as unknown as { entryPlan?: unknown } | undefined)?.entryPlan;
    const fromTraderBrain = candidate.traderBrainDecision?.entryPlan;
    if (isValidEntryPlan(fromCandidateEntryPlan)) candidateWithPlan.entryPlan = fromCandidateEntryPlan;
    else if (isValidEntryPlan(fromExecutionPlan)) candidateWithPlan.entryPlan = fromExecutionPlan;
    else if (isValidEntryPlan(fromTraderBrain)) candidateWithPlan.entryPlan = fromTraderBrain;
    else {
      const fallbackPrice = candidate.price > 0 ? candidate.price : 0;
      if (fallbackPrice > 0 && candidate.entryGateDecision?.snapshot?.decision === 'ALLOW' && candidate.bookFresh !== false) {
        candidateWithPlan.entryPlan = {
          side: 'BUY',
          price: fallbackPrice,
          quantity: Math.max(0, capitalPerTrade > 0 ? capitalPerTrade / fallbackPrice : 0),
          reason: `generated_entry_plan:${candidate.selectedStrategy ?? 'unknown'}:${scannerSnapshot?.scanId ?? 'unknown'}`,
        };
        generatedEntryPlanCount += 1;
      }
    }
    if (isValidEntryPlan(candidateWithPlan.entryPlan)) plannerInputWithEntryPlan += 1;
    if (isValidEntryPlan(candidateWithPlan.entryPlan) && candidateWithPlan.entryPlan.side === 'BUY') {
      const desiredNotional = Math.max(0, Math.min(capitalPerTrade, capitalAvailable));
      const currentNotional = candidateWithPlan.entryPlan.price * candidateWithPlan.entryPlan.quantity;
      if (desiredNotional > 0 && Math.abs(currentNotional - desiredNotional) > 0.0001) {
        const originalQty = candidateWithPlan.entryPlan.quantity;
        const resolvedQty = desiredNotional / candidateWithPlan.entryPlan.price;
        candidateWithPlan.entryPlan = {
          ...candidateWithPlan.entryPlan,
          quantity: resolvedQty,
          reason: `${candidateWithPlan.entryPlan.reason}|capital_per_coin_rescaled`,
        };
        logger.info(
          `CAPITAL_PER_COIN_SETTINGS_SOURCE_AUDIT: symbol=${candidateWithPlan.symbol} executionPath=ExecutionPlanner sourceUsed=capitalPerTrade uiCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${desiredNotional} finalOrderNotionalUsd=${desiredNotional.toFixed(4)} availableCapital=${capitalAvailable} reason=rescaled_entry_plan_from_${currentNotional.toFixed(4)}_to_${desiredNotional.toFixed(4)} originalQty=${originalQty} resolvedQty=${resolvedQty}`
        );
      }
    }
    emitEntryPlanObjectTrace(candidateWithPlan, 'afterNormalizeEntryPlan', 'ExecutionPlanner.buildExecutionPlan');

    const auditIntegrity = (selected: boolean, rejectReason: string) => {
      logger.info(
        `EXECUTION_SELECTED_CANDIDATE_INTEGRITY_AUDIT: symbol=${candidateWithPlan.symbol} selected=${String(selected)} inExecutionPool=true hasEntryPlan=${String(!!candidateWithPlan.entryPlan)} snapshotDecision=${candidateWithPlan.entryGateDecision?.snapshot?.decision ?? candidateWithPlan.entryGateDecision?.decision ?? 'none'} blockReasons=${candidateWithPlan.blockReasons.join('|') || 'none'} bookFresh=${String(candidateWithPlan.bookFresh !== false)} canExecute=${String(selected)} rejectReason=${rejectReason || 'none'}`
      );
    };

    if (selectedCandidates.length >= hardSelectionLimit) {
      let limitReason = 'Execution selection limit reached';
      let limitToken = 'SELECTION_LIMIT_REACHED';
      if (availableSlots <= 0) {
        limitReason = 'BLOCK_MAX_POSITIONS';
        limitToken = 'MAX_POSITIONS_REACHED';
      } else if (capitalLimitedSlots <= 0) {
        limitReason = 'BLOCK_CAPITAL_LIMIT';
        limitToken = 'CAPITAL_BLOCKED';
      }
      skippedCandidates.push({ symbol: candidate.symbol, status: candidate.status, reason: limitReason, gate: 'ExecutionPlannerLimit', isRetryable: true });
      skippedReasons.push(limitToken);
      if (!noBuyReasons.includes(limitToken)) noBuyReasons.push(limitToken);
      auditIntegrity(false, limitToken);
      continue;
    }
    const symbol = candidateWithPlan.symbol;
    const decision = candidateWithPlan.autoStrategyDecision;
    const checks: string[] = [];
    let skipped = false;
    let skipReason = '';
    let skipGate = '';
    let isRetryable = true;

    const gateSnapshot = buildCanonicalEntryGateSnapshot(candidateWithPlan, {
      openSymbols,
      pendingOrderSymbols,
      capitalAvailable,
      currentPositions: openSymbols.length,
      maxPositions,
      maxSpreadPct,
      minConfidence: 0.3,
      groupEnabled: enabledRiskGroups[candidateWithPlan.riskGroup ?? 'unknown'] !== false,
    });

    if (candidateWithPlan.status !== 'BUY') {
      skipped = true;
      skipReason = `Candidate status is ${candidate.status}, not BUY`;
      skipGate = 'ExecutionPlannerIntegrity';
      isRetryable = true;
      if (!noBuyReasons.includes('STATUS_NOT_BUY')) noBuyReasons.push('STATUS_NOT_BUY');
    }

    if (!skipped && candidateWithPlan.entryGateDecision?.decision !== 'ALLOW') {
      skipped = true;
      skipReason = candidateWithPlan.entryGateDecision?.primaryReason ?? 'EntryGate decision is not ALLOW';
      skipGate = 'ExecutionPlannerIntegrity';
      isRetryable = true;
      if (!noBuyReasons.includes('ENTRYGATE_NOT_ALLOW')) noBuyReasons.push('ENTRYGATE_NOT_ALLOW');
    }

    if (!skipped && candidateWithPlan.blockReasons.length > 0) {
      skipped = true;
      skipReason = candidateWithPlan.blockReasons[0] ?? 'Candidate has block reasons';
      skipGate = 'ExecutionPlannerIntegrity';
      isRetryable = true;
      for (const br of candidateWithPlan.blockReasons) {
        const nr = normalizeNoBuyReason(br);
        if (nr === 'SPREAD_TOO_HIGH') spreadBlockedCount += 1;
        if (!noBuyReasons.includes(nr)) noBuyReasons.push(nr);
      }
      confirmationBlockedCount += 1;
    }

    const strategyAudit = buildStrategyAuditSnapshotFromCandidate(candidateWithPlan);
    if (!skipped && !strategyAudit.finalExecutable) {
      skipped = true;
      const missing = strategyAudit.setupMissing.map((s) => s.key);
      const exactReason = missing.includes('dipConfirmed')
        ? 'dip_missing'
        : missing.includes('reboundConfirmed')
          ? 'rebound_missing'
          : 'finalExecutable_false';
      skipReason = `strategy_setup_not_met:${exactReason}`;
      skipGate = 'ExecutionPlannerFinalGate';
      isRetryable = true;
      if (!noBuyReasons.includes('strategy_setup_not_met')) noBuyReasons.push('strategy_setup_not_met');
      if (!noBuyReasons.includes(exactReason)) noBuyReasons.push(exactReason);
      logger.warn(`BUY_BLOCKED_STRATEGY_SETUP_NOT_MET: symbol=${symbol} strategy=${strategyAudit.strategySelected} actualDipPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} setupMissing=${strategyAudit.setupMissing.map((s) => s.key).join('|') || 'none'} finalExecutable=${String(strategyAudit.finalExecutable)}`);
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${symbol} reason=${exactReason} strategy=${strategyAudit.strategySelected}`);
    }

    const ownershipResolution = resolveAutoTargetOwnership({
      candidate: candidateWithPlan,
      executionPath: 'ExecutionPlanner',
      mode: candidateWithPlan.mode,
    });
    const autoBotsOn = ownershipResolution.isAutoTargetOwned;
    logger.info(`AUTO_TARGET_OWNERSHIP_RESOLVED: symbol=${symbol} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(ownershipResolution.isAutoTargetOwned)} isScannerAutoTrade=${String(ownershipResolution.isScannerAutoTrade)} isManualTrade=${String(ownershipResolution.isManualTrade)} isManualOverride=${String(ownershipResolution.isManualOverride)} tp1Pct=pending tp1Source=pending tp2Pct=pending slPct=1.5 resolverPath=${ownershipResolution.resolverPath}`);
    if (ownershipResolution.weakStrategySourceWouldMiss) {
      logger.warn(`AUTO_TARGET_OWNERSHIP_MISCLASSIFICATION_PREVENTED: symbol=${symbol} executionPath=${ownershipResolution.executionPath} strategySource=${ownershipResolution.strategySource} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} isAutoTargetOwned=true previousDetection=manual_override resolverPath=${ownershipResolution.resolverPath}`);
    }
    const ownership = (candidateWithPlan as any).tradingTargetOwnership ?? resolveTradingTargetOwnership(candidateWithPlan, {
      strategySource: autoBotsOn ? 'autobots' : 'manual_override',
      manualTp1Pct: 1.5,
      manualTp2Pct: 0,
      stopLossPct: 1.5,
      dynamicTrailingEnabled: Boolean((candidateWithPlan as any).tradingTargetOwnership?.dynamicTrailingEnabled ?? false),
      trailPullbackPct: 0.25,
    });
    if (!(candidateWithPlan as any).tradingTargetOwnership) {
      (candidateWithPlan as any).tradingTargetOwnership = ownership;
      logger.info(`TRADING_TARGET_OWNERSHIP_FALLBACK_RESOLVED: symbol=${symbol} stage=execution_planner autoBotsOn=${String(autoBotsOn)} isAutoTargetOwned=${String(ownershipResolution.isAutoTargetOwned)} resolverPath=${ownershipResolution.resolverPath} tp1Value=${String((ownership as any)?.tp1Value ?? 'n/a')} tp1Source=${String((ownership as any)?.tp1Source ?? 'n/a')} reason=missing_candidate_ownership`);
    }
    const resolvedRisk = resolveEntryRiskParams({ autoBotsOn, ownership, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 });
    logger.info(`AUTO_TARGET_OWNERSHIP_RESOLVED: symbol=${symbol} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(ownershipResolution.isAutoTargetOwned)} isScannerAutoTrade=${String(ownershipResolution.isScannerAutoTrade)} isManualTrade=${String(ownershipResolution.isManualTrade)} isManualOverride=${String(ownershipResolution.isManualOverride)} tp1Pct=${resolvedRisk.tp1} tp1Source=${resolvedRisk.sourceTp1} tp2Pct=${resolvedRisk.tp2} slPct=${resolvedRisk.sl} resolverPath=${ownershipResolution.resolverPath}`);
    if (!skipped && autoBotsOn && !resolvedRisk.tp1Valid) {
      skipped = true;
      skipReason = 'tp1_missing_or_zero';
      skipGate = 'ExecutionPlannerFinalGate';
      isRetryable = true;
      if (!noBuyReasons.includes('tp1_missing_or_zero')) noBuyReasons.push('tp1_missing_or_zero');
      logger.warn(`AUTOBOTS_TP1_INVALID_BLOCKED: symbol=${symbol} tp1=${resolvedRisk.tp1} sourceTp1=${resolvedRisk.sourceTp1} reason=${resolvedRisk.tp1InvalidReason} buyAllowed=false`);
    }

    if (!skipped && candidateWithPlan.bookFresh === false) {
      skipped = true;
      skipReason = 'BLOCK_BOOK_STALE';
      skipGate = 'ExecutionPlannerIntegrity';
      isRetryable = true;
      if (!noBuyReasons.includes('BOOK_STALE')) noBuyReasons.push('BOOK_STALE');
    }

    if (!skipped && !isValidEntryPlan(candidateWithPlan.entryPlan)) {
      skipped = true;
      skipReason = 'ENTRY_PLAN_MISSING';
      skipGate = 'ExecutionPlannerIntegrity';
      isRetryable = false;
      entryPlanBlockedCount += 1;
      if (!noBuyReasons.includes('ENTRY_PLAN_MISSING')) noBuyReasons.push('ENTRY_PLAN_MISSING');
      logger.warn(`ENTRY_PLAN_MISSING: symbol=${symbol} source=ExecutionPlanner selected=false reason=no_normalized_entry_plan`);
    }

    if (!skipped && gateSnapshot.decision !== 'ALLOW') {
      skipped = true;
      skipReason = gateSnapshot.primaryReason ?? 'EntryGate BLOCK';
      skipGate = 'EntryGate';
      for (const br of gateSnapshot.blockReasons) {
        if (!noBuyReasons.includes(br)) noBuyReasons.push(br);
      }
    }

    if (!skipped && candidateWithPlan.riskDecision && candidateWithPlan.riskDecision.verdict === 'BLOCK') {
      skipped = true;
      skipReason = candidateWithPlan.riskDecision.explanation ?? 'RiskEngine BLOCK';
      skipGate = 'RiskEngine';
      isRetryable = true;
    }

    if (skipped) {
      skippedCandidates.push({ symbol, status: candidateWithPlan.status, reason: skipReason, gate: skipGate, isRetryable });
      auditIntegrity(false, skipReason);
      continue;
    }

    const entryPlan = candidateWithPlan.entryPlan!;
    const action: PlannedAction = 'BUY';
    logger.info(`ENTRY_PLAN_ATTACHED_TO_SELECTED_CANDIDATE: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} price=${entryPlan.price} quantity=${entryPlan.quantity} side=${entryPlan.side}`);
    selectedCandidates.push({
      symbol,
      rank: candidateWithPlan.rank ?? 0,
      status: candidateWithPlan.status,
      strategy: decision?.effectiveStrategy ?? candidateWithPlan.selectedStrategy,
      effectiveStrategy: decision?.effectiveStrategy ?? candidateWithPlan.selectedStrategy,
      strategySource: decision?.strategySource ?? candidateWithPlan.strategySource,
      strategySourceDetail: decision?.strategySourceDetail ?? candidateWithPlan.strategySourceDetail,
      strategyReason: decision?.strategyReason ?? candidateWithPlan.strategyReason ?? decision?.reason,
      groupTrend: decision?.groupTrend ?? candidateWithPlan.groupTrend ?? 'n/a',
      groupRecommendedStrategy: decision?.groupRecommendedStrategy ?? candidateWithPlan.groupRecommendedStrategy ?? 'n/a',
      confidence: candidateWithPlan.confidence,
      score,
      plannedAction: action,
      reason: decision?.reason ?? 'EntryGate ALLOW - ready for execution',
      requiredChecks: checks,
      scanId: scannerSnapshot?.scanId,
      entryPlan,
      executionPrice: entryPlan.price,
      capitalAllocation: capitalPerTrade,
      targetPolicy: candidateWithPlan.tradingTargetOwnership ?? null,
      gateSnapshot,
    });
    logger.info(`CAPITAL_PER_COIN_ORDER_SIZE_AUDIT: symbol=${symbol} mode=${executionAdapter === 'paper_simulated' ? 'demo' : 'live'} userTradingCapital=${capital} userCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${capitalPerTrade} finalOrderNotionalUsd=${(entryPlan.price * entryPlan.quantity).toFixed(4)} qty=${entryPlan.quantity} entryPrice=${entryPlan.price} availableCapital=${capitalAvailable} usedCapitalBefore=${usedCapital} usedCapitalAfter=${usedCapital + (entryPlan.price * entryPlan.quantity)} adjustmentReason=entry_plan_selected source=persisted`);
    auditIntegrity(true, 'none');
  }

  const allPoolSymbols = [...executionPool, ...watchPool, ...nearMissPool];
  for (const c of allPoolSymbols) {
    if (c.status === 'WAIT' || c.status === 'BLOCK') {
      const reasons = [c.mainReason, ...c.blockReasons].filter(Boolean);
      for (const r of reasons) {
        const nr = normalizeNoBuyReason(r);
        if (!noBuyReasons.includes(nr)) noBuyReasons.push(nr);
      }
    }
  }

  const topNoBuy = [...new Set(noBuyReasons)].slice(0, 5);
  const canExecute = selectedCandidates.some(c => c.plannedAction === 'BUY');
  logger.info(`BUY_READY_FINAL_GATE_AUDIT: plannerInputCount=${executionPool.length} finalExecutableReadyCount=${selectedCandidates.length} blockedByFinalGate=${skippedCandidates.filter((s) => s.gate === 'ExecutionPlannerFinalGate').length} selectedSymbols=${selectedCandidates.map((s) => s.symbol).join('|') || 'none'}`);
  logger.info(`EXECUTION_POOL_FINAL_FILTER_AUDIT: executionPoolIn=${executionPool.length} selectedOut=${selectedCandidates.length} skippedOut=${skippedCandidates.length} topNoBuyReasons=${topNoBuy.join('|') || 'none'}`);
  logger.info(`EXECUTION_SELECTION_LIMIT_AUDIT: buyReadyCount=${executionPool.length} requestedSelectedCount=${scoredExecutionPool.length} maxOpenPositions=${maxPositions} openPositions=${openSymbols.length} availableSlots=${availableSlots} capitalAvailable=${capitalAvailable} capitalPerTrade=${capitalPerTrade} capitalLimitedSlots=${capitalLimitedSlots} finalSelectedCount=${selectedCandidates.length} skippedCount=${skippedCandidates.length} skippedReasons=${[...new Set(skippedReasons)].join('|') || 'none'}`);

  return {
    canExecute,
    selectedCandidates,
    skippedCandidates,
    noBuyReasons: topNoBuy,
    plannerInputCount: executionPool.length,
    plannerInputWithEntryPlan,
    generatedEntryPlanCount,
    entryPlanBlockedCount,
    confirmationBlockedCount,
    spreadBlockedCount,
    executionPoolSize: executionPool.length,
    watchPoolSize: watchPool.length,
    nearMissPoolSize: nearMissPool.length,
    maxEntriesPerCycle,
    availableSlots,
    capitalAvailable,
    decisionMode,
    executionAdapter,
  };
}

export { computeExecutionScore };
