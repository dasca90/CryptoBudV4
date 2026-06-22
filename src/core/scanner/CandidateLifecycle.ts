import type { AutoBotsCanonicalState } from '../runtime/autobots-state';
import type { AutoBotsFinalStrategyResolution } from './AutoStrategyRouter';
import type { ScannerCandidate } from '../types';
import { logger } from '../../utils/logger';

export type CandidateLifecycleStatus =
  | 'BUY'
  | 'BUY_READY'
  | 'WAITING_CONFIRMATION'
  | 'WAIT_DIP_CONFIRMATION'
  | 'WAIT_REBOUND_FRESHNESS'
  | 'WAITING_MOMENTUM'
  | 'WAIT_SPREAD'
  | 'WAIT_TP_ROOM'
  | 'WAIT_PRICE_FRESHNESS'
  | 'WAIT_BOOK_FRESHNESS'
  | 'WAIT_STRATEGY_HANDOFF'
  | 'WAIT_STRATEGY_DECISION'
  | 'WAIT_RUNTIME_STATE'
  | 'WAIT_RISK_GROUP'
  | 'WAIT_ENTRY_CONTRACT'
  | 'WAIT_PROFESSIONAL_GATE'
  | 'INVALID_RUNTIME_STATE';

export type CandidateRuntimeSnapshot = {
  id: string;
  scanId: string;
  scannerCycleId: string;
  createdAt: string;
  autoBotsUiOn: boolean;
  autoBotsResolvedOn: boolean;
  scannerAutoEnabled: boolean;
  paperAutoExecutionEnabled: boolean;
  manualOverrideRequested: boolean;
  manualOverrideEnabled: boolean;
  dynamicPerCoinStrategy: boolean;
  strategySourceResolved: string;
  routerPath: string;
  runtimeStrategyDropdown: string | null;
  executionMode: string;
  buildMode: string;
  tauriMode: string;
  invariantOk: boolean;
  failureReason: string;
};

export type CandidateStrategyDecisionSnapshot = {
  scanId: string;
  symbol: string;
  riskGroup: string | null;
  runtimeSnapshotId: string | null;
  autoBotsResolvedOn: boolean;
  dynamicPerCoinStrategy: boolean;
  strategySourceResolved: string;
  marketBestFit: string | null;
  groupRecommendedStrategy: string | null;
  perCoinSelectedStrategy: string | null;
  userSelectedRuntimeStrategy: string | null;
  routerPath: string;
  fallbackType: string;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  finalExecutionStrategy: string;
  setupValidatorUsed: string;
  entryGateStrategyInput: string;
  tp1Strategy: string | 'pending';
  strategyAtEntryToPersist: string;
  invariantOk: boolean;
  failureReason: string;
};

export type CandidateExecutionPrecheckSnapshot = {
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  riskGroupResolved: boolean;
  marketSnapshotFresh: boolean;
  referencePriceFresh: boolean;
  candleDataFresh: boolean;
  professionalGateResolved: boolean;
  entryContractResolved: boolean;
  entryContractValid: boolean;
  capitalAvailable: boolean;
  duplicateChecked: boolean;
  pendingOrderChecked: boolean;
  invariantOk: boolean;
  failureReason: string;
};

export type CandidatePromotionAudit = {
  symbol: string;
  scanId: string;
  previousStatus: string;
  requestedNextStatus: string;
  finalStatus: CandidateLifecycleStatus;
  runtimeSnapshotPresent: boolean;
  strategyDecisionPresent: boolean;
  executionPrecheckSnapshotPresent: boolean;
  riskGroupPresent: boolean;
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  entryContractValid: boolean;
  strategyHandoffValid: boolean;
  professionalGateResolved: boolean;
  primaryBlocker: string;
  finalNoBuyReason: string;
  setupResult: string;
  finalExecutable: boolean;
  buyAllowed: boolean;
  selectedForExecution: boolean;
  canPromoteToBuy: boolean;
  blockedPromotionReason: string;
  invariantOk: boolean;
};

export type CandidateCanonicalDisplayStatus = {
  canonicalStatus: CandidateLifecycleStatus;
  rawStatus: ScannerCandidate['status'];
  displayStatus: string;
  signal: 'BUY' | 'WAIT';
  primaryBlocker: string;
  finalNoBuyReason: string;
  setupResult: string;
  finalExecutable: boolean;
  buyAllowed: boolean;
  canPromoteToBuy: boolean;
  blockedPromotionReason: string;
  statusSource: string;
  normalizedBy: string;
  invariantOk: boolean;
  failureReason: string;
};

export type CandidateRuntimeGuardAudit = {
  symbol: string;
  candidateId: string;
  scanId: string;
  sourcePath: string;
  runtimeSnapshotPresent: boolean;
  runtimeSnapshotInvariantOk: boolean;
  blockedBeforeEntryGate: boolean;
  finalStatus: CandidateLifecycleStatus;
  finalNoBuyReason: string;
  suppressedSecondaryBlockers: string[];
  invariantOk: boolean;
};

