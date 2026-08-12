import type { AutoBotsCanonicalState } from '../runtime/autobots-state';
import type { AutoBotsFinalStrategyResolution } from './AutoStrategyRouter';
import type { ScannerCandidate } from '../types';
import { logger } from '../../utils/logger';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { rehydrateCandidateMarketFreshness } from '../market-data/canonical-market-freshness';

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
  | 'INVALID_RUNTIME_STATE'
  | 'FILTERED_ALREADY_OPEN_POSITION';

export type CandidateRuntimeSnapshot = {
  id: string;
  scanId: string;
  scannerCycleId: string;
  createdAt: string;
  symbol: string | null;
  price: number | null;
  referencePrice: number | null;
  livePrice: number | null;
  spreadPct: number | null;
  tpRoomOk: boolean | null;
  strategy: string | null;
  finalExecutionStrategy: string | null;
  entryRule: string | null;
  riskGroup: string | null;
  confidence: number | null;
  score: number | null;
  dipPercent: number | null;
  reboundPercent: number | null;
  momentumPct: number | null;
  reboundConfirmed: boolean | null;
  momentumConfirmed: boolean | null;
  freshnessStatus: string | null;
  sourceOwner: 'AutoBots' | 'Unicorn' | 'UnicornHunter' | 'ML_PREDICT_BUY' | 'unknown';
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
  candidate?: Partial<ScannerCandidate> | null;
  sourceOwner?: CandidateRuntimeSnapshot['sourceOwner'] | null;
}): CandidateRuntimeSnapshot {
  const runtime = input.runtimeState;
  const candidate = input.candidate ?? null;
  const candidateAny = candidate as any;
  const sourceOwner = input.sourceOwner
    ?? (String(candidateAny?.executionSource ?? candidateAny?.candidateSource ?? candidateAny?.source ?? candidateAny?.ownerName ?? '').toLowerCase().includes('unicorn')
      ? 'Unicorn'
      : candidateAny?.mlPredictBuyDecision?.finalDecision === 'BUY_READY' || String(candidateAny?.executionSource ?? '').toLowerCase().includes('ml_predict')
        ? 'ML_PREDICT_BUY'
        : candidate
          ? 'AutoBots'
          : 'unknown');
  const strategy = String(candidateAny?.effectiveStrategy ?? candidateAny?.selectedStrategy ?? candidateAny?.strategyDecision?.finalExecutionStrategy ?? candidateAny?.autoStrategyDecision?.effectiveStrategy ?? '').trim() || null;
  const finalExecutionStrategy = String(candidateAny?.finalExecutionStrategy ?? candidateAny?.strategyDecision?.finalExecutionStrategy ?? strategy ?? '').trim() || null;
  const entryRule = String(
    candidateAny?.finalEntryRule
    ?? candidateAny?.entryRule
    ?? candidateAny?.traderBrainDecision?.entryPlan?.reason
    ?? candidateAny?.entryPlan?.reason
    ?? candidateAny?.mainReason
    ?? '',
  ).trim() || null;
  const snapshot: CandidateRuntimeSnapshot = {
    id: `${input.scanId}:${input.scannerCycleId ?? 'scanner'}:runtime`,
    scanId: input.scanId,
    scannerCycleId: input.scannerCycleId ?? input.scanId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    symbol: candidate?.symbol ?? null,
    price: Number.isFinite(Number(candidate?.price)) ? Number(candidate?.price) : null,
    referencePrice: Number.isFinite(Number(candidateAny?.referencePrice ?? candidate?.price)) ? Number(candidateAny?.referencePrice ?? candidate?.price) : null,
    livePrice: Number.isFinite(Number(candidateAny?.livePrice ?? candidate?.price)) ? Number(candidateAny?.livePrice ?? candidate?.price) : null,
    spreadPct: Number.isFinite(Number(candidate?.spreadPct)) ? Number(candidate?.spreadPct) : null,
    tpRoomOk: typeof candidate?.tpRoomOk === 'boolean' ? candidate.tpRoomOk : null,
    strategy,
    finalExecutionStrategy,
    entryRule,
    riskGroup: candidate?.riskGroup ?? null,
    confidence: Number.isFinite(Number(candidate?.confidence)) ? Number(candidate?.confidence) : null,
    score: Number.isFinite(Number(candidate?.rawScore ?? candidate?.rank)) ? Number(candidate?.rawScore ?? candidate?.rank) : null,
    dipPercent: Number.isFinite(Number(candidate?.dipPercent)) ? Number(candidate?.dipPercent) : null,
    reboundPercent: Number.isFinite(Number(candidate?.reboundPercent)) ? Number(candidate?.reboundPercent) : null,
    momentumPct: Number.isFinite(Number(candidate?.m5Change ?? candidateAny?.periodMomentum ?? candidateAny?.recencyWeightedMomentum)) ? Number(candidate?.m5Change ?? candidateAny?.periodMomentum ?? candidateAny?.recencyWeightedMomentum) : null,
    reboundConfirmed: typeof candidate?.reboundConfirmed === 'boolean' ? candidate.reboundConfirmed : null,
    momentumConfirmed: typeof candidate?.momentumConfirmed === 'boolean' ? candidate.momentumConfirmed : null,
    freshnessStatus: String(candidate?.reboundFreshnessStatus ?? (candidate?.priceFresh === false ? 'price_stale' : 'fresh')).trim() || null,
    sourceOwner,
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
  logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_CREATED_AUDIT: symbol=${snapshot.symbol ?? 'unknown'} scanId=${snapshot.scanId} sourceOwner=${snapshot.sourceOwner} price=${snapshot.price ?? 'missing'} spreadPct=${snapshot.spreadPct ?? 'missing'} tpRoomOk=${String(snapshot.tpRoomOk ?? 'missing')} strategy=${snapshot.strategy ?? 'missing'} finalExecutionStrategy=${snapshot.finalExecutionStrategy ?? 'missing'} entryRule=${snapshot.entryRule ?? 'missing'} riskGroup=${snapshot.riskGroup ?? 'missing'} confidence=${snapshot.confidence ?? 'missing'} freshnessStatus=${snapshot.freshnessStatus ?? 'missing'} invariantOk=${String(snapshot.invariantOk)}`);
  return {
    ...snapshot,
  };
}

function runtimeSnapshotRequiredMissingFields(runtime: CandidateRuntimeSnapshot | null): string[] {
  if (!runtime) {
    return [
      'runtimeSnapshot',
      'symbol',
      'price',
      'livePrice',
      'spreadPct',
      'tpRoomOk',
      'strategy',
      'finalExecutionStrategy',
      'entryRule',
      'riskGroup',
      'confidence',
      'dipPercent',
      'reboundPercent',
      'momentumPct',
      'freshnessStatus',
      'sourceOwner',
    ];
  }
  const missing: string[] = [];
  if (!runtime.symbol) missing.push('symbol');
  if (runtime.price == null) missing.push('price');
  if (runtime.livePrice == null) missing.push('livePrice');
  if (runtime.spreadPct == null) missing.push('spreadPct');
  if (runtime.tpRoomOk == null) missing.push('tpRoomOk');
  if (!runtime.strategy) missing.push('strategy');
  if (!runtime.finalExecutionStrategy) missing.push('finalExecutionStrategy');
  if (!runtime.entryRule) missing.push('entryRule');
  if (!runtime.riskGroup) missing.push('riskGroup');
  if (runtime.confidence == null) missing.push('confidence');
  if (runtime.dipPercent == null) missing.push('dipPercent');
  if (runtime.reboundPercent == null) missing.push('reboundPercent');
  if (runtime.momentumPct == null) missing.push('momentumPct');
  if (!runtime.freshnessStatus) missing.push('freshnessStatus');
  if (!runtime.sourceOwner || runtime.sourceOwner === 'unknown') missing.push('sourceOwner');
  return missing;
}

export function refreshCandidateRuntimeSnapshotContext(input: {
  candidate: ScannerCandidate;
  scanId: string;
  sourcePath: string;
}): ScannerCandidate {
  const existing = input.candidate.runtimeSnapshot;
  if (!existing) return input.candidate;
  const refreshed = buildCandidateRuntimeSnapshot({
    scanId: existing.scanId || input.scanId,
    scannerCycleId: existing.scannerCycleId || input.scanId,
    createdAt: existing.createdAt,
    runtimeState: {
      uiAutoBotsOn: existing.autoBotsUiOn,
      uiAutoBotsButtonState: existing.autoBotsUiOn,
      autoBotsResolvedOn: existing.autoBotsResolvedOn,
      resolvedAutoBotsEnabled: existing.autoBotsResolvedOn,
      scannerAutoEnabled: existing.scannerAutoEnabled,
      paperAutoExecutionEnabled: existing.paperAutoExecutionEnabled,
      manualOverrideRequested: existing.manualOverrideRequested,
      manualOverrideEnabled: existing.manualOverrideEnabled,
      dynamicPerCoinStrategy: existing.dynamicPerCoinStrategy,
      strategySourceResolved: existing.strategySourceResolved,
      routerPath: existing.routerPath,
      runtimeStrategyDropdown: existing.runtimeStrategyDropdown,
      executionMode: existing.executionMode,
      buildMode: existing.buildMode,
      tauriDetected: existing.tauriMode === 'tauri',
      invariantOk: existing.invariantOk,
      failureReason: existing.failureReason,
    } as AutoBotsCanonicalState,
    candidate: input.candidate,
    sourceOwner: existing.sourceOwner === 'unknown' ? null : existing.sourceOwner,
  });
  const runtimeSnapshot = {
    ...refreshed,
    id: existing.id,
    createdAt: existing.createdAt,
    invariantOk: existing.invariantOk,
    failureReason: existing.failureReason,
  };
  logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_REFRESH_AUDIT: symbol=${input.candidate.symbol} scanId=${input.scanId} sourcePath=${input.sourcePath} hadSnapshot=true missingFieldsBefore=${runtimeSnapshotRequiredMissingFields(existing).join('|') || 'none'} missingFieldsAfter=${runtimeSnapshotRequiredMissingFields(runtimeSnapshot).join('|') || 'none'} invariantOk=${String(runtimeSnapshot.invariantOk && runtimeSnapshotRequiredMissingFields(runtimeSnapshot).length === 0)}`);
  return {
    ...input.candidate,
    runtimeSnapshot,
  } as ScannerCandidate;
}

