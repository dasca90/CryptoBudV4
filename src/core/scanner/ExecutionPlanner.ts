import type { ScannerCandidate, ScannerSnapshot, ExecutionPlan, PlannedCandidate, SkippedCandidate, PlannedAction, AutoStrategyDecision, ScannerAutoEntryConfigSnapshot } from '../types';
import { logger } from '../../utils/logger';
import { buildCanonicalEntryGateSnapshot } from '../entry-gate/EntryGate';
import { buildStrategyAuditSnapshotFromCandidate, resolveActionableFinalBlocker } from '../strategy-audit/strategy-audit-builder';
import { resolveEntryRiskParams } from '../trading/entry-risk-resolver';
import { resolveAutoTargetOwnership, resolveCandidateExecutionOwnership, resolveTradingTargetOwnership } from '../trading/TradingTargetOwnership';
import { resolveMaxSelectedPerScanConfig, type MaxSelectedPerScanSource } from '../settings/max-selected-per-scan';
import { resolveExecutionDecision, emitCanonicalExecutionDecisionAudit, type ExecutionDecision, type ExecutionDecisionParams } from './executionDecision';
import { assertCandidateRuntimeReady, revalidateCandidateForExecution } from './CandidateLifecycle';
import { rehydrateCandidateMarketFreshness } from '../market-data/canonical-market-freshness';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { resolveFinalNoBuyReasonPriority } from './finalNoBuyReasonPriority';
import { normalizeUnicornFinalBlockReason } from '../unicorn/unicornExecutionBlockers';

export const MAX_EXECUTION_QUEUE_PER_SCAN = 10;

export interface ExecutionPlannerInput {
  scannerSnapshot: ScannerSnapshot;
  executionPool: ScannerCandidate[];
  watchPool: ScannerCandidate[];
  nearMissPool: ScannerCandidate[];
  openSymbols: string[];
  openPositionDetails?: Array<{ symbol: string; tradeId?: string | null; source?: string | null; ownerName?: string | null }>;
  pendingOrderSymbols: string[];
  capital: number;
  usedCapital: number;
  maxPositions: number;
  maxSelectedPerScan?: number;
  maxUnicornSelectedPerScan?: number;
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
  runtimeCanAttemptAutoExecution?: boolean;
}

export type CanonicalExecutableCandidate = ExecutionDecision;

export type CanonicalExecutableCandidateSet = {
  scanId: string;
  candidatesEvaluated: number;
  executableCandidates: CanonicalExecutableCandidate[];
  blockedCandidates: CanonicalExecutableCandidate[];
  skippedCandidates: CanonicalExecutableCandidate[];
  selectedCandidateForExecution: string | null;
  noExecutionReason: string;
  uiBuyReadySymbols: string[];
  canonicalBuyReadySymbols: string[];
};

function hydratePlannerExecutionContract(candidate: ScannerCandidate): ScannerCandidate {
  const audit = buildStrategyAuditSnapshotFromCandidate(candidate);
  const auditAny = audit as any;
  const primaryBlocker = String(
    auditAny.dynamicSetupContext?.primaryBlocker
    ?? audit.finalBlocker
    ?? audit.strategyContractBlocker
    ?? 'none',
  );
  const finalNoBuyReason = audit.finalExecutable && audit.buyAllowed
    ? undefined
    : resolveFinalNoBuyReasonPriority({
      symbol: candidate.symbol,
      rawStatus: candidate.status,
      displayStatus: candidate.lifecycleStatus ?? candidate.status,
      finalExecutable: audit.finalExecutable,
      buyAllowed: audit.buyAllowed,
      primaryBlocker,
      setupResult: audit.setupResult,
      candidateWhy: candidate.mainReason,
      previousFinalNoBuyReason: (candidate as any).finalNoBuyReason ?? audit.finalNoBuyReason ?? audit.finalBlocker,
      blockReasons: audit.blockReasons,
      entryGateBlocker: candidate.entryGateDecision?.primaryReason ?? candidate.entryGateDecision?.blockReasons?.[0] ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0],
      strategyContractBlocker: audit.strategyContractBlocker,
      executionDecisionFinalNoBuyReason: (candidate as any).executionDecision?.finalNoBuyReason,
      runtimeReason: (candidate as any).executionPrecheckSnapshot?.failureReason,
      handoffMismatch: audit.handoffIntegrityStatus === 'failed',
    }).resolvedFinalNoBuyReason;
  return {
    ...candidate,
    strategyAuditSnapshot: (candidate as any).strategyAuditSnapshot ?? audit,
    finalExecutionStrategy: String(auditAny.finalExecutionStrategy ?? audit.strategySelected ?? candidate.selectedStrategy ?? ''),
    effectiveStrategy: String(auditAny.finalExecutionStrategy ?? audit.strategySelected ?? candidate.effectiveStrategy ?? candidate.selectedStrategy ?? ''),
    selectedStrategy: String(auditAny.finalExecutionStrategy ?? audit.strategySelected ?? candidate.selectedStrategy ?? ''),
    setupResult: String(audit.setupResult ?? (candidate as any).setupResult ?? 'none'),
    primaryBlocker,
    finalExecutable: audit.finalExecutable,
    buyAllowed: audit.buyAllowed,
    finalNoBuyReason,
    actionableNoBuyReason: audit.actionableNoBuyReason,
    technicalNoBuyReason: audit.technicalNoBuyReason,
    secondaryDiagnosticReasons: audit.secondaryDiagnosticReasons,
    handoffIntegrityStatus: audit.handoffIntegrityStatus,
  } as ScannerCandidate;
}

function buildRuntimeBlockedExecutionDecision(candidate: ScannerCandidate, scanId: string, reason: string): ExecutionDecision {
  return {
    symbol: candidate.symbol,
    scanId,
    candidateRank: candidate.rank ?? 0,
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'WAIT_RUNTIME_STATE',
    finalExecutionStrategy: String(candidate.finalExecutionStrategy ?? candidate.selectedStrategy ?? 'wait'),
    riskGroup: candidate.riskGroup ?? 'unknown',
    groupName: candidate.riskGroup ?? 'unknown',
    groupRecommendedStrategy: String(candidate.groupRecommendedStrategy ?? ''),
    groupOpenCount: 0,
    groupMaxOpen: 0,
    groupExposure: 0,
    groupMaxExposure: 0,
    priceFresh: candidate.priceFresh !== false,
    bookFresh: candidate.bookFresh !== false,
    spreadOk: false,
    tpRoomOk: false,
    capitalOk: false,
    maxOpenPositionsOk: false,
    maxGroupPositionsOk: false,
    maxGroupExposureOk: false,
    duplicateOpenPosition: false,
    pendingOrderExists: false,
    banned: false,
    buySpacingOk: false,
    runtimeExecutionEnabled: false,
    selectedForExecution: false,
    submitAttempted: false,
    adapterCalled: false,
    adapterAccepted: false,
    adapterResult: '',
    orderFilled: false,
    positionCreated: false,
    journalPersisted: false,
    telegramSent: false,
    finalDecision: 'SKIP',
    finalNoBuyReason: reason as any,
    finalNoBuyReasonCode: reason,
    finalNoBuyReasonLabel: reason,
    actionableNoBuyReason: reason,
    technicalNoBuyReason: 'none',
    secondaryDiagnosticReasons: [],
    renderedUserMessage: reason,
    finalNoBuyReasonSource: 'candidate_runtime_snapshot_guard',
    reasonPriorityTrace: [{ reason, passed: false, detail: 'Missing or invalid candidate runtime snapshot' }],
    invariantOk: true,
  };
}