export function buildCandidateRuntimeSnapshot(input: {
  scanId: string;
  scannerCycleId?: string | null;
  createdAt?: string | null;
  runtimeState: AutoBotsCanonicalState;
}): CandidateRuntimeSnapshot {
  const runtime = input.runtimeState;
  return {
    id: `${input.scanId}:${input.scannerCycleId ?? 'scanner'}:runtime`,
    scanId: input.scanId,
    scannerCycleId: input.scannerCycleId ?? input.scanId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    autoBotsUiOn: runtime.uiAutoBotsOn ?? runtime.uiAutoBotsButtonState,
    autoBotsResolvedOn: runtime.autoBotsResolvedOn ?? runtime.resolvedAutoBotsEnabled,
    scannerAutoEnabled: runtime.scannerAutoEnabled,
    paperAutoExecutionEnabled: runtime.paperAutoExecutionEnabled,
    manualOverrideRequested: runtime.manualOverrideRequested,
    manualOverrideEnabled: runtime.manualOverrideEnabled,
    dynamicPerCoinStrategy: runtime.dynamicPerCoinStrategy,
    strategySourceResolved: runtime.strategySourceResolved,
    routerPath: runtime.routerPath,
    runtimeStrategyDropdown: runtime.runtimeStrategyDropdown,
    executionMode: runtime.executionMode,
    buildMode: runtime.buildMode,
    tauriMode: runtime.tauriDetected ? 'tauri' : 'browser',
    invariantOk: runtime.invariantOk,
    failureReason: runtime.failureReason,
  };
}

function uniqueReasons(reasons: unknown[]): string[] {
  return Array.from(new Set(reasons
    .map((reason) => String(reason ?? '').trim())
    .filter((reason) => reason.length > 0 && reason !== 'none' && reason !== 'undefined')));
}