function uniqueReasons(reasons: unknown[]): string[] {
  return Array.from(new Set(reasons
    .map((reason) => String(reason ?? '').trim())
    .filter((reason) => reason.length > 0 && reason !== 'none' && reason !== 'undefined')));
}

function runtimeFailureReason(candidate: ScannerCandidate): string {
  const runtime = candidate.runtimeSnapshot ?? null;
  if (!runtime) return 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING';
  if (runtimeSnapshotRequiredMissingFields(runtime).length > 0) return 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING';
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
  const refreshedRuntimeSnapshot = buildCandidateRuntimeSnapshot({
      scanId: input.scanId,
      scannerCycleId: input.scannerCycleId ?? input.scanId,
      createdAt: input.candidate.createdAt,
      runtimeState: input.runtimeState,
      candidate: input.candidate,
    });
  const runtimeSnapshot = existing && existing.invariantOk !== false
    ? { ...refreshedRuntimeSnapshot, id: existing.id, createdAt: existing.createdAt, invariantOk: existing.invariantOk, failureReason: existing.failureReason }
    : refreshedRuntimeSnapshot;
  logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_REFRESH_AUDIT: symbol=${input.candidate.symbol} scanId=${input.scanId} sourcePath=${input.sourcePath} hadSnapshot=${String(Boolean(existing))} missingFieldsBefore=${runtimeSnapshotRequiredMissingFields(existing ?? null).join('|') || 'none'} missingFieldsAfter=${runtimeSnapshotRequiredMissingFields(runtimeSnapshot).join('|') || 'none'} invariantOk=${String(runtimeSnapshot.invariantOk && runtimeSnapshotRequiredMissingFields(runtimeSnapshot).length === 0)}`);
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
  const candidate = refreshCandidateRuntimeSnapshotContext({
    candidate: input.candidate,
    scanId: input.scanId,
    sourcePath: input.sourcePath,
  });
  const runtimeReason = runtimeFailureReason(candidate);
  const missingFields = runtimeSnapshotRequiredMissingFields(candidate.runtimeSnapshot ?? null);
  if (runtimeReason === 'none') {
    logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_CONSUMED_AUDIT: symbol=${candidate.symbol} candidateId=${candidate.candidateId ?? 'unknown'} scanId=${input.scanId} sourcePath=${input.sourcePath} missingFields=${missingFields.join('|') || 'none'} finalStatus=${candidate.lifecycleStatus ?? candidate.status} sourceOwner=${candidate.runtimeSnapshot?.sourceOwner ?? 'unknown'} invariantOk=${String(missingFields.length === 0)}`);
    return { ready: true, candidate };
  }
  const finalStatus: CandidateLifecycleStatus = runtimeReason === 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
    ? 'WAIT_RUNTIME_STATE'
    : 'INVALID_RUNTIME_STATE';
  const suppressedSecondaryBlockers = collectSecondaryBlockers(candidate, runtimeReason);
  const guarded = {
    ...candidate,
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
    symbol: candidate.symbol,
    candidateId: candidate.candidateId ?? 'unknown',
    scanId: input.scanId,
    sourcePath: input.sourcePath,
    runtimeSnapshotPresent: Boolean(candidate.runtimeSnapshot),
    runtimeSnapshotInvariantOk: Boolean(candidate.runtimeSnapshot) && candidate.runtimeSnapshot?.invariantOk !== false,
    blockedBeforeEntryGate: input.blockedBeforeEntryGate ?? true,
    finalStatus,
    finalNoBuyReason: runtimeReason,
    suppressedSecondaryBlockers,
    invariantOk: true,
  };
  logger.info(`CANDIDATE_RUNTIME_SNAPSHOT_GUARD_AUDIT: symbol=${audit.symbol} candidateId=${audit.candidateId} scanId=${audit.scanId} sourcePath=${audit.sourcePath} runtimeSnapshotPresent=${String(audit.runtimeSnapshotPresent)} runtimeSnapshotInvariantOk=${String(audit.runtimeSnapshotInvariantOk)} blockedBeforeEntryGate=${String(audit.blockedBeforeEntryGate)} finalStatus=${audit.finalStatus} finalNoBuyReason=${audit.finalNoBuyReason} suppressedSecondaryBlockers=${audit.suppressedSecondaryBlockers.join('|') || 'none'} invariantOk=${String(audit.invariantOk)}`);
  logger.warn(`CANDIDATE_RUNTIME_SNAPSHOT_MISSING_AUDIT: symbol=${audit.symbol} candidateId=${audit.candidateId} scanId=${audit.scanId} sourcePath=${audit.sourcePath} finalStatus=${audit.finalStatus} finalNoBuyReason=BLOCK_CANDIDATE_RUNTIME_SNAPSHOT_MISSING missingFields=${missingFields.join('|') || 'runtimeSnapshot'} submitAllowed=false adapterCallAllowed=false`);
  if (candidate.status === 'BUY' || candidate.lifecycleStatus === 'BUY_READY') {
    logger.warn(`BUY_READY_BLOCKED_BY_RUNTIME_SNAPSHOT_AUDIT: symbol=${audit.symbol} candidateId=${audit.candidateId} scanId=${audit.scanId} sourcePath=${audit.sourcePath} previousStatus=${candidate.lifecycleStatus ?? candidate.status} finalStatus=${audit.finalStatus} finalNoBuyReason=BLOCK_CANDIDATE_RUNTIME_SNAPSHOT_MISSING missingFields=${missingFields.join('|') || 'runtimeSnapshot'} displayBuyAllowed=false`);
  }
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
  const runtimeMissingFields = runtimeSnapshotRequiredMissingFields(c.runtimeSnapshot ?? null);
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
    && runtimeMissingFields.length === 0
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
    : !runtimeOk || runtimeMissingFields.length > 0 ? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
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
  const suppressedSecondaryBlockers = validBuy ? candidate.suppressedSecondaryBlockers : !runtimeOk || runtimeMissingFields.length > 0
    ? collectSecondaryBlockers(candidate, blockedPromotionReason)
    : candidate.suppressedSecondaryBlockers;
  const normalizedBlockReasons = validBuy
    ? candidate.blockReasons
    : !runtimeOk || runtimeMissingFields.length > 0
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
  logger.info(`CANDIDATE_CANONICAL_STATUS_PARITY_AUDIT: symbol=${candidate.symbol} candidateRowStatus=${audit.displayStatus} selectedCoinStatus=${audit.canonicalStatus} executionPlanStatus=${audit.canonicalStatus} canonicalStatus=${audit.canonicalStatus} finalExecutable=${String(audit.finalExecutable)} actionableNow=${String(audit.finalExecutable && audit.buyAllowed)} submitEligible=${String(audit.finalExecutable && audit.buyAllowed)} submitAttempted=${String(Boolean(c.executionDecision?.submitAttempted))} executionSkipped=${String(!(audit.finalExecutable && audit.buyAllowed))} blockerList=${normalizedBlockReasons?.join('|') || audit.finalNoBuyReason || 'none'} mismatchDetected=false invariantOk=true failureReason=none`);
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
  candidate = rehydrateCandidateMarketFreshness({
    candidate,
    current: MarketDataFeed.getInstance().getCanonicalSymbolMarketData(candidate.symbol),
    consumer: 'CandidateLifecycle',
  });
  const requestedNextStatus = candidate.status === 'BUY' ? 'BUY' : candidate.status;
  return applyCandidatePromotionGuard({
    candidate,
    scanId: candidate.runtimeSnapshot?.scanId ?? candidate.candidateId ?? 'unknown',
    requestedNextStatus,
  });
}