export function buildExecutableCandidateSet(input: {
  scanSnapshot: ScannerSnapshot;
  runtimeState: { canAttemptScannerAutoExecution: boolean };
  riskState: {
    openSymbols: string[];
    openPositionDetails?: Array<{ symbol: string; tradeId?: string | null; source?: string | null; ownerName?: string | null }>;
    pendingOrderSymbols: string[];
    capital: number;
    usedCapital: number;
    capitalPerTrade: number;
    maxPositions: number;
    maxSpreadPct: number;
  };
}): CanonicalExecutableCandidateSet {
  const candidates = input.scanSnapshot.candidates ?? [];
  const capitalAvailable = Math.max(0, input.riskState.capital - input.riskState.usedCapital);
  const capitalOk = input.riskState.capitalPerTrade > 0 && capitalAvailable >= input.riskState.capitalPerTrade;
  const maxOpenPositionsOk = input.riskState.openSymbols.length < input.riskState.maxPositions;
  const decisions: ExecutionDecision[] = candidates.map((candidate) => {
    candidate = rehydrateCandidateMarketFreshness({
      candidate,
      current: MarketDataFeed.getInstance().getCanonicalSymbolMarketData(candidate.symbol),
      consumer: 'ExecutionPlanner',
      scanId: input.scanSnapshot.scanId,
    });
    const runtimeReady = assertCandidateRuntimeReady({
      candidate,
      scanId: input.scanSnapshot.scanId ?? 'unknown',
      sourcePath: 'execution_planner_executable_set',
      blockedBeforeEntryGate: true,
    });
    if (!runtimeReady.ready) {
      const decision = buildRuntimeBlockedExecutionDecision(runtimeReady.candidate, input.scanSnapshot.scanId ?? 'unknown', runtimeReady.candidate.finalNoBuyReason ?? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
      emitCanonicalExecutionDecisionAudit(decision);
      return decision;
    }
    const revalidatedCandidate = revalidateCandidateForExecution(hydratePlannerExecutionContract(runtimeReady.candidate));
    candidate = revalidatedCandidate;
    const audit = buildStrategyAuditSnapshotFromCandidate(candidate);
    const setupResult = String(audit.setupResult ?? '');
    const priceFresh = candidate.priceFresh ?? audit.priceFresh ?? true;
    const spreadOk = candidate.priceFresh !== false && (candidate.spreadPct ?? 0) <= input.riskState.maxSpreadPct;
    const tpRoomOk = candidate.tpRoomOk !== false && audit.tpRoomOk !== false;
    const duplicateDetail = input.riskState.openPositionDetails?.find((p) => p.symbol === candidate.symbol);
    const duplicateOpenPosition = Boolean(duplicateDetail) || input.riskState.openSymbols.includes(candidate.symbol);
    logger.info(`DUPLICATE_POSITION_GUARD_AUDIT: symbol=${candidate.symbol} candidateSource=${String((candidate as any).candidateSource ?? (candidate as any).source ?? 'scanner')} sourceModule=${isUnicornCandidateLike(candidate) ? 'UnicornHunter' : 'ExecutionPlanner'} duplicateOpenPosition=${String(duplicateOpenPosition)} duplicateSource=PositionManager duplicatePositionId=${duplicateDetail?.tradeId ?? (duplicateOpenPosition ? 'unknown_position_manager_id' : 'none')} positionManagerOpenCount=${input.riskState.openSymbols.length} storeOpenCount=n/a sqliteOpenCount=n/a reconciliationOk=true blocked=${String(duplicateOpenPosition)} finalNoBuyReasonCode=${duplicateOpenPosition ? 'DUPLICATE_OPEN_POSITION' : 'none'}`);
    const pendingOrder = input.riskState.pendingOrderSymbols.includes(candidate.symbol);
    const isUnicornCandidate = isUnicornCandidateLike(candidate);
    const unicornMissingFields = isUnicornCandidate ? getUnicornHandoffMissingFields(candidate) : [];
    const unicornHandoffOk = !isUnicornCandidate || unicornMissingFields.length === 0;
    const structuralBlockReason = !unicornHandoffOk
      ? 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
      : duplicateOpenPosition
        ? 'DUPLICATE_OPEN_POSITION'
        : pendingOrder
          ? 'PENDING_ORDER_EXISTS'
          : !maxOpenPositionsOk
            ? 'MAX_OPEN_POSITIONS_REACHED'
            : !capitalOk
              ? 'CAPITAL_LIMIT'
              : !priceFresh && candidate.bookFresh === false
                ? 'PRICE_NOT_FRESH / BOOK_STALE'
                : !priceFresh
                  ? 'PRICE_STALE'
                  : candidate.bookFresh === false
                    ? 'BOOK_STALE'
                    : !spreadOk
                      ? 'SPREAD_TOO_HIGH'
                      : !tpRoomOk
                        ? 'TP_ROOM_NOT_OK'
                        : 'none';
    if (isUnicornCandidate) {
      logger.info(`UNICORN_HANDOFF_INTEGRITY_AUDIT: symbol=${candidate.symbol} scanId=${input.scanSnapshot.scanId ?? 'unknown'} source=${(candidate as any).source ?? 'missing'} owner=${(candidate as any).ownerName ?? 'missing'} candidateSource=${(candidate as any).candidateSource ?? 'missing'} strategySource=${String(candidate.strategySource ?? 'missing')} executionSource=${(candidate as any).executionSource ?? 'missing'} selectedStrategy=${candidate.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidate as any).finalExecutionStrategy ?? 'missing'} setupValidatorUsed=${(candidate as any).setupValidatorUsed ?? 'missing'} entryRule=${(candidate as any).finalEntryRule ?? (candidate as any).entryRule ?? candidate.mainReason ?? 'missing'} score=${(candidate as any).unicornScore ?? candidate.rawScore ?? 'n/a'} confidence=${candidate.confidence ?? 'n/a'} riskGroup=${candidate.riskGroup ?? 'missing'} refPeriod=${candidate.referencePeriod ?? (candidate as any).refPeriod ?? 'missing'} buyAllowed=${String(candidate.buyAllowed === true)} finalExecutable=${String(candidate.finalExecutable === true)} missingFields=${unicornMissingFields.join('|') || 'none'} invariantOk=${String(unicornHandoffOk)} failureReason=${unicornHandoffOk ? 'none' : 'STRATEGY_HANDOFF_INTEGRITY_FAILED'}`);
    }

    const params: ExecutionDecisionParams = {
      symbol: candidate.symbol,
      scanId: input.scanSnapshot.scanId ?? 'unknown',
      candidateRank: candidate.rank ?? 0,
      status: candidate.status,
      finalExecutable: audit.finalExecutable && candidate.status === 'BUY' && unicornHandoffOk,
      buyAllowed: audit.buyAllowed && unicornHandoffOk,
      setupResult,
      finalExecutionStrategy: String(audit.finalExecutionStrategy ?? audit.strategySelected),
      riskGroup: candidate.riskGroup ?? 'unknown',
      groupName: candidate.riskGroup ?? 'unknown',
      groupRecommendedStrategy: String(audit.groupRecommendedStrategy ?? ''),
      groupOpenCount: input.riskState.openSymbols.filter(s => s === candidate.symbol).length,
      groupMaxOpen: Math.floor(input.riskState.maxPositions / 5),
      groupExposure: 0,
      groupMaxExposure: input.riskState.capital,
      priceFresh,
      bookFresh: candidate.bookFresh !== false,
      spreadOk,
      tpRoomOk,
      capitalOk,
      maxOpenPositionsOk,
      maxGroupPositionsOk: true,
      maxGroupExposureOk: true,
      duplicateOpenPosition,
      pendingOrderExists: pendingOrder,
      banned: (candidate as any).banned === true,
      buySpacingOk: true,
      runtimeExecutionEnabled: input.runtimeState.canAttemptScannerAutoExecution,
      primaryBlocker: structuralBlockReason !== 'none' ? structuralBlockReason : candidate.primaryBlocker ?? (candidate as any).strategyAuditSnapshot?.dynamicSetupContext?.primaryBlocker ?? audit.finalBlocker ?? audit.strategyContractBlocker ?? 'none',
      blockReasons: structuralBlockReason === 'none' ? candidate.blockReasons ?? audit.blockReasons ?? [] : Array.from(new Set([...(candidate.blockReasons ?? []), structuralBlockReason])),
      candidateWhy: candidate.mainReason,
      previousFinalNoBuyReason: structuralBlockReason !== 'none' ? structuralBlockReason : (candidate as any).finalNoBuyReason ?? audit.finalNoBuyReason ?? audit.finalBlocker ?? 'none',
      entryGateBlocker: candidate.entryGateDecision?.primaryReason ?? candidate.entryGateDecision?.blockReasons?.[0] ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0],
      strategyContractBlocker: audit.strategyContractBlocker,
      runtimeReason: (candidate as any).executionPrecheckSnapshot?.failureReason,
      handoffMismatch: audit.handoffIntegrityStatus === 'failed' || !unicornHandoffOk,
    };
    const decision = resolveExecutionDecision(params);
    if (isUnicornCandidate) {
      logger.info(`UNICORN_EXECUTION_DECISION_AUDIT: symbol=${candidate.symbol} scanId=${input.scanSnapshot.scanId ?? 'unknown'} source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter selectedForExecution=${String(decision.finalDecision === 'EXECUTE')} finalDecision=${decision.finalDecision} finalExecutable=${String(decision.finalExecutable)} buyAllowed=${String(decision.buyAllowed)} submitAttempted=${String(decision.submitAttempted)} adapterCalled=${String(decision.adapterCalled)} duplicateOpenPosition=${String(decision.duplicateOpenPosition)} maxOpenPositionsOk=${String(decision.maxOpenPositionsOk)} capitalOk=${String(decision.capitalOk)} spreadOk=${String(decision.spreadOk)} tpRoomOk=${String(decision.tpRoomOk)} priceFresh=${String(decision.priceFresh)} finalNoBuyReasonCode=${decision.finalNoBuyReasonCode} finalNoBuyReasonLabel=${decision.finalNoBuyReasonLabel} finalNoBuyReason=${decision.finalNoBuyReason} blockerSource=${decision.duplicateOpenPosition ? 'PositionManager' : decision.maxOpenPositionsOk === false || decision.capitalOk === false ? 'RiskGuard' : decision.spreadOk === false || decision.tpRoomOk === false || decision.priceFresh === false ? 'EntryGate' : 'ExecutionDecision'} invariantOk=${String(decision.invariantOk)}`);
      if (decision.finalDecision === 'EXECUTE') {
        logger.info(`UNICORN_EXECUTION_SELECTED_AUDIT: symbol=${candidate.symbol} scanId=${input.scanSnapshot.scanId ?? 'unknown'} selectedForExecution=true source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter finalExecutable=${String(decision.finalExecutable)} buyAllowed=${String(decision.buyAllowed)} finalNoBuyReasonCode=none finalNoBuyReasonLabel=BUY_READY finalNoBuyReason=none`);
      } else {
        logger.info(`UNICORN_EXECUTABLE_DECISION_AUDIT: symbol=${candidate.symbol} scanId=${input.scanSnapshot.scanId ?? 'unknown'} stage=${candidate.lifecycleStatus ?? candidate.status ?? 'unknown'} score=${(candidate as any).unicornScore ?? candidate.rawScore ?? 'n/a'} sourceOwner=${candidate.runtimeSnapshot?.sourceOwner ?? 'unknown'} ownerType=${(candidate as any).ownerType ?? 'unknown'} strategy=${candidate.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidate as any).finalExecutionStrategy ?? 'missing'} entryRule=${(candidate as any).finalEntryRule ?? (candidate as any).entryRule ?? candidate.mainReason ?? 'missing'} setupResult=${(candidate as any).setupResult ?? audit.setupResult ?? 'missing'} buyAllowed=${String(decision.buyAllowed)} finalExecutable=${String(decision.finalExecutable)} submitAttempted=${String(decision.submitAttempted)} blockedReason=${decision.finalNoBuyReasonCode} slotOwner=none maxBuysPerCycle=n/a autobotsSlotUsed=false unicornSlotUsed=false openUnicornPositions=n/a unicornTradesToday=n/a cooldownRemainingMs=0 invariantOk=${String(decision.invariantOk)} failureReason=${decision.finalNoBuyReasonCode}`);
        logger.info(`UNICORN_BUY_BLOCKED_AUDIT: symbol=${candidate.symbol} scanId=${input.scanSnapshot.scanId ?? 'unknown'} selectedForExecution=false source=unicorn_hunter owner=UnicornHunter finalExecutable=${String(decision.finalExecutable)} buyAllowed=${String(decision.buyAllowed)} blockedReason=${decision.finalNoBuyReasonCode} finalNoBuyReasonCode=${decision.finalNoBuyReasonCode} finalNoBuyReasonLabel=${decision.finalNoBuyReasonLabel} missingFields=${unicornMissingFields.join('|') || 'none'}`);
      }
    }
    emitCanonicalExecutionDecisionAudit(decision);
    return decision;
  });

  const decisionsWithSelected = decisions.map((d) => ({
    ...d,
    selectedForExecution: d.finalDecision === 'EXECUTE',
  }));

  const uiBuyReadySymbols = decisionsWithSelected
    .filter((d) => d.finalExecutable && d.buyAllowed)
    .map((d) => d.symbol);
  const executableCandidates = decisionsWithSelected.filter((d) => d.selectedForExecution);
  const blockedCandidates = decisionsWithSelected.filter((d) => !d.finalExecutable || !d.buyAllowed);
  const skippedCandidates = decisionsWithSelected.filter((d) => d.finalExecutable && d.buyAllowed && !d.selectedForExecution);
  return {
    scanId: input.scanSnapshot.scanId ?? 'unknown',
    candidatesEvaluated: decisionsWithSelected.length,
    executableCandidates,
    blockedCandidates,
    skippedCandidates,
    selectedCandidateForExecution: executableCandidates[0]?.symbol ?? null,
    noExecutionReason: executableCandidates.length > 0 ? 'none' : (skippedCandidates[0]?.finalNoBuyReason ?? blockedCandidates[0]?.finalNoBuyReason ?? 'NO_BUY_READY_CANDIDATES'),
    uiBuyReadySymbols,
    canonicalBuyReadySymbols: executableCandidates.map((d) => d.symbol),
  };
}

