import type { ScannerCandidate, ScannerSnapshot, ExecutionPlan, PlannedCandidate, SkippedCandidate, PlannedAction, AutoStrategyDecision, ScannerAutoEntryConfigSnapshot } from '../types';
import { logger } from '../../utils/logger';
import { buildCanonicalEntryGateSnapshot } from '../entry-gate/EntryGate';
import { buildStrategyAuditSnapshotFromCandidate } from '../strategy-audit/strategy-audit-builder';
import { resolveEntryRiskParams } from '../trading/entry-risk-resolver';
import { resolveAutoTargetOwnership, resolveTradingTargetOwnership } from '../trading/TradingTargetOwnership';
import { resolveMaxSelectedPerScanConfig, type MaxSelectedPerScanSource } from '../settings/max-selected-per-scan';

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
  maxSelectedPerScan?: number;
  maxEntriesPerCycle?: number;
  maxSelectedPerScanSource?: MaxSelectedPerScanSource;
  maxSelectedPerScanMigrationApplied?: boolean;
  maxSelectedPerScanClamped?: boolean;
  maxSelectedPerScanReason?: string;
  maxSelectedPerScanUserExplicit?: boolean;
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

function buildEntryConfigSnapshotContractHash(snapshot: Pick<ScannerAutoEntryConfigSnapshot, 'symbol' | 'scanId' | 'sourceCandidateId' | 'selectedStrategy' | 'finalEntryRule' | 'entryPrice' | 'quantity'>): string {
  return [
    snapshot.symbol,
    snapshot.scanId ?? 'none',
    snapshot.sourceCandidateId ?? 'none',
    snapshot.selectedStrategy,
    snapshot.finalEntryRule,
    snapshot.entryPrice,
    snapshot.quantity,
  ].join('|');
}