function runtimeFailureReason(candidate: ScannerCandidate): string {
  const runtime = candidate.runtimeSnapshot ?? null;
  if (!runtime) return 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING';
  return runtime.invariantOk === false
    ? (runtime.failureReason && runtime.failureReason !== 'none' ? runtime.failureReason : 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED')
    : 'none';
}

function collectSecondaryBlockers(candidate: ScannerCandidate, runtimeReason: string): string[] {
  const c = candidate as any;
  return uniqueReasons([
    ...(candidate.blockReasons ?? []),
    ...(candidate.entryGateDecision?.blockReasons ?? []),
    ...(candidate.entryGateDecision?.snapshot?.blockReasons ?? []),
    ...(c.gateAudit?.setupMissing ?? []),
    c.gateAudit?.blocker,
    c.primaryBlocker,
    c.finalNoBuyReason,
    c.strategyAuditSnapshot?.finalBlocker,
    c.strategyAuditSnapshot?.strategyContractBlocker,
    ...(candidate.suppressedSecondaryBlockers ?? []),
  ]).filter((reason) => reason !== runtimeReason && reason !== 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING' && reason !== 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED');
}

export function attachCandidateRuntimeSnapshot(input: {
  candidate: ScannerCandidate;
  scanId: string;
  scannerCycleId?: string | null;
  runtimeState: AutoBotsCanonicalState;
  sourcePath: string;
}): ScannerCandidate {
  const existing = input.candidate.runtimeSnapshot;
  const runtimeSnapshot = existing && existing.invariantOk !== false
    ? existing
    : buildCandidateRuntimeSnapshot({
      scanId: input.scanId,
      scannerCycleId: input.scannerCycleId ?? input.scanId,
      createdAt: input.candidate.createdAt,
      runtimeState: input.runtimeState,
    });
  const runtimeBlockers = new Set(['CANDIDATE_RUNTIME_SNAPSHOT_MISSING', 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED']);
  const sanitizedBlockReasons = (input.candidate.blockReasons ?? []).filter((reason) => !runtimeBlockers.has(String(reason)));
  const clearRuntimeReason = (reason: string | undefined): string | undefined => reason && runtimeBlockers.has(reason) ? undefined : reason;
  return {
    ...input.candidate,
    autoBotsRuntimeState: input.runtimeState,
    runtimeSnapshot,
    blockReasons: sanitizedBlockReasons,
    finalNoBuyReason: clearRuntimeReason(input.candidate.finalNoBuyReason),
    primaryBlocker: clearRuntimeReason(input.candidate.primaryBlocker),
    mainReason: clearRuntimeReason(input.candidate.mainReason) ?? (runtimeBlockers.has(String(input.candidate.mainReason)) ? 'runtime_snapshot_restored' : input.candidate.mainReason),
    candidateBirthSource: input.candidate.candidateBirthSource ?? input.sourcePath,
    lastTransformSource: input.sourcePath,
    candidateStatusSource: input.candidate.candidateStatusSource ?? 'runtime_snapshot_attached',
  } as ScannerCandidate;
}

export function assertCandidateRuntimeReady(input: {
  candidate: ScannerCandidate;
  scanId: string;
  sourcePath: string;
  blockedBeforeEntryGate?: boolean;
}): { ready: true; candidate: ScannerCandidate } | { ready: false; candidate: ScannerCandidate; audit: CandidateRuntimeGuardAudit } {
  const runtimeReason = runtimeFailureReason(input.candidate);
  if (runtimeReason === 'none') return { ready: true, candidate: input.candidate };
  const finalStatus: CandidateLifecycleStatus = runtimeReason === 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
    ? 'WAIT_RUNTIME_STATE'
    : 'INVALID_RUNTIME_STATE';
  const suppressedSecondaryBlockers = collectSecondaryBlockers(input.candidate, runtimeReason);
  const guarded = {
    ...input.candidate,
    status: finalStatus as ScannerCandidate['status'],
    lifecycleStatus: finalStatus,
    entryGateDecision: null,
    finalExecutable: false,
    buyAllowed: false,
    finalNoBuyReason: runtimeReason,
    primaryBlocker: runtimeReason,
    mainReason: runtimeReason,
    blockReasons: [runtimeReason],
    suppressedSecondaryBlockers,
    lastTransformSource: input.sourcePath,
    candidateStatusSource: 'runtime_snapshot_guard',
  } as ScannerCandidate;
  const audit: CandidateRuntimeGuardAudit = {
    symbol: input.candidate.symbol,
    candidateId: input.candidate.candidateId ?? 'unknown',
    scanId: input.scanId,
    sourcePath: input.sourcePath,
    runtimeSnapshotPresent: Boolean(input.candidate.runtimeSnapshot),
    runtimeSnapshotInvariantOk: Boolean(input.candidate.runtimeSnapshot) && input.candidate.runtimeSnapshot?.invariantOk !== false,
    blockedBeforeEntryGate: input.blockedBeforeEntryGate ?? true,
    finalStatus,
    finalNoBuyReason: runtimeReason,
    suppressedSecondaryBlockers,
    invariantOk: true,
  };
  logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_GUARD_AUDIT: symbol=${audit.symbol} candidateId=${audit.candidateId} scanId=${audit.scanId} sourcePath=${audit.sourcePath} runtimeSnapshotPresent=${String(audit.runtimeSnapshotPresent)} runtimeSnapshotInvariantOk=${String(audit.runtimeSnapshotInvariantOk)} blockedBeforeEntryGate=${String(audit.blockedBeforeEntryGate)} finalStatus=${audit.finalStatus} finalNoBuyReason=${audit.finalNoBuyReason} suppressedSecondaryBlockers=${audit.suppressedSecondaryBlockers.join('|') || 'none'} invariantOk=${String(audit.invariantOk)}`);
  return { ready: false, candidate: guarded, audit };
}

export function buildCandidateStrategyDecisionSnapshot(input: {
  scanId: string;
  candidate: Pick<ScannerCandidate, 'symbol' | 'riskGroup' | 'runtimeSnapshot'>;
  resolution: AutoBotsFinalStrategyResolution;
}): CandidateStrategyDecisionSnapshot {
  const runtime = input.candidate.runtimeSnapshot ?? null;
  const resolution = input.resolution;
  const strategyMissing = runtime?.autoBotsResolvedOn === true
    && (!resolution.finalExecutionStrategy || resolution.finalExecutionStrategy === 'wait')
    && !resolution.fallbackApplied;
  const disabledWhileOn = runtime?.autoBotsResolvedOn === true && resolution.strategySourceResolved === 'DISABLED';
  const dynamicMismatch = runtime?.dynamicPerCoinStrategy != null && runtime.dynamicPerCoinStrategy !== resolution.dynamicPerCoinStrategy;
  const invariantOk = !strategyMissing && !disabledWhileOn && !dynamicMismatch;
  const failureReason = disabledWhileOn
    ? 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED'
    : dynamicMismatch
      ? 'DYNAMIC_PER_COIN_STRATEGY_MISMATCH'
      : strategyMissing
        ? 'STRATEGY_DECISION_MISSING'
        : 'none';
  return {
    scanId: input.scanId,
    symbol: input.candidate.symbol,
    riskGroup: input.candidate.riskGroup ?? null,
    runtimeSnapshotId: runtime?.id ?? null,
    autoBotsResolvedOn: runtime?.autoBotsResolvedOn ?? true,
    dynamicPerCoinStrategy: runtime?.dynamicPerCoinStrategy ?? resolution.dynamicPerCoinStrategy,
    strategySourceResolved: resolution.strategySourceResolved,
    marketBestFit: resolution.marketBestFit,
    groupRecommendedStrategy: resolution.groupRecommendedStrategy,
    perCoinSelectedStrategy: resolution.perCoinSelectedStrategy,
    userSelectedRuntimeStrategy: resolution.userSelectedRuntimeStrategy,
    routerPath: resolution.routerPath,
    fallbackType: resolution.fallbackType,
    fallbackApplied: resolution.fallbackApplied,
    fallbackReason: resolution.fallbackReason,
    finalExecutionStrategy: resolution.finalExecutionStrategy,
    setupValidatorUsed: resolution.finalExecutionStrategy,
    entryGateStrategyInput: resolution.finalExecutionStrategy,
    tp1Strategy: 'pending',
    strategyAtEntryToPersist: resolution.finalExecutionStrategy,
    invariantOk,
    failureReason,
  };
}

export function buildCandidateExecutionPrecheckSnapshot(input: {
  candidate: ScannerCandidate;
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  riskGroupResolved: boolean;
  professionalGateResolved: boolean;
  entryContractResolved: boolean;
  entryContractValid: boolean;
  capitalAvailable?: boolean;
  duplicateChecked?: boolean;
  pendingOrderChecked?: boolean;
}): CandidateExecutionPrecheckSnapshot {
  const failureReason = !input.priceFresh
    ? 'PRICE_STALE'
    : !input.bookFresh
      ? 'BOOK_STALE'
      : !input.riskGroupResolved
        ? 'MISSING_RISK_GROUP'
        : !input.entryContractResolved
          ? 'ENTRY_CONTRACT_UNRESOLVED'
          : !input.entryContractValid
            ? 'ENTRY_CONTRACT_INVALID'
            : !input.professionalGateResolved
              ? 'PROFESSIONAL_GATE_UNRESOLVED'
              : !input.spreadOk
                ? 'SPREAD_TOO_HIGH'
                : !input.tpRoomOk
                  ? 'TP_ROOM_MISSING'
                  : 'none';
  return {
    priceFresh: input.priceFresh,
    bookFresh: input.bookFresh,
    spreadOk: input.spreadOk,
    tpRoomOk: input.tpRoomOk,
    riskGroupResolved: input.riskGroupResolved,
    marketSnapshotFresh: input.priceFresh && input.bookFresh,
    referencePriceFresh: input.priceFresh,
    candleDataFresh: input.priceFresh,
    professionalGateResolved: input.professionalGateResolved,
    entryContractResolved: input.entryContractResolved,
    entryContractValid: input.entryContractValid,
    capitalAvailable: input.capitalAvailable ?? true,
    duplicateChecked: input.duplicateChecked ?? true,
    pendingOrderChecked: input.pendingOrderChecked ?? true,
    invariantOk: failureReason === 'none',
    failureReason,
  };
}

function normalizeReason(value: unknown): string {
  const raw = String(value ?? '').trim();
  return raw.length > 0 ? raw : 'none';
}

function pickPrimaryBlocker(candidate: ScannerCandidate): string {
  const c = candidate as any;
  const runtimeReason = runtimeFailureReason(candidate);
  if (runtimeReason !== 'none') return runtimeReason;
  return normalizeReason(
    c.blockReasons?.[0]
    ?? c.traderBrainDecision?.blockReasons?.[0]
    ?? c.primaryBlocker
    ?? c.strategyAuditSnapshot?.dynamicSetupContext?.primaryBlocker
    ?? c.strategyAudit?.dynamicSetupContext?.primaryBlocker
    ?? c.gateAudit?.blocker
    ?? c.executionDecision?.finalNoBuyReason
    ?? c.finalNoBuyReason
    ?? c.strategyAuditSnapshot?.finalBlocker
    ?? c.strategyAuditSnapshot?.strategyContractBlocker
    ?? 'none',
  );
}

function pickSetupResult(candidate: ScannerCandidate): string {
  const c = candidate as any;
  return normalizeReason(c.setupResult ?? c.strategyAuditSnapshot?.setupResult ?? c.strategyAudit?.dynamicSetupContext?.setupResult ?? c.executionDecision?.setupResult ?? 'none');
}

function pickFinalNoBuyReason(candidate: ScannerCandidate, primaryBlocker: string): string {
  const c = candidate as any;
  const runtimeReason = runtimeFailureReason(candidate);
  if (runtimeReason !== 'none') return runtimeReason;
  const reason = normalizeReason(c.executionDecision?.finalNoBuyReason ?? c.finalNoBuyReason ?? c.strategyAuditSnapshot?.finalBuyBlockedReason ?? c.strategyAuditSnapshot?.finalBlocker ?? 'none');
  if (reason !== 'none') return reason;
  if (primaryBlocker !== 'none') return primaryBlocker;
  return 'none';
}

function isExecutableStrategy(candidate: ScannerCandidate): boolean {
  const c = candidate as any;
  const strategy = String(c.finalExecutionStrategy ?? c.strategyAuditSnapshot?.finalExecutionStrategy ?? c.strategyDecision?.finalExecutionStrategy ?? c.selectedStrategy ?? '').toLowerCase();
  return strategy === 'balanced' || strategy === 'momentum' || strategy === 'dip_and_rebound' || strategy === 'conservative';
}

function mapBlockedStatus(input: { primaryBlocker: string; finalNoBuyReason: string; setupResult: string; finalExecutionStrategy?: string | null }): CandidateLifecycleStatus {
  const blocker = `${input.primaryBlocker}|${input.finalNoBuyReason}|${input.setupResult}`.toLowerCase();
  const strategy = String(input.finalExecutionStrategy ?? '').toLowerCase();
  if (blocker.includes('candidate_runtime_snapshot_missing')) return 'WAIT_RUNTIME_STATE';
  if (blocker.includes('runtime_state')) return 'INVALID_RUNTIME_STATE';
  if (blocker.includes('strategy_handoff_integrity_failed')) return 'WAIT_STRATEGY_HANDOFF';
  if (blocker.includes('rebound_stale')) return 'WAIT_REBOUND_FRESHNESS';
  if (blocker.includes('dip_not_confirmed') || blocker.includes('waiting_confirmation') || blocker.includes('waiting_for_setup')) return 'WAITING_CONFIRMATION';
  if (blocker.includes('rebound_not_confirmed')) return 'WAITING_CONFIRMATION';
  if (blocker.includes('momentum_not_confirmed')) return 'WAITING_MOMENTUM';
  if (blocker.includes('spread')) return 'WAIT_SPREAD';
  if (blocker.includes('tp_room') || blocker.includes('tp room')) return 'WAIT_TP_ROOM';
  if (blocker.includes('book_stale')) return 'WAIT_BOOK_FRESHNESS';
  if (blocker.includes('price_stale') || blocker.includes('price_not_fresh')) return 'WAIT_PRICE_FRESHNESS';
  if (blocker.includes('entry_contract')) return 'WAIT_ENTRY_CONTRACT';
  if (blocker.includes('risk_group')) return 'WAIT_RISK_GROUP';
  if (blocker.includes('strategy')) return 'WAIT_STRATEGY_DECISION';
  if (strategy === 'wait') return 'WAIT_STRATEGY_DECISION';
  return 'WAIT_STRATEGY_DECISION';
}

export function normalizeCandidateDisplayStatus(candidate: ScannerCandidate): ScannerCandidate {
  const primaryBlocker = pickPrimaryBlocker(candidate);
  const setupResult = pickSetupResult(candidate);
  const finalNoBuyReason = pickFinalNoBuyReason(candidate, primaryBlocker);
  const c = candidate as any;
  const finalExecutionStrategy = String(c.finalExecutionStrategy ?? c.strategyAuditSnapshot?.finalExecutionStrategy ?? c.strategyDecision?.finalExecutionStrategy ?? c.selectedStrategy ?? '').toLowerCase();
  const attemptedFinalExecutable = Boolean(c.executionDecision?.finalExecutable ?? c.finalExecutable ?? c.strategyAuditSnapshot?.finalExecutable ?? c.strategyAuditSnapshot?.finalExecutableAtEntry ?? false);
  const attemptedBuyAllowed = Boolean(c.executionDecision?.buyAllowed ?? c.buyAllowed ?? c.strategyAuditSnapshot?.buyAllowed ?? false);
  const hasBlocker = primaryBlocker !== 'none' || (finalNoBuyReason !== 'none' && finalNoBuyReason !== 'undefined');
  const runtimeOk = Boolean(c.runtimeSnapshot) && c.runtimeSnapshot?.invariantOk !== false;
  const strategyDecisionOk = Boolean(c.strategyDecision) && c.strategyDecision?.invariantOk !== false;
  const executionPrecheckOk = Boolean(c.executionPrecheckSnapshot) && c.executionPrecheckSnapshot?.invariantOk !== false;
  const priceFresh = c.executionPrecheckSnapshot?.priceFresh ?? candidate.priceFresh !== false;
  const bookFresh = c.executionPrecheckSnapshot?.bookFresh ?? candidate.bookFresh !== false;
  const spreadOk = c.executionPrecheckSnapshot?.spreadOk ?? c.executionDecision?.spreadOk ?? ((candidate.spreadPct ?? 0) < 0.5);
  const tpRoomOk = c.executionPrecheckSnapshot?.tpRoomOk ?? c.executionDecision?.tpRoomOk ?? candidate.tpRoomOk !== false;
  const entryContractValid = c.executionPrecheckSnapshot?.entryContractValid ?? c.strategyAuditSnapshot?.strategyContractValid !== false;
  const capitalOk = c.executionPrecheckSnapshot?.capitalAvailable ?? c.executionDecision?.capitalOk ?? true;
  const duplicateOk = c.executionDecision?.duplicateOpenPosition !== true;
  const pendingOk = c.executionDecision?.pendingOrderExists !== true;
  const validBuy = attemptedFinalExecutable
    && attemptedBuyAllowed
    && !hasBlocker
    && runtimeOk
    && strategyDecisionOk
    && executionPrecheckOk
    && isExecutableStrategy(candidate)
    && priceFresh
    && bookFresh
    && spreadOk
    && tpRoomOk
    && entryContractValid
    && capitalOk
    && duplicateOk
    && pendingOk
    && Boolean(candidate.riskGroup);
  const canonicalStatus = validBuy
    ? 'BUY'
    : mapBlockedStatus({ primaryBlocker, finalNoBuyReason, setupResult, finalExecutionStrategy });
  const rawStatus: ScannerCandidate['status'] = validBuy ? 'BUY' : canonicalStatus as ScannerCandidate['status'];
  const blockedPromotionReason = validBuy ? 'none' : finalNoBuyReason !== 'none' ? finalNoBuyReason : primaryBlocker !== 'none' ? primaryBlocker
    : !runtimeOk ? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
      : !strategyDecisionOk ? 'STRATEGY_DECISION_MISSING'
        : !executionPrecheckOk ? 'EXECUTION_PRECHECK_SNAPSHOT_MISSING'
          : !priceFresh ? 'PRICE_STALE'
            : !bookFresh ? 'BOOK_STALE'
              : !spreadOk ? 'SPREAD_TOO_HIGH'
                : !tpRoomOk ? 'TP_ROOM_NOT_OK'
                  : !entryContractValid ? 'ENTRY_CONTRACT_INVALID'
                    : !capitalOk ? 'CAPITAL_NOT_OK'
                      : !duplicateOk ? 'DUPLICATE_OPEN_POSITION'
                        : !pendingOk ? 'PENDING_ORDER_EXISTS'
                          : !isExecutableStrategy(candidate) ? 'NO_VALID_AUTOBOTS_STRATEGY'
                            : 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
  const failureReason = rawStatus === 'BUY' && !validBuy
    ? 'RAW_BUY_WITHOUT_CANONICAL_EXECUTABLE'
    : finalNoBuyReason !== 'none' && (attemptedFinalExecutable || attemptedBuyAllowed)
      ? 'FINAL_NO_BUY_WITH_EXECUTABLE_TRUE'
      : 'none';
  const invariantOk = failureReason === 'none';
  const suppressedSecondaryBlockers = validBuy ? candidate.suppressedSecondaryBlockers : !runtimeOk
    ? collectSecondaryBlockers(candidate, blockedPromotionReason)
    : candidate.suppressedSecondaryBlockers;
  const normalizedBlockReasons = validBuy
    ? candidate.blockReasons
    : !runtimeOk
      ? [blockedPromotionReason]
      : Array.from(new Set([...(candidate.blockReasons ?? []), finalNoBuyReason !== 'none' ? finalNoBuyReason : primaryBlocker].filter(Boolean)));
  if (finalNoBuyReason !== 'none' && (attemptedFinalExecutable || attemptedBuyAllowed)) {
    logger.info(`EXECUTION_DECISION_SELF_CONSISTENCY_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? c.scanId ?? 'unknown'} finalExecutable=false buyAllowed=false finalNoBuyReason=${finalNoBuyReason} selectedForExecution=false submitAttempted=false adapterCalled=false invariantOk=false failureReason=FINAL_NO_BUY_WITH_EXECUTABLE_TRUE`);
  }
  const audit: CandidateCanonicalDisplayStatus = {
    canonicalStatus,
    rawStatus,
    displayStatus: rawStatus,
    signal: validBuy ? 'BUY' : 'WAIT',
    primaryBlocker,
    finalNoBuyReason,
    setupResult,
    finalExecutable: validBuy ? attemptedFinalExecutable : false,
    buyAllowed: validBuy ? attemptedBuyAllowed : false,
    canPromoteToBuy: validBuy,
    blockedPromotionReason,
    statusSource: validBuy ? 'canonical_buy_ready' : 'candidate_lifecycle_guard',
    normalizedBy: 'normalizeCandidateDisplayStatus',
    invariantOk,
    failureReason,
  };
  logger.info(`TOP_CANDIDATE_CANONICAL_STATUS_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? c.scanId ?? 'unknown'} canonicalStatus=${audit.canonicalStatus} rawStatus=${audit.rawStatus} displayStatus=${audit.displayStatus} signal=${audit.signal} finalExecutable=${String(audit.finalExecutable)} buyAllowed=${String(audit.buyAllowed)} primaryBlocker=${audit.primaryBlocker} finalNoBuyReason=${audit.finalNoBuyReason} setupResult=${audit.setupResult} statusSource=${audit.statusSource} normalizedBy=${audit.normalizedBy} invariantOk=${String(audit.invariantOk)} failureReason=${audit.failureReason}`);
  return {
    ...candidate,
    status: rawStatus,
    lifecycleStatus: validBuy ? 'BUY_READY' : canonicalStatus,
    finalExecutable: audit.finalExecutable,
    buyAllowed: audit.buyAllowed,
    finalNoBuyReason: validBuy ? undefined : finalNoBuyReason,
    primaryBlocker: validBuy ? undefined : primaryBlocker,
    mainReason: validBuy ? candidate.mainReason : (primaryBlocker !== 'none' ? primaryBlocker : finalNoBuyReason),
    blockReasons: normalizedBlockReasons,
    suppressedSecondaryBlockers,
    canonicalDisplayStatus: audit,
  } as ScannerCandidate;
}

export function finalizeCandidateStatus(candidate: ScannerCandidate): ScannerCandidate {
  return normalizeCandidateDisplayStatus(candidate);
}

export function resolveCandidatePromotion(input: {
  candidate: ScannerCandidate;
  scanId: string;
  requestedNextStatus: string;
}): CandidatePromotionAudit {
  const c = input.candidate;
  const runtime = c.runtimeSnapshot ?? null;
  const strategy = c.strategyDecision ?? null;
  const execution = c.executionPrecheckSnapshot ?? null;
  const riskGroupPresent = Boolean(c.riskGroup);
  const priceFresh = execution?.priceFresh ?? c.priceFresh !== false;
  const bookFresh = execution?.bookFresh ?? c.bookFresh !== false;
  const spreadOk = execution?.spreadOk ?? ((c.spreadPct ?? 0) < 0.5);
  const tpRoomOk = execution?.tpRoomOk ?? c.tpRoomOk !== false;
  const entryContractValid = execution?.entryContractValid ?? false;
  const professionalGateResolved = execution?.professionalGateResolved ?? false;
  const primaryBlocker = pickPrimaryBlocker(c);
  const setupResult = pickSetupResult(c);
  const finalNoBuyReason = pickFinalNoBuyReason(c, primaryBlocker);
  const finalExecutable = Boolean((c as any).executionDecision?.finalExecutable ?? c.finalExecutable ?? (c as any).strategyAuditSnapshot?.finalExecutable ?? false);
  const buyAllowed = Boolean((c as any).executionDecision?.buyAllowed ?? c.buyAllowed ?? (c as any).strategyAuditSnapshot?.buyAllowed ?? false);
  const selectedForExecution = Boolean((c as any).executionDecision?.selectedForExecution ?? false);
  const strategyHandoffValid = Boolean(c.strategyDecision?.invariantOk !== false
    && finalNoBuyReason !== 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
    && primaryBlocker !== 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
    && isExecutableStrategy(c));
  const blockedPromotionReason = !runtime
    ? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
    : !runtime.invariantOk
      ? 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED'
      : !strategy
        ? 'STRATEGY_DECISION_MISSING'
        : !strategy.invariantOk
          ? strategy.failureReason
          : !execution
            ? 'EXECUTION_PRECHECK_SNAPSHOT_MISSING'
            : !riskGroupPresent
              ? 'MISSING_RISK_GROUP'
              : !priceFresh
                ? 'PRICE_STALE'
                : !bookFresh
                  ? 'BOOK_STALE'
                  : !execution.entryContractResolved
                    ? 'ENTRY_CONTRACT_UNRESOLVED'
                    : !entryContractValid
                      ? execution.failureReason
                      : !professionalGateResolved
                        ? 'PROFESSIONAL_GATE_UNRESOLVED'
                        : !execution.invariantOk
                          ? execution.failureReason
                          : !strategyHandoffValid
                            ? 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
                            : primaryBlocker !== 'none'
                              ? primaryBlocker
                              : finalNoBuyReason !== 'none'
                                ? finalNoBuyReason
                                : !finalExecutable || !buyAllowed
                                  ? 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
                                  : 'none';
  const canPromoteToBuy = blockedPromotionReason === 'none';
  const finalStatus: CandidateLifecycleStatus = canPromoteToBuy
    ? 'BUY_READY'
    : blockedPromotionReason === 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
      ? 'WAIT_RUNTIME_STATE'
      : blockedPromotionReason === 'AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED'
        ? 'INVALID_RUNTIME_STATE'
        : blockedPromotionReason === 'STRATEGY_DECISION_MISSING' || blockedPromotionReason === 'DYNAMIC_PER_COIN_STRATEGY_MISMATCH'
          ? 'WAIT_STRATEGY_DECISION'
          : blockedPromotionReason === 'PRICE_STALE'
            ? 'WAIT_PRICE_FRESHNESS'
            : blockedPromotionReason === 'BOOK_STALE'
              ? 'WAIT_BOOK_FRESHNESS'
              : blockedPromotionReason === 'MISSING_RISK_GROUP'
                ? 'WAIT_RISK_GROUP'
                : blockedPromotionReason === 'ENTRY_CONTRACT_UNRESOLVED' || blockedPromotionReason === 'ENTRY_CONTRACT_INVALID'
                  ? 'WAIT_ENTRY_CONTRACT'
                  : blockedPromotionReason === 'PROFESSIONAL_GATE_UNRESOLVED'
                    ? 'WAIT_PROFESSIONAL_GATE'
                    : mapBlockedStatus({ primaryBlocker, finalNoBuyReason: blockedPromotionReason, setupResult, finalExecutionStrategy: (c as any).finalExecutionStrategy ?? c.strategyDecision?.finalExecutionStrategy });
  const invariantOk = input.requestedNextStatus !== 'BUY' || canPromoteToBuy;
  return {
    symbol: c.symbol,
    scanId: input.scanId,
    previousStatus: c.status,
    requestedNextStatus: input.requestedNextStatus,
    finalStatus,
    runtimeSnapshotPresent: Boolean(runtime),
    strategyDecisionPresent: Boolean(strategy),
    executionPrecheckSnapshotPresent: Boolean(execution),
    riskGroupPresent,
    priceFresh,
    bookFresh,
    spreadOk,
    tpRoomOk,
    entryContractValid,
    strategyHandoffValid,
    professionalGateResolved,
    primaryBlocker,
    finalNoBuyReason,
    setupResult,
    finalExecutable: canPromoteToBuy ? finalExecutable : false,
    buyAllowed: canPromoteToBuy ? buyAllowed : false,
    selectedForExecution,
    canPromoteToBuy,
    blockedPromotionReason,
    invariantOk,
  };
}

export function applyCandidatePromotionGuard(input: {
  candidate: ScannerCandidate;
  scanId: string;
  requestedNextStatus: ScannerCandidate['status'];
}): ScannerCandidate {
  const audit = resolveCandidatePromotion({
    candidate: input.candidate,
    scanId: input.scanId,
    requestedNextStatus: input.requestedNextStatus,
  });
  logger.info(`CANDIDATE_PROMOTION_INTEGRITY_AUDIT: symbol=${input.candidate.symbol} scanId=${input.scanId} requestedNextStatus=${input.requestedNextStatus} finalStatus=${audit.finalStatus} canPromoteToBuy=${String(audit.canPromoteToBuy)} runtimeSnapshotPresent=${String(audit.runtimeSnapshotPresent)} strategyDecisionPresent=${String(audit.strategyDecisionPresent)} executionPrecheckSnapshotPresent=${String(audit.executionPrecheckSnapshotPresent)} entryContractValid=${String(audit.entryContractValid)} strategyHandoffValid=${String(audit.strategyHandoffValid)} primaryBlocker=${audit.primaryBlocker} finalNoBuyReason=${audit.finalNoBuyReason} setupResult=${audit.setupResult} finalExecutable=${String(audit.finalExecutable)} buyAllowed=${String(audit.buyAllowed)} selectedForExecution=${String(audit.selectedForExecution)} blockedPromotionReason=${audit.blockedPromotionReason} invariantOk=${String(audit.invariantOk)}`);
  if (input.requestedNextStatus === 'BUY' && !audit.canPromoteToBuy) {
    return normalizeCandidateDisplayStatus({
      ...input.candidate,
      status: audit.finalStatus as ScannerCandidate['status'],
      lifecycleStatus: audit.finalStatus,
      finalNoBuyReason: audit.blockedPromotionReason,
      finalExecutable: false,
      buyAllowed: false,
      mainReason: audit.blockedPromotionReason,
      blockReasons: Array.from(new Set([...(input.candidate.blockReasons ?? []), audit.blockedPromotionReason])),
      promotionAudit: audit,
    } as ScannerCandidate);
  }
  return normalizeCandidateDisplayStatus({
    ...input.candidate,
    lifecycleStatus: audit.finalStatus,
    finalNoBuyReason: audit.blockedPromotionReason === 'none' ? undefined : audit.blockedPromotionReason,
    finalExecutable: audit.canPromoteToBuy && input.requestedNextStatus === 'BUY',
    buyAllowed: audit.canPromoteToBuy && input.requestedNextStatus === 'BUY',
    promotionAudit: audit,
  } as ScannerCandidate);
}

export function promoteCandidateToBuyReady(candidate: ScannerCandidate, context: { scanId: string }): ScannerCandidate {
  const guarded = applyCandidatePromotionGuard({
    candidate,
    scanId: context.scanId,
    requestedNextStatus: 'BUY',
  });
  return revalidateCandidateForExecution(guarded);
}

export function revalidateCandidateForExecution(candidate: ScannerCandidate): ScannerCandidate {
  const requestedNextStatus = candidate.status === 'BUY' ? 'BUY' : candidate.status;
  return applyCandidatePromotionGuard({
    candidate,
    scanId: candidate.runtimeSnapshot?.scanId ?? candidate.candidateId ?? 'unknown',
    requestedNextStatus,
  });
}