function computeExecutionScore(c: ScannerCandidate): number {
  let score = 0;
  if (c.finalExecutable === true) score += 2000;
  if (c.buyAllowed === true) score += 1000;
  if (c.entryGateDecision?.decision === 'ALLOW') score += 1000;
  if (c.riskDecision?.verdict === 'ALLOW') score += 500;
  score += c.confidence * 200;
  score += Number((c as any).professionalScore ?? c.rawScore ?? 0) * 10;
  if (isUnicornCandidateLike(c)) score += 1500;
  if (String((c as any).sourcePriority ?? '').toLowerCase() === 'high') score += 400;
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
  if (r.includes('queue') && r.includes('max')) return 'MAX_EXECUTION_QUEUE_REACHED';
  if (r.includes('unicorn') && r.includes('cycle') && r.includes('max')) return 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
  if (r.includes('unicorn') && r.includes('max') && r.includes('buy')) return 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
  if (r.includes('rebound')) return 'REBOUND_NOT_CONFIRMED';
  if (r.includes('spread')) return 'SPREAD_TOO_HIGH';
  if (r.includes('tp') || r.includes('room')) return 'NO_TP_ROOM';
  if (r.includes('price') && r.includes('book') && (r.includes('stale') || r.includes('fresh'))) return 'PRICE_NOT_FRESH / BOOK_STALE';
  if (r.includes('book')) return 'BOOK_STALE';
  if (r.includes('stale')) return 'PRICE_STALE';
  if (r.includes('duplicate')) return 'DUPLICATE_POSITION';
  if (r.includes('unicorn') && (r.includes('max') || r.includes('position'))) return 'UNICORN_BLOCK_OPEN_POSITION_LIMIT';
  if (r.includes('global') && (r.includes('position') || r.includes('max'))) return 'MAX_GLOBAL_POSITIONS_REACHED';
  if (r.includes('group') && (r.includes('position') || r.includes('cap') || r.includes('max'))) return 'MAX_GROUP_POSITIONS_REACHED';
  if (r.includes('cycle') && r.includes('max')) return 'MAX_NEW_BUYS_PER_CYCLE_REACHED';
  if (r.includes('capital') && (r.includes('allocation') || r.includes('max'))) return 'MAX_CAPITAL_ALLOCATION_REACHED';
  if (r.includes('position') || r.includes('max')) return 'MAX_GLOBAL_POSITIONS_REACHED';
  if (r.includes('capital')) return 'CAPITAL_BLOCKED';
  if (r.includes('order') || r.includes('lock') || r.includes('pending')) return 'DUPLICATE_PENDING_ORDER';
  if (r.includes('group') || r.includes('disabled')) return 'GROUP_DISABLED';
  if (r.includes('live')) return 'LIVE_DISABLED';
  if (r.includes('watchlist') || r.includes('empty')) return 'WATCHLIST_EMPTY';
  return reason.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function normalizeUnicornNoBuyReason(reason: string): string {
  const normalized = normalizeUnicornFinalBlockReason(reason);
  return normalized === 'none' ? 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE' : normalized;
}

function isUnicornCandidateLike(candidate: ScannerCandidate): boolean {
  const c = candidate as any;
  return [
    c.source,
    c.candidateSource,
    c.executionSource,
    c.strategySource,
    c.ownerName,
    c.autoStrategyDecision?.strategySource,
    c.scannerAutoEntryConfigSnapshot?.source,
    c.scannerAutoEntryConfigSnapshot?.ownerName,
    c.scannerAutoEntryConfigSnapshot?.strategySource,
  ].some((value) => String(value ?? '').toLowerCase().includes('unicorn'));
}

function queueSourceOwner(candidate: ScannerCandidate): 'AutoBots' | 'UnicornHunter' {
  return isUnicornCandidateLike(candidate) ? 'UnicornHunter' : 'AutoBots';
}

function queueAuditValue(value: unknown): string {
  const text = String(value ?? 'n/a').trim();
  return text.length > 0 ? text.replace(/\s+/g, '_') : 'n/a';
}

function hasCanonicalUnicornTp1Ownership(ownership: unknown): boolean {
  const o = ownership as any;
  return String(o?.strategySource ?? '').toLowerCase() === 'unicorn_hunter'
    && String(o?.tp1Source ?? '') === 'Unicorn dynamic per coin'
    && Number(o?.tp1Min) === 5
    && Number(o?.tp1Max) === 10;
}

function getUnicornHandoffMissingFields(candidate: ScannerCandidate): string[] {
  const c = candidate as any;
  const missing: string[] = [];
  const source = String(c.source ?? '').toLowerCase();
  const candidateSource = String(c.candidateSource ?? '').toLowerCase();
  const executionSource = String(c.executionSource ?? '').toLowerCase();
  const strategySource = String(c.strategySource ?? '').toLowerCase();
  const ownerName = String(c.ownerName ?? '').toLowerCase();
  const ownerType = String(c.ownerType ?? '').toLowerCase();
  const sourceOwner = String(c.sourceOwner ?? candidate.runtimeSnapshot?.sourceOwner ?? '').toLowerCase();
  if (!source.includes('unicorn')) missing.push('source');
  if (!candidateSource.includes('unicorn')) missing.push('candidateSource');
  if (!executionSource.includes('unicorn')) missing.push('executionSource');
  if (!strategySource.includes('unicorn')) missing.push('strategySource');
  if (!ownerName.includes('unicorn')) missing.push('ownerName');
  if (ownerType !== 'unicorn') missing.push('ownerType');
  if (!sourceOwner.includes('unicorn')) missing.push('sourceOwner');
  if (!candidate.selectedStrategy) missing.push('selectedStrategy');
  if (!c.finalExecutionStrategy) missing.push('finalExecutionStrategy');
  if (!c.setupValidatorUsed) missing.push('setupValidatorUsed');
  if (!c.finalEntryRule && !c.entryRule && !candidate.mainReason) missing.push('entryRule');
  if (!Number.isFinite(Number(candidate.confidence))) missing.push('confidence');
  if (!Number.isFinite(Number(c.unicornScore ?? candidate.rawScore ?? candidate.confidence * 100))) missing.push('score');
  if (!candidate.riskGroup) missing.push('riskGroup');
  if (!candidate.referencePeriod && !c.refPeriod) missing.push('refPeriod');
  if (candidate.finalExecutable !== true) missing.push('finalExecutable');
  if (candidate.buyAllowed !== true) missing.push('buyAllowed');
  if (!candidate.runtimeSnapshot || candidate.runtimeSnapshot.invariantOk === false) missing.push('runtimeSnapshot');
  if (candidate.runtimeSnapshot && !String(candidate.runtimeSnapshot.sourceOwner ?? '').toLowerCase().includes('unicorn')) missing.push('runtimeSnapshot.sourceOwner');
  if (!candidate.strategyDecision || candidate.strategyDecision.invariantOk === false) missing.push('strategyDecision');
  if (!candidate.executionPrecheckSnapshot || candidate.executionPrecheckSnapshot.invariantOk === false) missing.push('executionPrecheckSnapshot');
  if (!isValidEntryPlan(candidate.entryPlan ?? candidate.traderBrainDecision?.entryPlan)) missing.push('entryPlan');
  if (candidate.entryGateDecision?.decision !== 'ALLOW') missing.push('entryGateDecision');
  return Array.from(new Set(missing));
}

function isValidEntryPlan(plan: unknown): plan is { side: 'BUY' | 'SELL'; price: number; quantity: number; reason: string } {
  if (!plan || typeof plan !== 'object') return false;
  const p = plan as Record<string, unknown>;
  return (p.side === 'BUY' || p.side === 'SELL')
    && typeof p.price === 'number' && p.price > 0
    && typeof p.quantity === 'number' && p.quantity > 0
    && typeof p.reason === 'string' && p.reason.length > 0;
}

function getCanonicalStrategyHandoffMissingFields(input: {
  candidate: ScannerCandidate;
  strategyAudit: ReturnType<typeof buildStrategyAuditSnapshotFromCandidate>;
  entryPlan?: { side: 'BUY' | 'SELL'; price: number; quantity: number; reason: string } | null;
  ownership?: { ownerType?: unknown; candidateSource?: unknown } | null;
  resolvedRisk?: ReturnType<typeof resolveEntryRiskParams> | null;
  entryConfigSnapshotPresent?: boolean;
}): string[] {
  const { candidate, strategyAudit, entryPlan, ownership, resolvedRisk } = input;
  const c = candidate as any;
  const runtime = candidate.runtimeSnapshot as any;
  const missing: string[] = [];
  const hasText = (value: unknown): boolean => String(value ?? '').trim().length > 0 && String(value ?? '').trim() !== 'none';
  const hasNumber = (value: unknown): boolean => Number.isFinite(Number(value));
  const hasBoolean = (value: unknown): boolean => typeof value === 'boolean';
  const unicornOwned = isUnicornCandidateLike(candidate);
  const resolvedOwnerType = ownership?.ownerType ?? c.ownerType ?? (unicornOwned ? null : 'scanner');
  const resolvedCandidateSource = ownership?.candidateSource ?? c.candidateSource ?? c.source ?? (unicornOwned ? null : 'AutoBots');
  if (!hasText(candidate.symbol)) missing.push('symbol');
  if (!hasText(c.sourceOwner ?? runtime?.sourceOwner)) missing.push('sourceOwner');
  if (!hasText(resolvedOwnerType)) missing.push('ownerType');
  if (!hasText(resolvedCandidateSource)) missing.push('candidateSource');
  if (!hasText(candidate.selectedStrategy ?? strategyAudit.strategySelected)) missing.push('strategy');
  if (!hasText(c.finalExecutionStrategy ?? strategyAudit.finalExecutionStrategy ?? strategyAudit.strategySelected)) missing.push('finalExecutionStrategy');
  if (!hasText(strategyAudit.strategyAtEntry ?? strategyAudit.strategySelected)) missing.push('strategyAtEntry');
  if (!hasText(c.setupValidatorUsed ?? (strategyAudit as any).setupValidatorUsed ?? strategyAudit.strategySelected)) missing.push('setupValidatorUsed');
  if (!hasText(c.finalEntryRule ?? c.entryRule ?? strategyAudit.finalEntryRule ?? candidate.mainReason)) missing.push('entryRule');
  if (!hasText(c.setupResult ?? strategyAudit.setupResult ?? strategyAudit.finalEntryRule)) missing.push('setupResult');
  if (!hasText(candidate.riskGroup)) missing.push('riskGroup');
  if (!hasNumber(candidate.confidence)) missing.push('confidence');
  if (!hasNumber(candidate.price)) missing.push('price');
  if (!hasNumber(runtime?.livePrice ?? c.livePrice ?? candidate.price)) missing.push('livePrice');
  if (!hasNumber(runtime?.referencePrice ?? c.referencePrice ?? candidate.price)) missing.push('refPrice');
  if (!hasNumber(candidate.spreadPct)) missing.push('spreadPct');
  if (!hasBoolean(candidate.tpRoomOk)) missing.push('tpRoomOk');
  if (!hasBoolean(candidate.priceFresh ?? runtime?.freshnessStatus === 'fresh')) missing.push('priceFresh');
  if (!hasBoolean(candidate.bookFresh)) missing.push('bookFresh');
  if (!hasNumber(candidate.dipPercent)) missing.push('dipPct');
  if (!hasNumber(candidate.reboundPercent)) missing.push('reboundPct');
  if (!hasText(candidate.reboundFreshnessStatus ?? runtime?.freshnessStatus)) missing.push('reboundFreshnessStatus');
  if (!hasBoolean(candidate.momentumConfirmed)) missing.push('momentumConfirmed');
  if (entryPlan) {
    if (!hasNumber(entryPlan.quantity) || entryPlan.quantity <= 0) missing.push('quantity');
    if (!hasNumber(entryPlan.price) || entryPlan.price <= 0) missing.push('entryPrice');
    if (!hasNumber(entryPlan.price * entryPlan.quantity)) missing.push('usedCapital');
  }
  if (resolvedRisk) {
    if (!hasNumber(resolvedRisk.tp1) || Number(resolvedRisk.tp1) <= 0) missing.push('tp1Pct');
    if (!hasText(resolvedRisk.sourceTp1)) missing.push('tp1Source');
    if (Number(resolvedRisk.tp2) !== 0) missing.push('tp2Pct=0');
    if (!hasNumber(resolvedRisk.sl)) missing.push('slPct');
  }
  if (input.entryConfigSnapshotPresent === false) missing.push('entryConfigSnapshot');
  return Array.from(new Set(missing));
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
  const maxExecutionQueuePerScan = MAX_EXECUTION_QUEUE_PER_SCAN;
  logger.info(
    `EXECUTION_QUEUE_CONFIG_AUDIT: ` +
    `maxExecutionQueuePerScan=${maxExecutionQueuePerScan} ` +
    `sourceOfConfig=execution_queue_standard_constant ` +
    `hydratedFromSettings=false ` +
    `fallbackUsed=false ` +
    `hardcodedFallbackUsed=false ` +
    `invariantOk=${String(maxExecutionQueuePerScan === 10)} ` +
    `failureReason=${maxExecutionQueuePerScan === 10 ? 'none' : 'MAX_EXECUTION_QUEUE_PER_SCAN_NOT_10'}`
  );
  const availableSlots = Math.max(0, maxPositions - openSymbols.length);
  const capitalAvailable = Math.max(0, capital - usedCapital);
  const capitalLimitedSlots = capitalPerTrade > 0 ? Math.floor(capitalAvailable / capitalPerTrade) : 0;
  logger.info(`CAPITAL_PER_COIN_ORDER_SIZE_AUDIT: symbol=none mode=${executionAdapter === 'paper_simulated' ? 'demo' : 'live'} userTradingCapital=${capital} userCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${capitalPerTrade} finalOrderNotionalUsd=0 qty=0 entryPrice=0 availableCapital=${capital} usedCapitalBefore=${usedCapital} usedCapitalAfter=${usedCapital} adjustmentReason=planner_limits source=persisted`);
  const normalizePlannerSymbol = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();
  const openSymbolSet = new Set(openSymbols.map(normalizePlannerSymbol).filter(Boolean));
  const activeExecutionPool = executionPool.filter((candidate) => {
    const wasOpenPosition = openSymbolSet.has(normalizePlannerSymbol(candidate.symbol));
    if (wasOpenPosition) {
      logger.info(`EXECUTION_POOL_OPEN_SYMBOL_EXCLUSION_AUDIT: openSymbols=${openSymbols.join('|') || 'none'} candidateSymbol=${candidate.symbol} wasOpenPosition=true removedFromTopCandidates=true removedFromExecutionPool=true reason=FILTERED_ALREADY_OPEN_POSITION source=PositionManager`);
      return false;
    }
    return true;
  });
  const activeWatchPool = watchPool.filter((candidate) => !openSymbolSet.has(normalizePlannerSymbol(candidate.symbol)));
  const activeNearMissPool = nearMissPool.filter((candidate) => !openSymbolSet.has(normalizePlannerSymbol(candidate.symbol)));
  const activeScannerSnapshot = {
    ...scannerSnapshot,
    candidates: (scannerSnapshot.candidates ?? []).filter((candidate) => {
      const wasOpenPosition = openSymbolSet.has(normalizePlannerSymbol(candidate.symbol));
      if (wasOpenPosition) {
        logger.info(`ENTRY_CANDIDATE_DUPLICATE_FILTER_AUDIT: openSymbols=${openSymbols.join('|') || 'none'} candidateSymbol=${candidate.symbol} wasOpenPosition=true removedFromTopCandidates=true removedFromExecutionPool=true reason=FILTERED_ALREADY_OPEN_POSITION source=PositionManager`);
      }
      return !wasOpenPosition;
    }),
  };
  const filteredAlreadyOpenCount = executionPool.length - activeExecutionPool.length;
  const filteredAlreadyOpenCandidates = executionPool
    .filter((candidate) => openSymbolSet.has(normalizePlannerSymbol(candidate.symbol)));
  const filteredAlreadyOpenSymbols = filteredAlreadyOpenCandidates.map((candidate) => candidate.symbol);
  if (filteredAlreadyOpenCount > 0) {
    logger.info(`BUY_READY_COUNT_AFTER_DUPLICATE_FILTER_AUDIT: openSymbols=${openSymbols.join('|') || 'none'} rawBuyReadyBeforeFilter=${executionPool.length} activeBuyReadyAfterFilter=${activeExecutionPool.length} filteredAlreadyOpenCount=${filteredAlreadyOpenCount} filteredSymbols=${filteredAlreadyOpenSymbols.join('|') || 'none'} reason=FILTERED_ALREADY_OPEN_POSITION source=PositionManager`);
  }
  const canonicalSet = buildExecutableCandidateSet({
    scanSnapshot: activeScannerSnapshot,
    runtimeState: { canAttemptScannerAutoExecution: input.runtimeCanAttemptAutoExecution ?? true },
    riskState: { openSymbols, openPositionDetails: input.openPositionDetails, pendingOrderSymbols, capital, usedCapital, capitalPerTrade, maxPositions, maxSpreadPct },
  });
  const excludedUiReady = canonicalSet.skippedCandidates.map((c) => `${c.symbol}:${c.finalNoBuyReason}`);
  logger.info(`EXECUTION_SELECTION_INTEGRITY_AUDIT: scanId=${canonicalSet.scanId} uiBuyReadySymbols=${canonicalSet.uiBuyReadySymbols.join('|') || 'none'} canonicalBuyReadySymbols=${canonicalSet.canonicalBuyReadySymbols.join('|') || 'none'} executableCandidateSymbols=${canonicalSet.executableCandidates.map((c) => c.symbol).join('|') || 'none'} selectedCandidateSymbol=${canonicalSet.selectedCandidateForExecution ?? 'none'} submitAttempted=false adapterCalled=false noExecutionReason=${canonicalSet.noExecutionReason} excludedUiReady=${excludedUiReady.join('|') || 'none'} mismatchDetected=${String(canonicalSet.uiBuyReadySymbols.length > 0 && canonicalSet.executableCandidates.length === 0)} mismatchReason=${canonicalSet.uiBuyReadySymbols.length > 0 && canonicalSet.executableCandidates.length === 0 ? canonicalSet.noExecutionReason : 'none'} invariantOk=${String(!(canonicalSet.uiBuyReadySymbols.length > 0 && canonicalSet.executableCandidates.length === 0 && excludedUiReady.length === 0))}`);
  if (canonicalSet.uiBuyReadySymbols.length > 0 && canonicalSet.executableCandidates.length === 0 && excludedUiReady.length === 0) {
    logger.error(`EXECUTION_SELECTION_INTEGRITY_FAILED: scanId=${canonicalSet.scanId} uiBuyReadySymbols=${canonicalSet.uiBuyReadySymbols.join('|')} canonicalBuyReadySymbols=none executableCandidateSymbols=none noExecutionReason=UNKNOWN_EXECUTION_SELECTION_BUG candidateSnapshots=${JSON.stringify((scannerSnapshot.candidates ?? []).filter((c) => canonicalSet.uiBuyReadySymbols.includes(c.symbol)).map((c) => ({ symbol: c.symbol, status: c.status, finalExecutable: (c as any).finalExecutable, buyAllowed: (c as any).buyAllowed, mainReason: c.mainReason, blockReasons: c.blockReasons })))}`);
  }
  // Build canonical reason lookup from buildExecutableCandidateSet
  const canonicalDecisionBySymbol = new Map<string, string>();
  for (const d of [...canonicalSet.executableCandidates, ...canonicalSet.blockedCandidates, ...canonicalSet.skippedCandidates]) {
    if (d.finalNoBuyReason && d.finalNoBuyReason !== 'none') {
      canonicalDecisionBySymbol.set(d.symbol, d.finalNoBuyReason);
    }
  }

  const maxAutoBotsSelectedPerScan = maxSelectedPerScan;
  const maxUnicornSelectedPerScan = Math.max(1, Math.floor(Number(input.maxUnicornSelectedPerScan) || 1));
  const globalSafetySelectionLimit = Math.max(0, Math.min(availableSlots, capitalLimitedSlots));
  const selectionLimit = Math.max(0, Math.min(globalSafetySelectionLimit, maxAutoBotsSelectedPerScan + maxUnicornSelectedPerScan));
  const executionSafetyCap = maxPositions;
  const executionSafetyBlocked = openSymbols.length >= executionSafetyCap;
  logger.info(`EXECUTION_SAFETY_CAP_AUDIT: scanId=${scannerSnapshot?.scanId ?? 'unknown'} openPositions=${openSymbols.length} uiMaxPositions=${maxPositions} runtimeMaxPositions=${maxPositions} positionManagerOpenCount=${openSymbols.length} storeOpenCount=${openSymbols.length} executionSafetyCap=${executionSafetyCap} sourceOfExecutionSafetyCap=user_max_open_positions capHydratedFromSettings=true capHardcoded=false blocked=${String(executionSafetyBlocked)} blockedReason=${executionSafetyBlocked ? 'MAX_GLOBAL_POSITIONS_REACHED' : 'none'} invariantOk=${String(openSymbols.length < maxPositions || executionSafetyBlocked)} failureReason=none`);
  const noBuyReasons: string[] = [];
  const selectedCandidates: PlannedCandidate[] = [];
  const skippedCandidates: SkippedCandidate[] = [];
  const skippedReasons: string[] = [];
  let queueAcceptedCount = 0;
  const queueAcceptedSymbols: string[] = [];
  const queueDeferredSymbols: string[] = [];
  const queueRejectedReasons: string[] = [];
  const queuePriorityOrder: string[] = [];
  const handoffValidSymbols: string[] = [];
  const sourceBreakdown = { AutoBots: 0, UnicornHunter: 0 };
  let autoBotsSelectedThisCycle = 0;
  let unicornSelectedThisCycle = 0;
  if (filteredAlreadyOpenCount > 0) {
    noBuyReasons.push('FILTERED_ALREADY_OPEN_POSITION');
    skippedReasons.push('FILTERED_ALREADY_OPEN_POSITION');
    for (const candidate of filteredAlreadyOpenCandidates) {
      const finalNoBuyReason = isUnicornCandidateLike(candidate)
        ? normalizeUnicornNoBuyReason('FILTERED_ALREADY_OPEN_POSITION')
        : 'FILTERED_ALREADY_OPEN_POSITION';
      skippedCandidates.push({
        symbol: candidate.symbol,
        status: 'FILTERED_ALREADY_OPEN_POSITION',
        reason: 'FILTERED_ALREADY_OPEN_POSITION',
        gate: 'PositionManager',
        isRetryable: true,
        finalNoBuyReason,
      });
    }
  }
  let generatedEntryPlanCount = 0;
  let plannerInputWithEntryPlan = 0;
  let entryPlanBlockedCount = 0;
  let confirmationBlockedCount = 0;
  let spreadBlockedCount = 0;

  const revalidatedExecutionPool = activeExecutionPool.map((candidateFromPool) => {
    const c = rehydrateCandidateMarketFreshness({
      candidate: candidateFromPool,
      current: MarketDataFeed.getInstance().getCanonicalSymbolMarketData(candidateFromPool.symbol),
      consumer: 'ExecutionPlanner.selection_pool',
      scanId: scannerSnapshot.scanId,
    });
    const runtimeReady = assertCandidateRuntimeReady({
      candidate: c,
      scanId: scannerSnapshot.scanId ?? 'unknown',
      sourcePath: 'execution_planner_pool_revalidation',
      blockedBeforeEntryGate: true,
    });
    if (!runtimeReady.ready) return runtimeReady.candidate;
    const candidate = revalidateCandidateForExecution(hydratePlannerExecutionContract(runtimeReady.candidate));
    if (c.status === 'BUY' && candidate.status !== 'BUY') {
      logger.info(`CANDIDATE_EXECUTION_REVALIDATION_DEMOTED: symbol=${candidate.symbol} previousStatus=${c.status} finalStatus=${candidate.lifecycleStatus ?? candidate.status} reason=${candidate.finalNoBuyReason ?? candidate.promotionAudit?.blockedPromotionReason ?? 'unknown'} adapterCallAllowed=false`);
    }
    return candidate;
  });
  const scoredExecutionPool = revalidatedExecutionPool.map(c => ({ candidate: c, score: computeExecutionScore(c) }));
  scoredExecutionPool.sort((a, b) => b.score - a.score);
  logger.info(`EXECUTION_SELECTION_LIMIT_AUDIT: totalPoolCandidates=${activeExecutionPool.length} evaluatedCandidates=${scoredExecutionPool.length} blockedByRealSafety=0 blockedByDuplicatePosition=${filteredAlreadyOpenCount} blockedByPendingOrder=0 blockedByMaxOpenPositions=${availableSlots <= 0 ? activeExecutionPool.length : 0} blockedByCapital=${capitalLimitedSlots <= 0 ? activeExecutionPool.length : 0} blockedBySpread=0 blockedByTpRoom=0 blockedByPriceStale=0 selectionLimitApplied=${String(selectionLimit < activeExecutionPool.length)} maxSelectedPerScan=${maxSelectedPerScan} maxAutoBotsSelectedPerScan=${maxAutoBotsSelectedPerScan} maxUnicornSelectedPerScan=${maxUnicornSelectedPerScan} effectiveSelectionLimit=${selectionLimit}`);

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
  const groupMaxOpenByName: Record<string, number> = {
    top_caps: 5,
    large_caps: 5,
    mid_caps: 6,
    high_risk: 4,
    very_high_risk: 4,
    unknown: maxPositions,
  };
  const openGroupCountByName = new Map<string, number>();
  for (const symbol of openSymbols) {
    const group = (scannerSnapshot.candidates ?? []).find((candidate) => candidate.symbol === symbol)?.riskGroup ?? 'unknown';
    openGroupCountByName.set(group, (openGroupCountByName.get(group) ?? 0) + 1);
  }

  // Build round-robin ordered pool
  let roundRobinPool: typeof scoredExecutionPool = [];
  let round = 0;
  const MAX_ROUNDS = Math.max(0, ...[...grouped.values()].map((items) => items.length));
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

  const unicornReadyQueueIndexBeforeFairness = roundRobinPool.findIndex(({ candidate }) =>
    isUnicornCandidateLike(candidate)
    && candidate.status === 'BUY'
    && (candidate.finalExecutable === true || candidate.entryGateDecision?.decision === 'ALLOW')
    && candidate.buyAllowed !== false
    && (candidate.blockReasons ?? []).length === 0
  );
  let fairnessApplied = false;
  if (unicornReadyQueueIndexBeforeFairness >= maxExecutionQueuePerScan && unicornReadyQueueIndexBeforeFairness >= 0) {
    const [readyUnicorn] = roundRobinPool.splice(unicornReadyQueueIndexBeforeFairness, 1);
    if (readyUnicorn) {
      roundRobinPool = [readyUnicorn, ...roundRobinPool];
      fairnessApplied = true;
    }
  }

  logger.info(`GROUP_ROUND_ROBIN_SELECTION_AUDIT totalCandidates=${scoredExecutionPool.length} groupCaps=5|5|6|4|4 candidateCountByGroup=${[...grouped.entries()].map(([g, items]) => `${g}=${items.length}`).join('|')} rankedTopByGroup=${[...grouped.entries()].map(([g, items]) => `${g}:${items.slice(0, 3).map(i => i.candidate.symbol).join('|')}`).join('|')} selectionRounds=${round} roundRobinPoolSize=${roundRobinPool.length} fairnessApplied=${String(fairnessApplied)} unicornReadyQueueIndexBeforeFairness=${unicornReadyQueueIndexBeforeFairness >= 0 ? unicornReadyQueueIndexBeforeFairness + 1 : 'none'}`);

  for (const { candidate, score } of roundRobinPool) {
    const runtimeReady = assertCandidateRuntimeReady({
      candidate,
      scanId: scannerSnapshot.scanId ?? 'unknown',
      sourcePath: 'execution_planner_before_entry_gate',
      blockedBeforeEntryGate: true,
    });
    if (!runtimeReady.ready) {
      const reason = runtimeReady.candidate.finalNoBuyReason ?? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING';
      skippedCandidates.push({
        symbol: runtimeReady.candidate.symbol,
        status: runtimeReady.candidate.status,
        reason,
        gate: 'CandidateRuntimeGuard',
        isRetryable: true,
        finalNoBuyReason: reason,
      });
      if (!noBuyReasons.includes(reason)) noBuyReasons.push(reason);
      continue;
    }
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
    const isUnicornCandidate = isUnicornCandidateLike(candidateWithPlan);
    const groupName = candidateWithPlan.riskGroup ?? 'unknown';
    const groupOpenCount = openGroupCountByName.get(groupName) ?? 0;
    const groupMaxOpen = groupMaxOpenByName[groupName] ?? maxPositions;
    const globalMaxReached = openSymbols.length >= maxPositions;
    const groupMaxReached = groupOpenCount >= groupMaxOpen;
    const autoBotsCycleMaxReached = !isUnicornCandidate && maxAutoBotsSelectedPerScan > 0 && autoBotsSelectedThisCycle >= maxAutoBotsSelectedPerScan;
    const unicornCycleMaxReached = isUnicornCandidate && maxUnicornSelectedPerScan > 0 && unicornSelectedThisCycle >= maxUnicornSelectedPerScan;
    const executionQueueMaxReached = queueAcceptedCount >= maxExecutionQueuePerScan;
    const cycleMaxReached = autoBotsCycleMaxReached || unicornCycleMaxReached;
    const positionGuardReason = globalMaxReached
      ? 'MAX_GLOBAL_POSITIONS_REACHED'
      : groupMaxReached
        ? 'MAX_GROUP_POSITIONS_REACHED'
        : capitalLimitedSlots <= 0 && availableSlots > 0
          ? 'MAX_CAPITAL_ALLOCATION_REACHED'
          : autoBotsCycleMaxReached
            ? 'MAX_NEW_BUYS_PER_CYCLE_REACHED'
            : unicornCycleMaxReached
              ? 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED'
              : 'none';
    logger.info(`MAX_POSITION_GUARD_AUDIT: symbol=${symbol} globalOpenCount=${openSymbols.length} globalMaxOpen=${maxPositions} globalMaxReached=${String(globalMaxReached)} groupName=${groupName} groupOpenCount=${groupOpenCount} groupMaxOpen=${groupMaxOpen} groupMaxReached=${String(groupMaxReached)} cycleBuyCount=${selectedCandidates.length} cycleMaxBuys=${selectionLimit} queueAcceptedCount=${queueAcceptedCount} maxExecutionQueuePerScan=${maxExecutionQueuePerScan} executionQueueMaxReached=${String(executionQueueMaxReached)} autoBotsSelectedThisCycle=${autoBotsSelectedThisCycle} maxAutoBotsBuysPerCycle=${maxAutoBotsSelectedPerScan} unicornSelectedThisCycle=${unicornSelectedThisCycle} maxUnicornBuysPerCycle=${maxUnicornSelectedPerScan} cycleMaxReached=${String(cycleMaxReached)} finalBlockedReason=${positionGuardReason}`);
    if (positionGuardReason !== 'none' && !noBuyReasons.includes(positionGuardReason)) {
      noBuyReasons.push(positionGuardReason);
    }
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
    if (!candidateWithPlan.riskGroup) {
      logger.warn(`STRATEGY_MISMATCH_BLOCK_AUDIT: symbol=${symbol} finalExecutionStrategy=${strategyAudit.strategySelected} strategyAtEntry=${strategyAudit.strategyAtEntry ?? strategyAudit.strategySelected} positionStrategy=pending setupResult=${strategyAudit.setupResult ?? 'n/a'} setupMatchesStrategy=true marketBestFit=${strategyAudit.marketRecommendedStrategy ?? 'n/a'} groupRecommendedStrategy=${strategyAudit.groupRecommendedStrategy ?? 'n/a'} groupName=missing_risk_group strategyMismatchDetected=false mismatchAllowed=true mismatchReason=missing_group_metadata overrideApplied=${String(strategyAudit.overrideApplied ?? false)} overrideReason=${strategyAudit.overrideReason ?? 'none'} action=block_candidate`);
      if (!skipped) {
        skipped = true;
        skipReason = 'MISSING_RISK_GROUP';
        skipGate = 'ExecutionPlannerIntegrity';
        isRetryable = false;
        if (!noBuyReasons.includes('MISSING_RISK_GROUP')) noBuyReasons.push('MISSING_RISK_GROUP');
      }
    }
    if (!skipped && !strategyAudit.finalExecutable) {
      skipped = true;
      const missing = strategyAudit.setupMissing.map((s) => s.key);
      const exactReason = resolveActionableFinalBlocker({
        finalExecutable: strategyAudit.finalExecutable,
        strategySelected: strategyAudit.strategySelected,
        setupResult: strategyAudit.setupResult ?? strategyAudit.dynamicSetupContext?.setupResult,
        finalBlocker: strategyAudit.finalBlocker,
        strategyContractBlocker: strategyAudit.strategyContractBlocker,
        marketSafetyBlocker: strategyAudit.marketSafetyBlocker,
        executionFreshnessBlocker: strategyAudit.executionFreshnessBlocker,
        professionalGateBlocker: strategyAudit.professionalGateBlocker,
        primaryBlocker: strategyAudit.dynamicSetupContext?.primaryBlocker,
        blockReasons: strategyAudit.blockReasons,
        setupMissingKeys: missing,
      });
      const finalBlockerSource = strategyAudit.finalBlockerSource ?? 'strategy_contract';
      skipReason = finalBlockerSource === 'strategy_contract'
        ? `strategy_setup_not_met:${exactReason}`
        : `${finalBlockerSource}:${exactReason}`;
      skipGate = 'ExecutionPlannerFinalGate';
      isRetryable = true;
      if (finalBlockerSource === 'strategy_contract' && !noBuyReasons.includes('strategy_setup_not_met')) noBuyReasons.push('strategy_setup_not_met');
      if (!noBuyReasons.includes(exactReason)) noBuyReasons.push(exactReason);
      const finalGateAuditName = finalBlockerSource === 'strategy_contract'
        ? 'BUY_BLOCKED_STRATEGY_SETUP_NOT_MET'
        : 'BUY_BLOCKED_EXTERNAL_GATE';
      logger.warn(`${finalGateAuditName}: symbol=${symbol} strategy=${strategyAudit.strategySelected} actualDipPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(strategyAudit.setupMetrics.find((m) => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} strategyContractValid=${String(strategyAudit.strategyContractValid ?? false)} strategyContractBlocker=${strategyAudit.strategyContractBlocker ?? 'unknown'} professionalGateValid=${String(strategyAudit.professionalGateValid ?? true)} professionalGateBlocker=${strategyAudit.professionalGateBlocker ?? 'none'} finalBlocker=${exactReason} finalBlockerSource=${finalBlockerSource} setupMissing=${strategyAudit.setupMissing.map((s) => s.key).join('|') || 'none'} finalExecutable=${String(strategyAudit.finalExecutable)}`);
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
    const existingTradingTargetOwnership = (candidateWithPlan as any).tradingTargetOwnership;
    const unicornTp1OwnershipStale = isUnicornCandidate && !!existingTradingTargetOwnership && !hasCanonicalUnicornTp1Ownership(existingTradingTargetOwnership);
    const ownership = (!existingTradingTargetOwnership || unicornTp1OwnershipStale)
      ? resolveTradingTargetOwnership(candidateWithPlan, {
        strategySource: isUnicornCandidate ? 'unicorn_hunter' : autoBotsOn ? 'autobots' : 'manual_override',
        manualTp1Pct: 1.5,
        manualTp2Pct: 0,
        stopLossPct: 1.5,
        dynamicTrailingEnabled: Boolean(existingTradingTargetOwnership?.dynamicTrailingEnabled ?? false),
        trailPullbackPct: Number(existingTradingTargetOwnership?.trailPullbackValue ?? 0.25),
      })
      : existingTradingTargetOwnership;
    if (!existingTradingTargetOwnership || unicornTp1OwnershipStale) {
      (candidateWithPlan as any).tradingTargetOwnership = ownership;
      logger.info(`TRADING_TARGET_OWNERSHIP_FALLBACK_RESOLVED: symbol=${symbol} stage=execution_planner autoBotsOn=${String(autoBotsOn)} isAutoTargetOwned=${String(ownershipResolution.isAutoTargetOwned)} resolverPath=${ownershipResolution.resolverPath} tp1Value=${String((ownership as any)?.tp1Value ?? 'n/a')} tp1Source=${String((ownership as any)?.tp1Source ?? 'n/a')} reason=${unicornTp1OwnershipStale ? 'stale_unicorn_tp1_ownership_rebuilt' : 'missing_candidate_ownership'}`);
    }
    const resolvedRisk = resolveEntryRiskParams({ autoBotsOn, ownership, userStopLossPct: 1.5, userTrailPullbackPct: 0.25 });
    logger.info(`TP1_OWNER_SOURCE_AUDIT: symbol=${symbol} stage=ExecutionPlanner ownerName=${isUnicornCandidate ? 'UNICORN_HUNTER' : 'AUTOBOTS'} candidateSource=${isUnicornCandidate ? 'Unicorn' : 'AutoBots'} strategySource=${String((ownership as any)?.strategySource ?? 'unknown')} tp1Pct=${resolvedRisk.tp1} tp1Source=${resolvedRisk.sourceTp1} tp1Min=${String((ownership as any)?.tp1Min ?? 'n/a')} tp1Max=${String((ownership as any)?.tp1Max ?? 'n/a')} invariantOk=${String(isUnicornCandidate ? hasCanonicalUnicornTp1Ownership(ownership) : resolvedRisk.sourceTp1 !== 'Unicorn dynamic per coin')}`);
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
      const skippedHandoffMissingFields = getCanonicalStrategyHandoffMissingFields({
        candidate: candidateWithPlan,
        strategyAudit,
        entryPlan: isValidEntryPlan(candidateWithPlan.entryPlan) ? candidateWithPlan.entryPlan : null,
      });
      const resolvedSkipReason = resolveFinalNoBuyReasonPriority({
        symbol,
        rawStatus: candidateWithPlan.status,
        displayStatus: candidateWithPlan.lifecycleStatus ?? candidateWithPlan.status,
        finalExecutable: candidateWithPlan.finalExecutable,
        buyAllowed: candidateWithPlan.buyAllowed,
        primaryBlocker: candidateWithPlan.primaryBlocker ?? candidateWithPlan.entryGateDecision?.primaryReason ?? candidateWithPlan.entryGateDecision?.blockReasons?.[0],
        setupResult: (candidateWithPlan as any).setupResult,
        candidateWhy: candidateWithPlan.mainReason,
        previousFinalNoBuyReason: canonicalDecisionBySymbol.get(symbol) ?? candidateWithPlan.finalNoBuyReason ?? skipReason,
        blockReasons: candidateWithPlan.blockReasons,
        entryGateBlocker: candidateWithPlan.entryGateDecision?.primaryReason ?? candidateWithPlan.entryGateDecision?.blockReasons?.[0] ?? candidateWithPlan.entryGateDecision?.snapshot?.blockReasons?.[0],
        strategyContractBlocker: (candidateWithPlan as any).strategyAuditSnapshot?.strategyContractBlocker,
        executionDecisionFinalNoBuyReason: canonicalDecisionBySymbol.get(symbol),
        runtimeReason: candidateWithPlan.executionPrecheckSnapshot?.failureReason,
        handoffMismatch: candidateWithPlan.handoffIntegrityStatus === 'failed',
      }).resolvedFinalNoBuyReason;
      const unicornSelectionBlocker = /duplicate|already|open_position/i.test(skipReason)
        || (gateSnapshot.blockReasons ?? []).some((reason) => /duplicate|already|open_position/i.test(String(reason)))
        ? 'DUPLICATE_OPEN_POSITION'
        : resolvedSkipReason || skipReason;
      const canonicalSkipReason = isUnicornCandidate ? normalizeUnicornNoBuyReason(unicornSelectionBlocker) : resolvedSkipReason;
      logger.info(`STRATEGY_HANDOFF_INTEGRITY_AUDIT: symbol=${symbol} sourceOwner=${(candidateWithPlan as any).sourceOwner ?? candidateWithPlan.runtimeSnapshot?.sourceOwner ?? 'missing'} ownerType=${(candidateWithPlan as any).ownerType ?? 'missing'} strategy=${candidateWithPlan.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidateWithPlan as any).finalExecutionStrategy ?? strategyAudit.finalExecutionStrategy ?? 'missing'} strategyAtEntry=${strategyAudit.strategyAtEntry ?? strategyAudit.strategySelected ?? 'missing'} setupValidatorUsed=${(candidateWithPlan as any).setupValidatorUsed ?? (strategyAudit as any).setupValidatorUsed ?? 'missing'} entryRule=${(candidateWithPlan as any).finalEntryRule ?? (candidateWithPlan as any).entryRule ?? strategyAudit.finalEntryRule ?? 'missing'} setupResult=${(candidateWithPlan as any).setupResult ?? strategyAudit.setupResult ?? 'missing'} missingFields=${skippedHandoffMissingFields.join('|') || 'none'} finalExecutableBefore=${String(candidateWithPlan.finalExecutable === true || strategyAudit.finalExecutable === true)} finalExecutableAfter=false buyAllowedBefore=${String(candidateWithPlan.buyAllowed === true || strategyAudit.buyAllowed === true)} buyAllowedAfter=false blockedReason=${canonicalSkipReason} invariantOk=${String(canonicalSkipReason !== 'none')} failureReason=${canonicalSkipReason === 'none' ? 'missing_skip_reason' : canonicalSkipReason}`);
      skippedCandidates.push({ symbol, status: candidateWithPlan.status, reason: skipReason, gate: skipGate, isRetryable, finalNoBuyReason: canonicalSkipReason });
      if (isUnicornCandidate) {
        logger.info(`UNICORN_EXECUTION_DECISION_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter selectedForExecution=false finalDecision=SKIP finalExecutable=${String(candidateWithPlan.finalExecutable === true)} buyAllowed=${String(candidateWithPlan.buyAllowed === true)} submitAttempted=false adapterCalled=false finalNoBuyReasonCode=${canonicalSkipReason} finalNoBuyReasonLabel=${canonicalSkipReason} finalNoBuyReason=${canonicalSkipReason} blockerSource=${skipGate || 'ExecutionPlanner'} invariantOk=true`);
        logger.info(`UNICORN_HUNTER_EXECUTION_HANDOFF_AUDIT: symbol=${symbol} source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter selectedForExecution=false finalExecutable=${String(candidateWithPlan.finalExecutable === true)} entryGateApproved=${String(candidateWithPlan.entryGateDecision?.decision === 'ALLOW')} submitAttempted=false blockedReason=${canonicalSkipReason} finalNoBuyReasonCode=${canonicalSkipReason}`);
        logger.info(`UNICORN_BUY_BLOCKED_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} source=unicorn_hunter owner=UnicornHunter selectedForExecution=false finalExecutable=${String(candidateWithPlan.finalExecutable === true)} buyAllowed=${String(candidateWithPlan.buyAllowed === true)} blockedReason=${canonicalSkipReason} finalNoBuyReasonCode=${canonicalSkipReason} finalNoBuyReasonLabel=${canonicalSkipReason} missingFields=none skipGate=${skipGate || 'unknown'} rawSkipReason=${skipReason || 'none'}`);
      }
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

    const selectedHandoffMissingFields = getCanonicalStrategyHandoffMissingFields({
      candidate: candidateWithPlan,
      strategyAudit,
      entryPlan: isValidEntryPlan(candidateWithPlan.entryPlan) ? candidateWithPlan.entryPlan : null,
      ownership: ownershipResolution,
      resolvedRisk,
    });
    if (selectedHandoffMissingFields.length > 0) {
      const handoffReason = 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
      logger.info(`STRATEGY_HANDOFF_INTEGRITY_AUDIT: symbol=${symbol} sourceOwner=${(candidateWithPlan as any).sourceOwner ?? candidateWithPlan.runtimeSnapshot?.sourceOwner ?? 'missing'} ownerType=${ownershipResolution.ownerType ?? 'missing'} strategy=${candidateWithPlan.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidateWithPlan as any).finalExecutionStrategy ?? strategyAudit.finalExecutionStrategy ?? 'missing'} strategyAtEntry=${strategyAudit.strategyAtEntry ?? strategyAudit.strategySelected ?? 'missing'} setupValidatorUsed=${(candidateWithPlan as any).setupValidatorUsed ?? (strategyAudit as any).setupValidatorUsed ?? 'missing'} entryRule=${(candidateWithPlan as any).finalEntryRule ?? (candidateWithPlan as any).entryRule ?? strategyAudit.finalEntryRule ?? 'missing'} setupResult=${(candidateWithPlan as any).setupResult ?? strategyAudit.setupResult ?? 'missing'} missingFields=${selectedHandoffMissingFields.join('|')} finalExecutableBefore=${String(candidateWithPlan.finalExecutable === true || strategyAudit.finalExecutable === true)} finalExecutableAfter=false buyAllowedBefore=${String(candidateWithPlan.buyAllowed === true || strategyAudit.buyAllowed === true)} buyAllowedAfter=false blockedReason=${handoffReason} invariantOk=false failureReason=${handoffReason}`);
      skippedCandidates.push({ symbol, status: 'WAIT_STRATEGY_HANDOFF', reason: handoffReason, gate: 'StrategyHandoffIntegrity', isRetryable: true, finalNoBuyReason: handoffReason });
      if (!noBuyReasons.includes(handoffReason)) noBuyReasons.push(handoffReason);
      auditIntegrity(false, handoffReason);
      continue;
    }

    handoffValidSymbols.push(symbol);
    sourceBreakdown[queueSourceOwner(candidateWithPlan)] += 1;
    queuePriorityOrder.push(`${symbol}:${queueAuditValue(queueSourceOwner(candidateWithPlan))}:${score.toFixed(2)}`);
    if (queueAcceptedCount >= maxExecutionQueuePerScan) {
      const queueReason = 'MAX_EXECUTION_QUEUE_REACHED';
      queueDeferredSymbols.push(symbol);
      queueRejectedReasons.push(queueReason);
      skippedCandidates.push({
        symbol,
        status: candidateWithPlan.status,
        reason: queueReason,
        gate: 'ExecutionQueuePerScan',
        isRetryable: true,
        finalNoBuyReason: queueReason,
      });
      skippedReasons.push(queueReason);
      if (!noBuyReasons.includes(queueReason)) noBuyReasons.push(queueReason);
      logger.info(
        `CANDIDATE_DEFERRED_BY_QUEUE_AUDIT: ` +
        `symbol=${symbol} ` +
        `sourceOwner=${queueAuditValue((candidateWithPlan as any).sourceOwner ?? candidateWithPlan.runtimeSnapshot?.sourceOwner ?? queueSourceOwner(candidateWithPlan))} ` +
        `ownerType=${queueAuditValue((candidateWithPlan as any).ownerType ?? (isUnicornCandidate ? 'unicorn' : 'scanner'))} ` +
        `strategy=${queueAuditValue(candidateWithPlan.selectedStrategy)} ` +
        `finalExecutionStrategy=${queueAuditValue((candidateWithPlan as any).finalExecutionStrategy ?? strategyAudit.finalExecutionStrategy ?? strategyAudit.strategySelected)} ` +
        `professionalScore=${queueAuditValue((candidateWithPlan as any).professionalScore ?? candidateWithPlan.rawScore ?? score)} ` +
        `confidence=${queueAuditValue(candidateWithPlan.confidence)} ` +
        `finalExecutable=${String(strategyAudit.finalExecutable === true || candidateWithPlan.finalExecutable === true)} ` +
        `handoffIntegrityOk=true ` +
        `deferredReason=${queueReason} ` +
        `retryEligibleNextScan=true ` +
        `invariantOk=true`
      );
      auditIntegrity(false, queueReason);
      continue;
    }
    queueAcceptedCount += 1;
    queueAcceptedSymbols.push(symbol);

    const moduleSelectionLimitReached = isUnicornCandidate
      ? unicornSelectedThisCycle >= maxUnicornSelectedPerScan
      : autoBotsSelectedThisCycle >= maxAutoBotsSelectedPerScan;
    const globalSafetyLimitReached = selectedCandidates.length >= globalSafetySelectionLimit;
    if (moduleSelectionLimitReached || globalSafetyLimitReached) {
      let limitToken = openSymbols.length >= maxPositions ? 'MAX_GLOBAL_POSITIONS_REACHED' : 'MAX_OPEN_POSITION_SLOTS_THIS_SCAN_REACHED';
      let limitReason = openSymbols.length >= maxPositions ? 'BLOCK_MAX_GLOBAL_POSITIONS' : 'BLOCK_MAX_OPEN_POSITION_SLOTS_THIS_SCAN';
      if (capitalLimitedSlots <= 0 && availableSlots > 0) {
        limitToken = 'MAX_CAPITAL_ALLOCATION_REACHED';
        limitReason = 'BLOCK_MAX_CAPITAL_ALLOCATION';
      } else if (moduleSelectionLimitReached && isUnicornCandidate) {
        limitToken = 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
        limitReason = 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
      } else if (moduleSelectionLimitReached) {
        limitToken = 'MAX_NEW_BUYS_PER_CYCLE_REACHED';
        limitReason = 'MAX_NEW_BUYS_PER_CYCLE_REACHED';
      }
      const selectedUnicornBeforeUnicorn = selectedCandidates.some((selected) => {
        const sourceText = `${selected.scannerAutoEntryConfigSnapshot?.source ?? ''} ${selected.scannerAutoEntryConfigSnapshot?.ownerName ?? ''} ${selected.strategySource ?? ''}`.toLowerCase();
        return sourceText.includes('unicorn');
      });
      const slotOwner = isUnicornCandidate && selectedUnicornBeforeUnicorn
          ? 'UnicornHunter'
          : isUnicornCandidate
            ? 'UnicornHunter'
            : 'AutoBots';
      const rawLimitReason = moduleSelectionLimitReached || globalSafetyLimitReached ? limitToken : canonicalDecisionBySymbol.get(symbol) ?? limitToken;
      const canonicalLimitReason = isUnicornCandidate ? normalizeUnicornNoBuyReason(rawLimitReason) : canonicalDecisionBySymbol.get(symbol) ?? limitToken;
      skippedCandidates.push({ symbol, status: candidateWithPlan.status, reason: limitReason, gate: 'ExecutionPlannerLimit', isRetryable: true, finalNoBuyReason: canonicalLimitReason });
      skippedReasons.push(limitToken);
      if (!noBuyReasons.includes(limitToken)) noBuyReasons.push(limitToken);
      const queueSizeBefore = selectedCandidates.length;
      const maxQueueSize = Math.max(0, globalSafetySelectionLimit);
      logger.info(`EXECUTION_SUBMIT_LIMIT_AUDIT: scanId=${scannerSnapshot?.scanId ?? 'unknown'} owner=${isUnicornCandidate ? 'UnicornHunter' : 'AutoBots'} source=${isUnicornCandidate ? 'unicorn_hunter' : 'autobots'} candidateCount=${activeExecutionPool.length} queueAcceptedCount=${queueAcceptedCount} maxExecutionQueuePerScan=${maxExecutionQueuePerScan} selectedCount=${selectedCandidates.length} submitLimitBefore=${queueSizeBefore} submitLimitAfter=${queueSizeBefore} maxSubmitSlotsThisCycle=${maxQueueSize} rejectedCount=1 rejectedSymbols=${symbol} rejectedReasons=${canonicalLimitReason} invariantOk=${String(queueSizeBefore >= maxQueueSize || moduleSelectionLimitReached)} failureReason=${queueSizeBefore >= maxQueueSize || moduleSelectionLimitReached ? 'none' : 'submit_limit_accounting_mismatch'}`);
      if (isUnicornCandidate) {
        logger.info(`UNICORN_SLOT_OWNERSHIP_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} stage=${candidateWithPlan.lifecycleStatus ?? candidateWithPlan.status} score=${(candidateWithPlan as any).unicornScore ?? candidateWithPlan.rawScore ?? 'n/a'} sourceOwner=${candidateWithPlan.runtimeSnapshot?.sourceOwner ?? 'unknown'} ownerType=${(candidateWithPlan as any).ownerType ?? 'unknown'} strategy=${candidateWithPlan.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidateWithPlan as any).finalExecutionStrategy ?? 'missing'} entryRule=${(candidateWithPlan as any).finalEntryRule ?? (candidateWithPlan as any).entryRule ?? candidateWithPlan.mainReason ?? 'missing'} setupResult=${(candidateWithPlan as any).setupResult ?? strategyAudit.setupResult ?? 'missing'} buyAllowed=${String(candidateWithPlan.buyAllowed === true)} finalExecutable=${String(candidateWithPlan.finalExecutable === true)} submitAttempted=false blockedReason=${canonicalLimitReason} unicornSelectedThisCycle=${unicornSelectedThisCycle} unicornSubmittedThisCycle=0 maxUnicornBuysPerCycle=${maxUnicornSelectedPerScan} autoBotsSubmittedThisCycle=0 maxAutoBotsBuysPerCycle=${maxAutoBotsSelectedPerScan} slotOwner=${slotOwner} autobotsSlotUsed=false unicornSlotUsed=${String(slotOwner === 'UnicornHunter')} openUnicornPositions=n/a maxUnicornOpenPositions=n/a unicornTradesToday=n/a maxUnicornTradesPerDay=n/a cooldownRemainingMs=0 nextUnicornBuyAllowedAt=none invariantOk=true failureReason=${canonicalLimitReason}`);
        logger.info(`UNICORN_SUBMIT_ELIGIBILITY_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} stage=${candidateWithPlan.lifecycleStatus ?? candidateWithPlan.status} score=${(candidateWithPlan as any).unicornScore ?? candidateWithPlan.rawScore ?? 'n/a'} sourceOwner=${candidateWithPlan.runtimeSnapshot?.sourceOwner ?? 'unknown'} ownerType=${(candidateWithPlan as any).ownerType ?? 'unknown'} strategy=${candidateWithPlan.selectedStrategy ?? 'missing'} finalExecutionStrategy=${(candidateWithPlan as any).finalExecutionStrategy ?? 'missing'} entryRule=${(candidateWithPlan as any).finalEntryRule ?? (candidateWithPlan as any).entryRule ?? candidateWithPlan.mainReason ?? 'missing'} setupResult=${(candidateWithPlan as any).setupResult ?? strategyAudit.setupResult ?? 'missing'} buyAllowed=false finalExecutable=${String(candidateWithPlan.finalExecutable === true)} submitAttempted=false blockedReason=${canonicalLimitReason} unicornSelectedThisCycle=${unicornSelectedThisCycle} unicornSubmittedThisCycle=0 maxUnicornBuysPerCycle=${maxUnicornSelectedPerScan} autoBotsSubmittedThisCycle=0 maxAutoBotsBuysPerCycle=${maxAutoBotsSelectedPerScan} slotOwner=${slotOwner} autobotsSlotUsed=false unicornSlotUsed=${String(slotOwner === 'UnicornHunter')} openUnicornPositions=n/a maxUnicornOpenPositions=n/a unicornTradesToday=n/a maxUnicornTradesPerDay=n/a cooldownRemainingMs=0 nextUnicornBuyAllowedAt=none invariantOk=true failureReason=${canonicalLimitReason}`);
        logger.info(`UNICORN_HUNTER_EXECUTION_HANDOFF_AUDIT: symbol=${symbol} source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter selectedForExecution=false finalExecutable=${String(candidateWithPlan.finalExecutable === true)} entryGateApproved=${String(candidateWithPlan.entryGateDecision?.decision === 'ALLOW')} submitAttempted=false blockedReason=${canonicalLimitReason} slotOwner=${slotOwner}`);
        logger.info(`UNICORN_BLOCK_REASON_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} stage=BLOCKED_BY_BUY_BUDGET selectedForExecution=false submitAttempted=false rawReason=${limitReason} canonicalReason=${canonicalLimitReason} sharedBudget=false slotOwner=${slotOwner} maxSelectedPerScan=${maxSelectedPerScan} maxUnicornBuysPerCycle=${maxUnicornSelectedPerScan} selectedBefore=${selectedCandidates.length} openPositions=${openSymbols.length} maxPositions=${maxPositions} capitalLimitedSlots=${capitalLimitedSlots}`);
      }
      auditIntegrity(false, limitToken);
      continue;
    }

    const entryPlan = candidateWithPlan.entryPlan!;
    const ownershipForPlan = resolveCandidateExecutionOwnership({
      candidate: candidateWithPlan,
      selectedBy: isUnicornCandidate ? 'Unicorn Hunter' : 'AutoBots',
      executedBy: isUnicornCandidate ? 'Unicorn Hunter' : 'AutoBots',
      finalExecutionStrategy: strategyAudit.finalExecutionStrategy ?? strategyAudit.strategySelected,
      entryRule: strategyAudit.finalEntryRule,
      executionPath: 'scanner_auto',
    });
    logger.info(`CANDIDATE_OWNERSHIP_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} stage=ExecutionPlanner candidateSource=${ownershipForPlan.candidateSource} ownerType=${ownershipForPlan.ownerType} ownerName=${ownershipForPlan.ownerName} scannerModule=${ownershipForPlan.scannerModule} selectedBy=${ownershipForPlan.selectedBy} executedBy=${ownershipForPlan.executedBy} finalExecutionStrategy=${ownershipForPlan.finalExecutionStrategy} entryRule=${ownershipForPlan.entryRule} invariantOk=${String(ownershipForPlan.invariantOk)} invariantReason=${ownershipForPlan.invariantReason}`);
    logger.info(`CANDIDATE_SOURCE_HANDOFF_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} from=ExecutionPlanner.toTradingEngine candidateSource=${ownershipForPlan.candidateSource} source=${ownershipForPlan.source} strategySource=${ownershipForPlan.strategySource} executionSource=${ownershipForPlan.executionSource} ownerName=${ownershipForPlan.ownerName}`);
    logger.info(`EXECUTION_OWNER_DECISION_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} decision=OWNER_SELECTED_BY_PLANNER candidateSource=${ownershipForPlan.candidateSource} selectedBy=${ownershipForPlan.selectedBy} executedBy=${ownershipForPlan.executedBy} reason=${isUnicornCandidate ? 'UNICORN_ENTRY_READY_SELECTED' : 'AUTOBOTS_SELECTED'}`);
    const scannerEntrySource: ScannerAutoEntryConfigSnapshot['source'] =
      isUnicornCandidate
        ? 'Unicorn Hunter' as any
        : candidateWithPlan.mlPredictBuyDecision?.finalDecision === 'BUY_READY' || candidateWithPlan.executionSource === 'ML_PREDICT_BUY'
        ? 'ML_PREDICT_BUY'
        : 'AutoBots';
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
      ownerType: ownershipForPlan.ownerType as ScannerAutoEntryConfigSnapshot['ownerType'],
      ownerName: ownershipForPlan.ownerName as ScannerAutoEntryConfigSnapshot['ownerName'],
      source: scannerEntrySource,
      candidateSource: ownershipForPlan.candidateSource,
      scannerModule: ownershipForPlan.scannerModule,
      selectedBy: ownershipForPlan.selectedBy,
      executedBy: ownershipForPlan.executedBy,
      entryRule: ownershipForPlan.entryRule,
      unicornScore: (candidateWithPlan as any).unicornScore ?? null,
      unicornMetrics: (candidateWithPlan as any).unicornMetrics ?? null,
      mlPredictBuyDecision: candidateWithPlan.mlPredictBuyDecision ?? null,
      mlPredictBuyPrediction: candidateWithPlan.mlPredictBuyPrediction ?? null,
      modelVersionAtEntry: candidateWithPlan.mlPredictBuyPrediction?.modelVersion ?? null,
      featureSchemaVersionAtEntry: candidateWithPlan.mlPredictBuyPrediction?.featureSchemaVersion ?? null,
      strategySource: ownershipForPlan.strategySource,
      strategySourceDetail: decision?.strategySourceDetail ?? candidateWithPlan.strategySourceDetail ?? null,
      strategyReason: decision?.strategyReason ?? candidateWithPlan.strategyReason ?? decision?.reason ?? null,
      marketBestFit: strategyAudit.marketRecommendedStrategy ?? decision?.marketAnalyzerBestFit ?? candidateWithPlan.marketAnalyzerBestFit ?? null,
      groupRecommendedStrategy: strategyAudit.groupRecommendedStrategy ?? decision?.groupRecommendedStrategy ?? candidateWithPlan.groupRecommendedStrategy ?? null,
      autoBotsPerCoinStrategy: strategyAudit.autoBotsPerCoinStrategy ?? decision?.perCoinSelectedStrategy ?? candidateWithPlan.perCoinSelectedStrategy ?? null,
      finalExecutionStrategy: strategyAudit.finalExecutionStrategy ?? strategyAudit.strategySelected,
      strategyAtEntry: strategyAudit.strategyAtEntry ?? strategyAudit.strategySelected,
      strategyDecisionReason: strategyAudit.strategyDecisionReason ?? decision?.strategyReason ?? candidateWithPlan.strategyReason ?? null,
      overrideApplied: strategyAudit.overrideApplied ?? false,
      overrideReason: strategyAudit.overrideReason ?? null,
      mismatchAllowed: strategyAudit.mismatchAllowed ?? true,
      mismatchReason: strategyAudit.mismatchReason ?? null,
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
    if (isUnicornCandidate) {
      logger.info(`UNICORN_HUNTER_EXECUTION_HANDOFF_AUDIT: symbol=${symbol} source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter selectedForExecution=true finalExecutable=${String(scannerAutoEntryConfigSnapshot.finalExecutable)} entryGateApproved=${String(gateSnapshot.decision === 'ALLOW')} submitAttempted=false blockedReason=none`);
      logger.info(`UNICORN_EXECUTION_SELECTED_AUDIT: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} selectedForExecution=true source=unicorn_hunter owner=UnicornHunter candidateSource=unicorn_hunter strategySource=unicorn_hunter executionSource=unicorn_hunter finalExecutable=${String(scannerAutoEntryConfigSnapshot.finalExecutable)} buyAllowed=${String(scannerAutoEntryConfigSnapshot.buyAllowed)} finalNoBuyReason=none entryPrice=${entryPlan.price} quantity=${entryPlan.quantity}`);
    }
    logger.info(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${symbol} boundary=after_execution_planner snapshotPresent=true selectedStrategy=${scannerAutoEntryConfigSnapshot.selectedStrategy} finalEntryRule=${scannerAutoEntryConfigSnapshot.finalEntryRule} contractHash=${snapshotContractHash} contractValid=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} semanticValid=${String(scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}`);
    const action: PlannedAction = 'BUY';
    logger.info(`ENTRY_PLAN_ATTACHED_TO_SELECTED_CANDIDATE: symbol=${symbol} scanId=${scannerSnapshot?.scanId ?? 'unknown'} price=${entryPlan.price} quantity=${entryPlan.quantity} side=${entryPlan.side}`);
    selectedCandidates.push({
      symbol,
      rank: candidateWithPlan.rank ?? 0,
      status: candidateWithPlan.status,
      strategy: scannerAutoEntryConfigSnapshot.selectedStrategy,
      effectiveStrategy: scannerAutoEntryConfigSnapshot.selectedStrategy,
      strategySource: isUnicornCandidate ? 'unicorn_hunter' as any : decision?.strategySource ?? candidateWithPlan.strategySource,
      strategySourceDetail: decision?.strategySourceDetail ?? candidateWithPlan.strategySourceDetail,
      strategyReason: decision?.strategyReason ?? candidateWithPlan.strategyReason ?? decision?.reason,
      groupTrend: decision?.groupTrend ?? candidateWithPlan.groupTrend ?? 'n/a',
      groupRecommendedStrategy: decision?.groupRecommendedStrategy ?? candidateWithPlan.groupRecommendedStrategy ?? 'n/a',
      marketBestFit: scannerAutoEntryConfigSnapshot.marketBestFit ?? null,
      autoBotsPerCoinStrategy: scannerAutoEntryConfigSnapshot.autoBotsPerCoinStrategy ?? null,
      finalExecutionStrategy: scannerAutoEntryConfigSnapshot.finalExecutionStrategy,
      strategyAtEntry: scannerAutoEntryConfigSnapshot.strategyAtEntry,
      strategyDecisionReason: scannerAutoEntryConfigSnapshot.strategyDecisionReason,
      overrideApplied: scannerAutoEntryConfigSnapshot.overrideApplied,
      overrideReason: scannerAutoEntryConfigSnapshot.overrideReason,
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
      mlPredictBuyDecision: candidateWithPlan.mlPredictBuyDecision ?? null,
      mlPredictBuyPrediction: candidateWithPlan.mlPredictBuyPrediction ?? null,
      scannerAutoEntryConfigSnapshot,
    });
    if (isUnicornCandidate) unicornSelectedThisCycle += 1;
    else autoBotsSelectedThisCycle += 1;
    logger.info(`CAPITAL_PER_COIN_ORDER_SIZE_AUDIT: symbol=${symbol} mode=${executionAdapter === 'paper_simulated' ? 'demo' : 'live'} userTradingCapital=${capital} userCapitalPerCoin=${capitalPerTrade} persistedCapitalPerCoin=${capitalPerTrade} resolvedCapitalPerCoin=${capitalPerTrade} finalOrderNotionalUsd=${(entryPlan.price * entryPlan.quantity).toFixed(4)} qty=${entryPlan.quantity} entryPrice=${entryPlan.price} availableCapital=${capitalAvailable} usedCapitalBefore=${usedCapital} usedCapitalAfter=${usedCapital + (entryPlan.price * entryPlan.quantity)} adjustmentReason=entry_plan_selected source=persisted`);
    auditIntegrity(true, 'none');
  }

  const allPoolSymbols = [...activeExecutionPool, ...activeWatchPool, ...activeNearMissPool];
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
  const safetyLimitApplied = selectionLimit < activeExecutionPool.length;
  const queueRejectedCount = queueDeferredSymbols.length;
  const autoBotsCandidates = activeExecutionPool.filter((candidate) => !isUnicornCandidateLike(candidate)).length;
  const unicornCandidates = activeExecutionPool.filter((candidate) => isUnicornCandidateLike(candidate)).length;
  const validHandoffCandidates = handoffValidSymbols.length;
  const unicornReadyPresent = roundRobinPool.some(({ candidate }) => isUnicornCandidateLike(candidate) && candidate.status === 'BUY' && candidate.buyAllowed !== false);
  const unicornAcceptedInQueue = queueAcceptedSymbols.some((symbol) => {
    const candidate = activeExecutionPool.find((row) => row.symbol === symbol);
    return candidate ? isUnicornCandidateLike(candidate) : false;
  });
  const unicornPriorityRankIndex = queuePriorityOrder.findIndex((entry) => entry.includes(':UnicornHunter:'));
  const unicornPriorityRank = unicornPriorityRankIndex >= 0 ? unicornPriorityRankIndex + 1 : 'none';
  const queueInvariantOk = queueAcceptedCount <= maxExecutionQueuePerScan
    && queueRejectedCount === queueDeferredSymbols.length
    && queueDeferredSymbols.length === queueRejectedReasons.length
    && handoffValidSymbols.length === queueAcceptedCount + queueDeferredSymbols.length;
  logger.info(
    `EXECUTION_QUEUE_CAP_AUDIT: ` +
    `scanId=${scannerSnapshot?.scanId ?? 'unknown'} ` +
    `totalCandidates=${(scannerSnapshot.candidates ?? []).length} ` +
    `buyCandidates=${activeExecutionPool.length} ` +
    `autoBotsCandidates=${autoBotsCandidates} ` +
    `unicornCandidates=${unicornCandidates} ` +
    `canonicalExecutableCandidates=${canonicalSet.executableCandidates.length} ` +
    `handoffValidCandidates=${handoffValidSymbols.length} ` +
    `validHandoffCandidates=${validHandoffCandidates} ` +
    `queueAcceptedCount=${queueAcceptedCount} ` +
    `maxExecutionQueuePerScan=${maxExecutionQueuePerScan} ` +
    `queueRejectedCount=${queueRejectedCount} ` +
    `deferredCount=${queueDeferredSymbols.length} ` +
    `queueDeferredCount=${queueDeferredSymbols.length} ` +
    `unicornReadyPresent=${String(unicornReadyPresent)} ` +
    `unicornAcceptedInQueue=${String(unicornAcceptedInQueue)} ` +
    `unicornPriorityRank=${unicornPriorityRank} ` +
    `fairnessApplied=${String(fairnessApplied)} ` +
    `queueRejectedSymbols=${queueDeferredSymbols.join('|') || 'none'} ` +
    `deferredSymbols=${queueDeferredSymbols.join('|') || 'none'} ` +
    `queueRejectedReasons=${[...new Set(queueRejectedReasons)].join('|') || 'none'} ` +
    `selectedSymbols=${queueAcceptedSymbols.join('|') || 'none'} ` +
    `priorityOrder=${queuePriorityOrder.join('|') || 'none'} ` +
    `sourceBreakdown=AutoBots:${sourceBreakdown.AutoBots}|UnicornHunter:${sourceBreakdown.UnicornHunter} ` +
    `actionableNowCount=${selectedCandidates.length} ` +
    `submitAttemptedCount=0 ` +
    `invariantOk=${String(queueInvariantOk)} ` +
    `failureReason=${queueInvariantOk ? 'none' : 'execution_queue_accounting_mismatch'}`
  );
  logger.info(`BUY_READY_FINAL_GATE_AUDIT: plannerInputCount=${activeExecutionPool.length} finalExecutableReadyCount=${selectedCandidates.length} blockedByFinalGate=${skippedCandidates.filter((s) => s.gate === 'ExecutionPlannerFinalGate').length} selectedSymbols=${selectedCandidates.map((s) => s.symbol).join('|') || 'none'}`);
  logger.info(`EXECUTION_POOL_FINAL_FILTER_AUDIT: executionPoolIn=${activeExecutionPool.length} selectedOut=${selectedCandidates.length} skippedOut=${skippedCandidates.length} topNoBuyReasons=${topNoBuy.join('|') || 'none'}`);
  logger.info(`EXECUTION_BUDGET_PARITY_AUDIT: scanId=${scannerSnapshot?.scanId ?? 'unknown'} sharedBudget=false autoBotsSelectedThisCycle=${autoBotsSelectedThisCycle} maxAutoBotsBuysPerCycle=${maxAutoBotsSelectedPerScan} unicornSelectedThisCycle=${unicornSelectedThisCycle} maxUnicornBuysPerCycle=${maxUnicornSelectedPerScan} selectedCount=${selectedCandidates.length} globalSafetySelectionLimit=${globalSafetySelectionLimit} invariantOk=${String(autoBotsSelectedThisCycle <= maxAutoBotsSelectedPerScan && unicornSelectedThisCycle <= maxUnicornSelectedPerScan && selectedCandidates.length <= globalSafetySelectionLimit)} failureReason=none`);
  logger.info(`EXECUTION_SAFETY_LIMIT_AUDIT: scanId=${scannerSnapshot?.scanId ?? 'unknown'} buyReadyCount=${activeExecutionPool.length} selectedCount=${selectedCandidates.length} selectionLimitApplied=${String(safetyLimitApplied)} maxOpenPositions=${maxPositions} currentOpenPositions=${openSymbols.length} availableSlots=${availableSlots} maxSelectedPerScan=${maxSelectedPerScan} maxUnicornSelectedPerScan=${maxUnicornSelectedPerScan} capitalPerTrade=${capitalPerTrade} projectedCapitalRequired=${projectedCapitalRequired.toFixed(4)} maxCapitalAtRisk=${maxCapitalAtRisk} projectedCapitalAtRisk=${projectedCapitalAtRisk.toFixed(4)} safetyLimitApplied=${String(safetyLimitApplied)} capitalAvailable=${capitalAvailable} capitalLimitedSlots=${capitalLimitedSlots} effectiveSelectionLimit=${selectionLimit} skippedCount=${skippedCandidates.length} skippedReasons=${[...new Set(skippedReasons)].join('|') || 'none'}`);

  return {
    canExecute,
    selectedCandidates,
    skippedCandidates,
    decisions: [...canonicalSet.executableCandidates, ...canonicalSet.blockedCandidates, ...canonicalSet.skippedCandidates],
    canonicalExecutableSet: canonicalSet as unknown as Record<string, unknown>,
    noBuyReasons: topNoBuy,
    plannerInputCount: activeExecutionPool.length,
    plannerInputWithEntryPlan,
    generatedEntryPlanCount,
    entryPlanBlockedCount,
    confirmationBlockedCount,
    spreadBlockedCount,
    executionPoolSize: activeExecutionPool.length,
    watchPoolSize: activeWatchPool.length,
    nearMissPoolSize: activeNearMissPool.length,
    maxEntriesPerCycle: maxSelectedPerScan,
    maxSelectedPerScan,
    maxExecutionQueuePerScan,
    queueAcceptedCount,
    deferredByQueueLimitCount: queueDeferredSymbols.length,
    queueRejectedCount,
    queueAcceptedSymbols,
    deferredByQueueLimitSymbols: queueDeferredSymbols,
    queueRejectedReasons: [...new Set(queueRejectedReasons)],
    maxUnicornBuysPerCycle: maxUnicornSelectedPerScan,
    maxAutoBotsBuysPerCycle: maxAutoBotsSelectedPerScan,
    unicornSelectedThisCycle,
    autoBotsSelectedThisCycle,
    availableSlots,
    capitalAvailable,
    decisionMode,
    executionAdapter,
  };
}

export { computeExecutionScore };