export function buildExecutionPlan(input: ExecutionPlannerInput): ExecutionPlan {
  const {
    scannerSnapshot, executionPool, watchPool, nearMissPool,
    openSymbols, pendingOrderSymbols, capital, usedCapital,
    maxPositions, maxEntriesPerCycle, capitalPerTrade, maxSpreadPct, decisionMode, executionAdapter, enabledRiskGroups,
  } = input;
  const resolvedMaxSelected = resolveMaxSelectedPerScanConfig({
    scanId: scannerSnapshot?.scanId,
    plannerInputValue: input.maxSelectedPerScan,
    persistedLegacyMaxEntriesPerCycle: maxEntriesPerCycle,
    maxSelectedPerScan: input.maxSelectedPerScan,
    maxEntriesPerCycle,
    userExplicit: input.maxSelectedPerScanUserExplicit,
    sourceHint: input.maxSelectedPerScanSource,
    reason: input.maxSelectedPerScanReason ?? 'execution_planner_input_canonicalized',
  });
  const maxSelectedPerScan = resolvedMaxSelected.value;
  const availableSlots = Math.max(0, maxPositions - openSymbols.length);
  const capitalAvailable = Math.max(0, capital - usedCapital);
  const capitalLimitedSlots = capitalPerTrade > 0 ? Math.floor(capitalAvailable / capitalPerTrade) : 0;
  logger.info(`CAPITAL_PER_COIN_ORDER_SIZE_AUDIT: symbol=none mode=${executionAdapter === 'paper_simulated' ? 'demo' : 'live'} userTradingCapital=${capital} userCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${capitalPerTrade} finalOrderNotionalUsd=0 qty=0 entryPrice=0 availableCapital=${capital} usedCapitalBefore=${usedCapital} usedCapitalAfter=${usedCapital} adjustmentReason=planner_limits source=persisted`);
  // Selection limit: only real safety gates — max positions and capital. No artificial maxSelectedPerScan cap.
  const selectionLimit = Math.max(0, Math.min(availableSlots, capitalLimitedSlots));
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
  logger.info(`SELECTION_LIMIT_REMOVED_AUDIT: totalPoolCandidates=${executionPool.length} evaluatedCandidates=${scoredExecutionPool.length} blockedByRealSafety=0 blockedByDuplicatePosition=0 blockedByPendingOrder=0 blockedByMaxOpenPositions=${availableSlots <= 0 ? executionPool.length : 0} blockedByCapital=${capitalLimitedSlots <= 0 ? executionPool.length : 0} blockedBySpread=0 blockedByTpRoom=0 blockedByPriceStale=0 selectionLimitApplied=false maxSelectedPerScan=unlimited`);

  // Group-aware round-robin reordering: interleave candidates from each risk group
  // so selection diversifies across groups instead of picking global top-N
  const GROUP_ORDER = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];
  const grouped: Map<string, typeof scoredExecutionPool> = new Map();
  for (const item of scoredExecutionPool) {
    const rg = item.candidate.riskGroup ?? 'unknown';
    if (!grouped.has(rg)) grouped.set(rg, []);
    grouped.get(rg)!.push(item);
  }
  for (const [, items] of grouped) { items.sort((a, b) => b.score - a.score); }

  // Build round-robin ordered pool
  const roundRobinPool: typeof scoredExecutionPool = [];
  let round = 0;
  const MAX_ROUNDS = 10;
  while (round < MAX_ROUNDS) {
    let added = false;
    for (const group of GROUP_ORDER) {
      const items = grouped.get(group);
      if (items && round < items.length) { roundRobinPool.push(items[round]); added = true; }
    }
    // Also include unknown-group candidates
    const unknown = grouped.get('unknown');
    if (unknown && round < unknown.length) { roundRobinPool.push(unknown[round]); added = true; }
    if (!added) break;
    round++;
  }

  logger.info(`GROUP_ROUND_ROBIN_SELECTION_AUDIT totalCandidates=${scoredExecutionPool.length} groupCaps=5|5|6|4|4 candidateCountByGroup=${[...grouped.entries()].map(([g, items]) => `${g}=${items.length}`).join('|')} rankedTopByGroup=${[...grouped.entries()].map(([g, items]) => `${g}:${items.slice(0, 3).map(i => i.candidate.symbol).join('|')}`).join('|')} selectionRounds=${round} roundRobinPoolSize=${roundRobinPool.length}`);

  for (const { candidate, score } of roundRobinPool) {
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

    if (!skipped && (strategyAudit.strategySelected.toLowerCase() === 'wait' || strategyAudit.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))) {
      skipped = true;
      const exactReason = strategyAudit.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')
        ? 'semantic_invalid_final_rule_waiting_for_setup'
        : strategyAudit.strategySelected.toLowerCase() === 'wait'
          ? 'semantic_invalid_strategy_is_wait'
          : 'snapshot_semantic_invalid';
      skipReason = `entry_config_snapshot_semantic_invalid:strategy=${strategyAudit.strategySelected}:rule=${strategyAudit.finalEntryRule}:exact=${exactReason}`;
      skipGate = 'ExecutionPlannerSemanticIntegrity';
      isRetryable = true;
      if (!noBuyReasons.includes(exactReason)) noBuyReasons.push(exactReason);
      const autoDecision = candidateWithPlan.autoStrategyDecision as any;
      const sourceOfSelectedStrategy = String(autoDecision?.effectiveStrategy ?? (candidateWithPlan as any).selectedStrategy ?? 'n/a');
      const sourceOfFinalEntryRule = String((candidateWithPlan.traderBrainDecision?.ruleDecisionTrace as any)?.unifiedSignal?.reasonCode ?? sourceOfSelectedStrategy);
      const sourceOfSetupResult = String(strategyAudit.setupResult ?? 'n/a');
      const safeFallbackReason = String(autoDecision?.reason ?? autoDecision?.fallbackReason ?? 'n/a');
      const marketRecommendedStrategy = String(autoDecision?.groupRecommendedStrategy ?? (candidateWithPlan as any).groupRecommendedStrategy ?? 'n/a');
      logger.error(`BUY_BLOCKED_SNAPSHOT_SEMANTIC_INVALID: symbol=${symbol} selectedStrategy=${strategyAudit.strategySelected} finalEntryRule=${strategyAudit.finalEntryRule} finalExecutable=${String(strategyAudit.finalExecutable)} buyAllowed=${String(strategyAudit.buyAllowed)} autoEffective=${String(autoDecision?.effectiveStrategy ?? 'n/a')} perCoinSelected=${String(autoDecision?.perCoinSelectedStrategy ?? 'n/a')} groupRecommended=${String(autoDecision?.groupRecommendedStrategy ?? 'n/a')} reason=${exactReason}`);
      logger.error(`SEMANTIC_GATE_REJECTION_AUDIT: symbol=${symbol} candidateStatus=${candidateWithPlan.status} topCandidateFinalExecutable=${String(strategyAudit.finalExecutable)} topCandidateBuyAllowed=${String(strategyAudit.buyAllowed)} strategyAuditFinalExecutable=${String(strategyAudit.finalExecutable)} selectedStrategy=${strategyAudit.strategySelected} resolvedStrategy=${(candidateWithPlan as any).effectiveStrategy ?? strategyAudit.strategySelected} finalEntryRule=${strategyAudit.finalEntryRule} setupResult=${sourceOfSetupResult} semanticValid=false rejectionReason=${exactReason} sourceOfSelectedStrategy=${sourceOfSelectedStrategy} sourceOfFinalEntryRule=${sourceOfFinalEntryRule} sourceOfSetupResult=${sourceOfSetupResult} marketRecommendedStrategy=${marketRecommendedStrategy} safeFallbackReason=${safeFallbackReason} finalEntryRuleSource=${sourceOfFinalEntryRule} hasAutoDecision=${String(!!candidateWithPlan.autoStrategyDecision)} hasTraderBrain=${String(!!candidateWithPlan.traderBrainDecision)} hasEntryPlan=${String(!!candidateWithPlan.entryPlan)}`);
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
      const isOverextended = Array.isArray(candidateWithPlan.blockReasons) && candidateWithPlan.blockReasons.some(r => String(r).toLowerCase().includes('overextended'));
      const isCandleExhaustion = Array.isArray(candidateWithPlan.blockReasons) && candidateWithPlan.blockReasons.some(r => String(r).toLowerCase().includes('candle'));
      const OVEREXTENSION_THRESHOLD_PCT = 1.8;
      const CANDLE_ATR_THRESHOLD = 2.5;
      const overextendedValPct = isOverextended ? Number((candidateWithPlan as any).extensionAboveRefPct ?? OVEREXTENSION_THRESHOLD_PCT + 0.1) : 0;
      const candleAtrVal = isCandleExhaustion ? Number((candidateWithPlan as any).candleAtrMultiple ?? CANDLE_ATR_THRESHOLD + 0.1) : 0;
      const hasSpreadOk = !isOverextended && !isCandleExhaustion && candidateWithPlan.bookFresh !== false && (candidateWithPlan.spreadPct ?? 0) <= maxSpreadPct;
      const hasTpRoomOk = candidateWithPlan.tpRoomOk !== false;
      const hasBookFresh = candidateWithPlan.bookFresh !== false;
      const hasMarketOnline = (candidateWithPlan as any).marketDataOnline !== false;
      const confirmationOk = !(Array.isArray(candidateWithPlan.blockReasons) && candidateWithPlan.blockReasons.some(r => String(r).toLowerCase().includes('confirmation')));
      const wouldBuyIf = !isOverextended && !isCandleExhaustion && hasBookFresh && hasMarketOnline && hasSpreadOk && hasTpRoomOk && confirmationOk
        ? 'candidate_passes_all_safety'
        : (isOverextended ? 'wait_for_pullback' : isCandleExhaustion ? 'wait_for_candle_settle' : !hasBookFresh ? 'fix_book_stale' : !hasSpreadOk ? 'fix_spread' : !hasTpRoomOk ? 'fix_tp_room' : 'fix_confirmation');
      logger.info(`FINAL_SELECTION_BLOCKER_VALUES_AUDIT: symbol=${symbol} finalBlocker=${skipReason} selectedForExecution=false overextendedValuePct=${overextendedValPct.toFixed(2)} overextendedThresholdPct=${OVEREXTENSION_THRESHOLD_PCT} overextendedBlockValid=${String(overextendedValPct > OVEREXTENSION_THRESHOLD_PCT)} candleAtrMultiple=${candleAtrVal.toFixed(2)} candleAtrThreshold=${CANDLE_ATR_THRESHOLD} candleExhaustionBlockValid=${String(candleAtrVal > CANDLE_ATR_THRESHOLD)} spreadPct=${(candidateWithPlan.spreadPct ?? 0).toFixed(2)} maxSpreadPct=${maxSpreadPct} bookFresh=${String(hasBookFresh)} marketDataOnline=${String(hasMarketOnline)} tpRoomOk=${String(hasTpRoomOk)} confirmationOk=${String(confirmationOk)} wouldBuyIf=${wouldBuyIf}`);      auditIntegrity(false, skipReason);
      continue;
    }

    if (selectedCandidates.length >= selectionLimit) {
      let limitToken = 'MAX_POSITIONS_REACHED';
      let limitReason = 'BLOCK_MAX_POSITIONS';
      if (capitalLimitedSlots <= 0 && availableSlots > 0) {
        limitToken = 'CAPITAL_BLOCKED';
        limitReason = 'BLOCK_CAPITAL_LIMIT';
      }
      skippedCandidates.push({ symbol, status: candidateWithPlan.status, reason: limitReason, gate: 'ExecutionPlannerLimit', isRetryable: true });
      skippedReasons.push(limitToken);
      if (!noBuyReasons.includes(limitToken)) noBuyReasons.push(limitToken);
      auditIntegrity(false, limitToken);
      continue;
    }

    const entryPlan = candidateWithPlan.entryPlan!;
    const scannerAutoEntryConfigSnapshot: ScannerAutoEntryConfigSnapshot = {
      schemaVersion: 'cryptobud-v4-scanner-auto-entry-config-v1',
      symbol,
      scanId: scannerSnapshot?.scanId ?? null,
      sourceCandidateId: candidateWithPlan.candidateId ?? null,
      selectedStrategy: strategyAudit.strategySelected,
      finalEntryRule: strategyAudit.finalEntryRule,
      setupResult: String(strategyAudit.setupResult ?? strategyAudit.finalEntryRule),
      finalExecutable: strategyAudit.finalExecutable,
      finalExecutableAtEntry: strategyAudit.finalExecutableAtEntry,
      buyAllowed: strategyAudit.buyAllowed,
      entryConfirmedAtEntry: Boolean(strategyAudit.entryConfirmedAtEntry),
      entryStatus: candidateWithPlan.status,
      entryGateDecision: gateSnapshot.decision,
      confidence: candidateWithPlan.confidence,
      executionPath: 'scanner_auto',
      ownerType: 'scanner',
      ownerName: 'The Dipper',
      source: 'AutoBots',
      strategySource: String(decision?.strategySource ?? candidateWithPlan.strategySource ?? 'unknown'),
      strategySourceDetail: decision?.strategySourceDetail ?? candidateWithPlan.strategySourceDetail ?? null,
      strategyReason: decision?.strategyReason ?? candidateWithPlan.strategyReason ?? decision?.reason ?? null,
      entryPrice: entryPlan.price,
      quantity: entryPlan.quantity,
      capitalAllocated: capitalPerTrade,
      tp1Pct: Number(resolvedRisk.tp1),
      tp1Source: String(resolvedRisk.sourceTp1),
      tp2Pct: Number(resolvedRisk.tp2),
      tp2Source: String(resolvedRisk.sourceTp2),
      slPct: Number(resolvedRisk.sl),
      slSource: String(resolvedRisk.sourceSl),
      dynamicTrailingEnabled: Boolean(resolvedRisk.dynamicTrailingEnabled),
      trailStart: resolvedRisk.trailStart,
      trailPullbackPct: Number(resolvedRisk.trailPullback),
      riskParams: {
        schemaVersion: 'cryptobud-v4-risk-snapshot-v1',
        symbol,
        scanId: scannerSnapshot?.scanId ?? null,
        sourceCandidateId: candidateWithPlan.candidateId ?? null,
        entryPrice: entryPlan.price,
        quantity: entryPlan.quantity,
        capitalAllocated: capitalPerTrade,
        tp1Pct: Number(resolvedRisk.tp1),
        tp1TargetPrice: Number(entryPlan.price * (1 + (Number(resolvedRisk.tp1) / 100))),
        tp1Source: resolvedRisk.sourceTp1,
        sourceTp1: resolvedRisk.sourceTp1,
        tp1Min: Number.isFinite(Number((ownership as any)?.tp1Min)) ? Number((ownership as any).tp1Min) : null,
        tp1Max: Number.isFinite(Number((ownership as any)?.tp1Max)) ? Number((ownership as any).tp1Max) : null,
        tp1Reason: String((ownership as any)?.tp1Reason ?? ownership?.reason ?? 'n/a'),
        tp2Pct: Number(resolvedRisk.tp2),
        tp2Source: resolvedRisk.sourceTp2,
        sourceTp2: resolvedRisk.sourceTp2,
        slPct: Number(resolvedRisk.sl),
        slSource: resolvedRisk.sourceSl,
        sourceSl: resolvedRisk.sourceSl,
        dynamicTrailingEnabled: Boolean(resolvedRisk.dynamicTrailingEnabled),
        trailStartPct: resolvedRisk.trailStart,
        trailPullbackPct: Number(resolvedRisk.trailPullback),
        sourceTrailPullback: resolvedRisk.sourceTrailPullback,
        tradingTargetOwnership: ownership ?? null,
        autoBotsOnAtEntry: autoBotsOn,
        createdAt: new Date().toISOString(),
      },
      strategyAuditSnapshot: strategyAudit as unknown as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };
    const snapshotContractHash = buildEntryConfigSnapshotContractHash(scannerAutoEntryConfigSnapshot);
    logger.info(`ENTRY_CONFIG_SNAPSHOT_MATERIALIZED_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} sourceCandidateId=${candidateWithPlan.candidateId ?? 'none'} selectedStrategy=${scannerAutoEntryConfigSnapshot.selectedStrategy} finalEntryRule=${scannerAutoEntryConfigSnapshot.finalEntryRule} entryStatus=${scannerAutoEntryConfigSnapshot.entryStatus} entryGateDecision=${scannerAutoEntryConfigSnapshot.entryGateDecision} finalExecutable=${String(scannerAutoEntryConfigSnapshot.finalExecutable)} buyAllowed=${String(scannerAutoEntryConfigSnapshot.buyAllowed)} snapshotComplete=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} builtFrom=ExecutionPlanner passedToDemoController=true passedToTradingEngine=true`);
    logger.info(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${symbol} boundary=after_execution_planner snapshotPresent=true selectedStrategy=${scannerAutoEntryConfigSnapshot.selectedStrategy} finalEntryRule=${scannerAutoEntryConfigSnapshot.finalEntryRule} contractHash=${snapshotContractHash} contractValid=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} semanticValid=${String(scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}`);
    const action: PlannedAction = 'BUY';
    logger.info(`ENTRY_PLAN_ATTACHED_TO_SELECTED_CANDIDATE: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} price=${entryPlan.price} quantity=${entryPlan.quantity} side=${entryPlan.side}`);
    selectedCandidates.push({
      symbol,
      rank: candidateWithPlan.rank ?? 0,
      status: candidateWithPlan.status,
      strategy: scannerAutoEntryConfigSnapshot.selectedStrategy,
      effectiveStrategy: scannerAutoEntryConfigSnapshot.selectedStrategy,
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
      scannerAutoEntryConfigSnapshot,
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
  const selectedSymbols = selectedCandidates.map((s) => s.symbol);
  const projectedCapitalRequired = selectedCandidates.reduce((sum, c) => sum + (c.entryPlan ? c.entryPlan.price * c.entryPlan.quantity : c.capitalAllocation ?? 0), 0);
  const maxCapitalAtRisk = capital;
  const projectedCapitalAtRisk = usedCapital + projectedCapitalRequired;
  const safetyLimitApplied = selectionLimit < maxSelectedPerScan;
  logger.info(`BUY_READY_FINAL_GATE_AUDIT: plannerInputCount=${executionPool.length} finalExecutableReadyCount=${selectedCandidates.length} blockedByFinalGate=${skippedCandidates.filter((s) => s.gate === 'ExecutionPlannerFinalGate').length} selectedSymbols=${selectedCandidates.map((s) => s.symbol).join('|') || 'none'}`);
  logger.info(`EXECUTION_POOL_FINAL_FILTER_AUDIT: executionPoolIn=${executionPool.length} selectedOut=${selectedCandidates.length} skippedOut=${skippedCandidates.length} topNoBuyReasons=${topNoBuy.join('|') || 'none'}`);
  logger.info(`EXECUTION_SAFETY_LIMIT_AUDIT: scanId=${scannerSnapshot?.scanId ?? 'unknown'} buyReadyCount=${executionPool.length} selectedCount=${selectedCandidates.length} selectionLimitRemoved=true maxOpenPositions=${maxPositions} currentOpenPositions=${openSymbols.length} availableSlots=${availableSlots} capitalPerTrade=${capitalPerTrade} projectedCapitalRequired=${projectedCapitalRequired.toFixed(4)} maxCapitalAtRisk=${maxCapitalAtRisk} projectedCapitalAtRisk=${projectedCapitalAtRisk.toFixed(4)} safetyLimitApplied=${String(safetyLimitApplied)} capitalAvailable=${capitalAvailable} capitalLimitedSlots=${capitalLimitedSlots} effectiveSelectionLimit=${selectionLimit} skippedCount=${skippedCandidates.length} skippedReasons=${[...new Set(skippedReasons)].join('|') || 'none'}`);

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
    maxEntriesPerCycle: maxSelectedPerScan,
    maxSelectedPerScan,
    availableSlots,
    capitalAvailable,
    decisionMode,
    executionAdapter,
  };
}

export { computeExecutionScore };
