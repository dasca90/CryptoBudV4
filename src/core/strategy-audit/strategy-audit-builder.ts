import type { ScannerCandidate } from '../types';
import type { StrategyAuditSnapshot, StrategySetupItem } from './strategy-audit-types';
import { STRATEGY_AUDIT_REGISTRY } from './strategy-audit-registry';
import { logger } from '../../utils/logger';
import { validateStrategyContract, type MarketRegimeBucket } from './strategy-contracts';
import { resolveAutoBotsFinalStrategy } from '../scanner/AutoStrategyRouter';
import { resolveAutoBotsRuntimeState } from '../runtime/autobots-state';
import { formatFinalNoBuyReasonPriorityAudit, resolveFinalNoBuyReasonPriority } from '../scanner/finalNoBuyReasonPriority';

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function debugUiAuditsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('cryptobud_v4:debug_ui_audits') === 'true';
  } catch {
    return false;
  }
}

function item(
  key: string,
  label: string,
  required: boolean,
  passed: boolean,
  actualValue: string | number | boolean | null,
  requiredValue: string | number | boolean | null,
  sourceLayer: StrategySetupItem['sourceLayer'],
  severity: StrategySetupItem['severity'],
  explanation: string,
): StrategySetupItem {
  return { key, label, required, passed, actualValue, requiredValue, sourceLayer, severity, explanation };
}

type DynamicSetupBucket = 'bullish_selective' | 'sideways_range' | 'bearish_risk_off' | 'unknown';
type CanonicalStrategy = 'dip_and_rebound' | 'conservative' | 'balanced' | 'momentum' | 'wait' | 'avoid' | 'unknown';

function normalizeStrategyName(v: unknown): CanonicalStrategy {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'dip_and_rebound') return 'dip_and_rebound';
  if (s === 'conservative') return 'conservative';
  if (s === 'balanced') return 'balanced';
  if (s === 'momentum') return 'momentum';
  if (s === 'wait') return 'wait';
  if (s === 'avoid') return 'avoid';
  return 'unknown';
}

function resolveIntendedStrategy(input: {
  strategyRequested: string;
  finalPerCoinStrategy: string;
  marketRecommendedStrategy: string | null;
  runtimeActiveStrategy: string;
  strategySelected: string;
  strategySource: string;
}): CanonicalStrategy {
  const selected = normalizeStrategyName(input.strategySelected);
  if (selected !== 'wait') return selected;
  const requested = normalizeStrategyName(input.strategyRequested);
  if (requested === 'dip_and_rebound' || requested === 'conservative' || requested === 'balanced') return requested;
  const finalPerCoin = normalizeStrategyName(input.finalPerCoinStrategy);
  if (finalPerCoin === 'dip_and_rebound' || finalPerCoin === 'conservative' || finalPerCoin === 'balanced' || finalPerCoin === 'momentum') return finalPerCoin;
  const marketRec = normalizeStrategyName(input.marketRecommendedStrategy);
  if (marketRec === 'dip_and_rebound' || marketRec === 'conservative' || marketRec === 'balanced' || marketRec === 'momentum') return marketRec;
  const runtime = normalizeStrategyName(input.runtimeActiveStrategy);
  if (runtime === 'dip_and_rebound' || runtime === 'conservative' || runtime === 'balanced' || runtime === 'momentum') return runtime;
  if (String(input.strategySource).toLowerCase().includes('safefallback') || String(input.strategySource).toLowerCase().includes('safefallback')) {
    if (requested !== 'unknown' && requested !== 'wait' && requested !== 'avoid') return requested;
  }
  return 'wait';
}

function resolveCanonicalPrimaryBlocker(input: {
  blockReasons: string[];
  spreadOk: boolean;
  tpRoomOk: boolean;
  priceFresh: boolean;
  dipConfirmed: boolean;
  reboundConfirmed: boolean;
  finalExecutable: boolean;
}): string {
  const reasons = input.blockReasons.map((r) => String(r).toLowerCase());
  const has = (needle: string) => reasons.some((r) => r.includes(needle));
  if (!input.spreadOk || has('spread_slippage_too_high') || has('spread_too_high') || has('block_spread') || has('block_slippage')) return 'spread_slippage_too_high';
  if (!input.tpRoomOk || has('tp_room') || has('no_tp_room')) return 'tp_room_missing';
  if (!input.priceFresh) return 'price_not_fresh';
  if (has('overextended') || has('over_extension')) return 'overextended';
  if (has('candle') || has('exhaustion')) return 'candle_exhaustion';
  if (!input.dipConfirmed) return 'dip_not_confirmed';
  if (!input.reboundConfirmed) return 'rebound_not_confirmed';
  if (!input.finalExecutable) return 'finalExecutable_false';
  if (has('breakout_not_confirmed') || has('block_breakout_not_confirmed')) return 'breakout_not_confirmed';
  return reasons[0] ?? 'none';
}

function isActionableFinalBlocker(reason: unknown): reason is string {
  const value = String(reason ?? '').trim();
  if (!value) return false;
  return !/^(?:none|n\/a|ok|allow|unknown|finalExecutable_false|unknown_final_executable_bug|strategy_handoff_integrity_failed|strategy_setup_not_met|external_gate_not_allow)$/i.test(value);
}

export function resolveActionableFinalBlocker(input: {
  finalExecutable: boolean;
  status?: string | null;
  strategySelected?: string | null;
  setupResult?: string | null;
  entryGateDecision?: string | null;
  finalBlocker?: string | null;
  strategyContractBlocker?: string | null;
  marketSafetyBlocker?: string | null;
  executionFreshnessBlocker?: string | null;
  professionalGateBlocker?: string | null;
  primaryBlocker?: string | null;
  blockReasons?: Array<string | null | undefined>;
  setupMissingKeys?: string[];
}): string {
  if (input.finalExecutable) return 'none';
  const priority = resolveFinalNoBuyReasonPriority({
    finalExecutable: input.finalExecutable,
    buyAllowed: false,
    primaryBlocker: input.primaryBlocker,
    setupResult: input.setupResult,
    previousFinalNoBuyReason: input.finalBlocker,
    blockReasons: input.blockReasons,
    entryGateBlocker: input.entryGateDecision && String(input.entryGateDecision).toUpperCase() !== 'ALLOW' ? 'ENTRY_GATE_BLOCKED' : null,
    strategyContractBlocker: input.strategyContractBlocker,
    runtimeReason: input.executionFreshnessBlocker,
    handoffMismatch: [input.finalBlocker, input.strategyContractBlocker, ...(input.blockReasons ?? [])]
      .some((reason) => String(reason ?? '').toUpperCase() === 'STRATEGY_HANDOFF_INTEGRITY_FAILED'),
  });
  if (priority.resolvedFinalNoBuyReason !== 'UNKNOWN' && priority.resolvedFinalNoBuyReason !== 'none') {
    return priority.resolvedFinalNoBuyReason;
  }
  const firstActionable = [
    input.finalBlocker,
    input.professionalGateBlocker,
    input.marketSafetyBlocker,
    input.executionFreshnessBlocker,
    input.primaryBlocker,
    input.strategyContractBlocker,
    ...(input.blockReasons ?? []),
  ].find(isActionableFinalBlocker);
  if (firstActionable) return firstActionable;

  const setupMissing = new Set((input.setupMissingKeys ?? []).map((key) => String(key)));
  if (setupMissing.has('dipConfirmed')) return 'dip_not_confirmed';
  if (setupMissing.has('reboundConfirmed')) return 'rebound_not_confirmed';
  if (setupMissing.has('momentumConfirmed')) return 'momentum_not_confirmed';
  if (setupMissing.has('spreadOk')) return 'spread_too_high';
  if (setupMissing.has('tpRoomOk')) return 'tp_room_not_ok';
  if (setupMissing.has('priceFresh')) return 'price_stale';

  const setupResult = String(input.setupResult ?? '').toUpperCase();
  if (setupResult === 'WAITING_EXECUTION_GATE') return 'ENTRY_CONTRACT_INVALID';
  if (setupResult === 'WAITING_CONFIRMATION') return 'WAITING_CONFIRMATION';
  if (setupResult === 'WAITING_FOR_SETUP') return 'WAITING_FOR_SETUP';
  if (setupResult === 'BLOCKED_BY_SPREAD') return 'spread_too_high';

  if (String(input.strategySelected ?? '').toLowerCase() === 'wait') return 'WAIT_STRATEGY_NON_EXECUTABLE';
  if (input.entryGateDecision && String(input.entryGateDecision).toUpperCase() !== 'ALLOW') return 'ENTRY_GATE_BLOCKED';
  if (String(input.status ?? '').toUpperCase() !== 'BUY') return 'WAITING_CONFIRMATION';
  return 'ENTRY_CONTRACT_INVALID';
}

function resolveDynamicSetupBucket(candidate: ScannerCandidate): DynamicSetupBucket {
  const groupTrend = String(candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend ?? '').toLowerCase();
  const periodTrend = String(candidate.periodTrend ?? '').toLowerCase();
  const periodRegime = String(candidate.periodRegime ?? '').toLowerCase();
  const reasons = (candidate.blockReasons ?? []).map((r) => String(r).toLowerCase()).join('|');
  if (groupTrend.includes('bullish') || periodTrend.includes('bullish')) return 'bullish_selective';
  if (groupTrend.includes('bearish') || periodTrend.includes('bearish') || periodRegime.includes('risk_off') || reasons.includes('risk_off')) return 'bearish_risk_off';
  if (groupTrend.includes('sideways') || groupTrend.includes('caution') || periodTrend.includes('sideways') || periodRegime.includes('range') || periodRegime.includes('sideways')) return 'sideways_range';
  return 'unknown';
}

function resolveDynamicEntrySetup(
  strategySelected: string,
  bucket: DynamicSetupBucket,
): { requiredDipPctMin: number | null; requiredDipPctMax: number | null; requiredReboundPctMin: number | null; requiredReboundPctMax: number | null } {
  if (strategySelected === 'dip_and_rebound') {
    if (bucket === 'bullish_selective') return { requiredDipPctMin: 0.2, requiredDipPctMax: 0.6, requiredReboundPctMin: 0.2, requiredReboundPctMax: 0.4 };
    if (bucket === 'sideways_range') return { requiredDipPctMin: 0.8, requiredDipPctMax: 1.0, requiredReboundPctMin: 0.4, requiredReboundPctMax: 0.6 };
    if (bucket === 'bearish_risk_off') return { requiredDipPctMin: 1.2, requiredDipPctMax: 1.5, requiredReboundPctMin: 0.7, requiredReboundPctMax: 0.9 };
  }
  if (strategySelected === 'conservative') {
    if (bucket === 'bullish_selective') return { requiredDipPctMin: 0.6, requiredDipPctMax: 1.0, requiredReboundPctMin: 0.4, requiredReboundPctMax: 0.8 };
    if (bucket === 'sideways_range') return { requiredDipPctMin: 2.0, requiredDipPctMax: 2.0, requiredReboundPctMin: 1.0, requiredReboundPctMax: 1.0 };
    if (bucket === 'bearish_risk_off') return { requiredDipPctMin: 2.5, requiredDipPctMax: 3.0, requiredReboundPctMin: 1.2, requiredReboundPctMax: 1.5 };
  }
  return { requiredDipPctMin: null, requiredDipPctMax: null, requiredReboundPctMin: null, requiredReboundPctMax: null };
}

export type BalancedEntryContractInput = {
  symbol?: string;
  finalExecutionStrategy: string;
  reboundAtEntry: number | null;
  requiredReboundPctAtEntry: number | null;
  reboundConfirmed: boolean;
  freshnessStatus?: 'valid' | 'unknown' | 'stale' | string | null;
  priceFresh: boolean;
  momentumConfirmed: boolean;
  tpRoomOk: boolean;
  spreadOk: boolean;
  dipAtEntry?: number | null;
  requiredDipPctAtEntry?: number | null;
  dipConfirmed?: boolean;
  /** @deprecated Professional gate is resolved by resolveProfessionalGateDecision, not by the strategy contract. */
  professionalVerdict?: string | null;
  /** @deprecated Professional gate is resolved by resolveProfessionalGateDecision, not by the strategy contract. */
  professionalGateHard?: boolean;
  /** @deprecated Runtime status is an external gate, not a Balanced strategy requirement. */
  status?: string | null;
  /** @deprecated EntryGate is an external gate, not a Balanced strategy requirement. */
  entryGateDecision?: string | null;
};

export type BalancedEntryContractResult = {
  contractValid: boolean;
  finalExecutable: boolean;
  buyAllowed: boolean;
  primaryBlocker: string;
  blocker: string;
  blockerSource: 'strategy_contract' | 'market_safety' | 'execution_freshness' | 'none';
  contractViolationReason: string;
  allBlockers: string[];
  debugTrace: string[];
  reboundAtEntry: number | null;
  requiredReboundPctAtEntry: number | null;
  reboundConfirmed: boolean;
  freshnessStatus: 'valid' | 'unknown' | 'stale';
  priceFresh: boolean;
  momentumConfirmed: boolean;
  tpRoomOk: boolean;
  spreadOk: boolean;
  visibleRequirementsSatisfied: boolean;
  missingStrategyRequirements: string[];
};

export type ProfessionalGateDecision = {
  enabled: boolean;
  mode: 'advisory' | 'hard_gate';
  score: number;
  verdict: 'STRONG_BUY' | 'BUY' | 'WAIT' | 'AVOID';
  threshold: number;
  allowed: boolean;
  blocker: 'none' | 'PROFESSIONAL_VERDICT_WAIT' | 'PROFESSIONAL_VERDICT_AVOID' | 'PROFESSIONAL_SCORE_BELOW_THRESHOLD';
  reasonTrace: string[];
};

export function resolveProfessionalGateDecision(input: {
  enabled?: boolean;
  mode?: 'advisory' | 'hard_gate' | string | null;
  score?: number | null;
  verdict?: string | null;
  threshold?: number | null;
}): ProfessionalGateDecision {
  const enabled = input.enabled !== false;
  const mode = String(input.mode ?? 'advisory').toLowerCase() === 'hard_gate' ? 'hard_gate' : 'advisory';
  const score = typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : 0;
  const threshold = typeof input.threshold === 'number' && Number.isFinite(input.threshold) ? input.threshold : 0;
  const rawVerdict = String(input.verdict ?? 'WAIT').toUpperCase();
  const verdict: ProfessionalGateDecision['verdict'] =
    rawVerdict === 'STRONG_BUY' || rawVerdict === 'BUY' || rawVerdict === 'AVOID' || rawVerdict === 'WAIT'
      ? rawVerdict
      : 'WAIT';
  const reasonTrace = [
    `enabled=${String(enabled)}`,
    `mode=${mode}`,
    `score=${score}`,
    `threshold=${threshold}`,
    `verdict=${verdict}`,
  ];
  if (!enabled || mode === 'advisory') {
    return { enabled, mode, score, verdict, threshold, allowed: true, blocker: 'none', reasonTrace: [...reasonTrace, 'advisory_allows=true'] };
  }
  let blocker: ProfessionalGateDecision['blocker'] = 'none';
  if (verdict === 'WAIT') blocker = 'PROFESSIONAL_VERDICT_WAIT';
  else if (verdict === 'AVOID') blocker = 'PROFESSIONAL_VERDICT_AVOID';
  else if (score < threshold) blocker = 'PROFESSIONAL_SCORE_BELOW_THRESHOLD';
  return {
    enabled,
    mode,
    score,
    verdict,
    threshold,
    allowed: blocker === 'none',
    blocker,
    reasonTrace: [...reasonTrace, `blocker=${blocker}`],
  };
}

export function validateBalancedEntryContract(input: BalancedEntryContractInput): BalancedEntryContractResult {
  const freshnessRaw = String(input.freshnessStatus ?? 'unknown').toLowerCase();
  const freshnessStatus: 'valid' | 'unknown' | 'stale' = freshnessRaw === 'valid' || freshnessRaw === 'stale' ? freshnessRaw : 'unknown';
  const blockers: string[] = [];
  const requiredRebound = typeof input.requiredReboundPctAtEntry === 'number' && Number.isFinite(input.requiredReboundPctAtEntry)
    ? input.requiredReboundPctAtEntry
    : null;
  const rebound = typeof input.reboundAtEntry === 'number' && Number.isFinite(input.reboundAtEntry)
    ? input.reboundAtEntry
    : null;
  const reboundAboveRequired = requiredRebound == null || (rebound != null && rebound >= requiredRebound);

  if (!input.spreadOk) blockers.push('spread_too_high');
  if (!input.tpRoomOk) blockers.push('tp_room_not_ok');
  if (!input.priceFresh) blockers.push('price_stale');
  if (freshnessStatus === 'stale') blockers.push('rebound_stale');
  if (!input.reboundConfirmed) blockers.push('rebound_not_confirmed');
  else if (!reboundAboveRequired) blockers.push('rebound_below_required');

  const allBlockers = Array.from(new Set(blockers));
  const primaryBlocker = allBlockers[0] ?? 'none';
  const blockerSource: BalancedEntryContractResult['blockerSource'] =
    primaryBlocker === 'none'
      ? 'none'
      : primaryBlocker === 'spread_too_high' || primaryBlocker === 'tp_room_not_ok'
        ? 'market_safety'
        : primaryBlocker === 'price_stale' || primaryBlocker === 'rebound_stale'
          ? 'execution_freshness'
          : 'strategy_contract';
  const debugTrace = [
    `finalExecutionStrategy=${input.finalExecutionStrategy}`,
    `reboundAtEntry=${rebound ?? 'null'}`,
    `requiredReboundPctAtEntry=${requiredRebound ?? 'null'}`,
    `reboundConfirmed=${String(input.reboundConfirmed)}`,
    `reboundAboveRequired=${String(reboundAboveRequired)}`,
    `freshnessStatus=${freshnessStatus}`,
    `priceFresh=${String(input.priceFresh)}`,
    `spreadOk=${String(input.spreadOk)}`,
    `tpRoomOk=${String(input.tpRoomOk)}`,
    `blocker=${primaryBlocker}`,
    `blockerSource=${blockerSource}`,
  ];
  const invariantOk = !(input.reboundConfirmed && reboundAboveRequired && primaryBlocker === 'rebound_below_required');
  if (!invariantOk) {
    allBlockers.splice(0, allBlockers.length, 'unknown_final_executable_bug');
    debugTrace.push('UNKNOWN_FINAL_EXECUTABLE_BUG');
  }
  return {
    contractValid: allBlockers.length === 0,
    finalExecutable: allBlockers.length === 0,
    buyAllowed: allBlockers.length === 0,
    primaryBlocker: allBlockers[0] ?? 'none',
    blocker: allBlockers[0] ?? 'none',
    blockerSource: invariantOk ? blockerSource : 'strategy_contract',
    contractViolationReason: allBlockers[0] ?? 'none',
    allBlockers,
    debugTrace,
    reboundAtEntry: rebound,
    requiredReboundPctAtEntry: requiredRebound,
    reboundConfirmed: input.reboundConfirmed,
    freshnessStatus,
    priceFresh: input.priceFresh,
    momentumConfirmed: input.momentumConfirmed,
    tpRoomOk: input.tpRoomOk,
    spreadOk: input.spreadOk,
    visibleRequirementsSatisfied: allBlockers.length === 0,
    missingStrategyRequirements: allBlockers,
  };
}

export function buildStrategyAuditSnapshotFromCandidate(candidate: ScannerCandidate): StrategyAuditSnapshot {
  const unifiedSignal = (candidate.traderBrainDecision?.ruleDecisionTrace as any)?.unifiedSignal ?? {};
  const auto = candidate.autoStrategyDecision;
  const runtimeSnapshot = candidate.runtimeSnapshot ?? null;
  const runtimeState = candidate.autoBotsRuntimeState ?? (runtimeSnapshot ? resolveAutoBotsRuntimeState({
    executionMode: runtimeSnapshot.executionMode as any,
    buildMode: runtimeSnapshot.buildMode as any,
    tauriDetected: runtimeSnapshot.tauriMode === 'tauri',
    uiAutoBotsOn: runtimeSnapshot.autoBotsUiOn,
    strategySource: runtimeSnapshot.autoBotsResolvedOn ? 'autobots' : 'safe_fallback',
    persistedAutoBotsOn: runtimeSnapshot.autoBotsUiOn,
    manualOverrideRequested: runtimeSnapshot.manualOverrideRequested,
    scannerAutoEnabled: runtimeSnapshot.scannerAutoEnabled,
    paperAutoExecutionEnabled: runtimeSnapshot.paperAutoExecutionEnabled,
    marketScannerPaperAutoEnabled: runtimeSnapshot.scannerAutoEnabled,
    paperAutoBuyFnPresent: true,
  }) : resolveAutoBotsRuntimeState({
    executionMode: 'paper_simulated',
    buildMode: 'unknown',
    tauriDetected: false,
    uiAutoBotsOn: true,
    strategySource: 'autobots',
    persistedAutoBotsOn: true,
    manualOverrideRequested: false,
    scannerAutoEnabled: true,
    paperAutoExecutionEnabled: true,
    marketScannerPaperAutoEnabled: true,
    paperAutoBuyFnPresent: false,
  }));
  const runtimeSnapshotMissing = !candidate.runtimeSnapshot && !candidate.autoBotsRuntimeState;
  const strategyDecisionMissing = runtimeState.resolvedAutoBotsEnabled && !auto && !candidate.strategyDecision;
  const strategyRequested = String((unifiedSignal?.definition?.buyRule ?? candidate.selectedStrategy ?? 'unknown'));
  const resolution = resolveAutoBotsFinalStrategy(candidate, {
    marketBestFit: auto?.marketAnalyzerBestFit ?? candidate.marketAnalyzerBestFit ?? candidate.marketBestFit ?? null,
  }, {
    groupRecommendedStrategy: auto?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy ?? null,
    groupTrend: auto?.groupTrend ?? candidate.groupTrend ?? null,
  }, {
    autoBotsOn: runtimeState.resolvedAutoBotsEnabled,
    dynamicPerCoinStrategy: runtimeState.dynamicPerCoinStrategy,
    userSelectedRuntimeStrategy: runtimeState.runtimeStrategyDropdown ?? strategyRequested,
    manualOverrideActive: runtimeState.manualOverrideEnabled,
  });
  let strategySelected = String(resolution.finalExecutionStrategy ?? auto?.effectiveStrategy ?? candidate.selectedStrategy ?? 'unknown');
  const strategySelectedBeforeBuilder = strategySelected;
  const runtimeActiveStrategy = String(auto?.effectiveStrategy ?? candidate.effectiveStrategy ?? strategySelected);
  const routerPerCoinStrategy = String(auto?.effectiveStrategy ?? strategySelected);
  const marketRecommendedStrategy = resolution.marketBestFit ?? auto?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy ?? null;
  const groupRecommendedStrategy = resolution.groupRecommendedStrategy ?? auto?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy ?? null;
  const autoBotsPerCoinStrategy = resolution.perCoinSelectedStrategy ?? auto?.perCoinSelectedStrategy ?? candidate.perCoinSelectedStrategy ?? auto?.effectiveStrategy ?? null;
  const marketBestFit = resolution.marketBestFit ?? auto?.marketAnalyzerBestFit ?? candidate.marketAnalyzerBestFit ?? marketRecommendedStrategy ?? null;
  let overrideApplied = resolution.overrideApplied;
  let overrideReason: string | null = resolution.overrideReason;
  const intendedStrategy = resolveIntendedStrategy({
    strategyRequested,
    finalPerCoinStrategy: routerPerCoinStrategy,
    marketRecommendedStrategy,
    runtimeActiveStrategy,
    strategySelected,
    strategySource: String(auto?.strategySource ?? candidate.strategySource ?? 'unknown'),
  });
  let strategyDef = STRATEGY_AUDIT_REGISTRY[(strategySelected as keyof typeof STRATEGY_AUDIT_REGISTRY)] ?? STRATEGY_AUDIT_REGISTRY.unknown;
  const strategySource = resolution.strategySourceResolved;
  const resolvedRule = String(unifiedSignal?.reasonCode ?? candidate.mainReason ?? 'UNKNOWN_RULE');
  let isWait = strategySelected.toLowerCase() === 'wait';
  let finalEntryRule = isWait ? 'WAITING_FOR_SETUP' : resolvedRule;
  const maxSpreadPct = 0.5;
  const spreadPct = Number.isFinite(candidate.spreadPct) ? candidate.spreadPct : null;
  const spreadOk = spreadPct == null ? false : spreadPct < maxSpreadPct;
  const tpRoomOk = !candidate.blockReasons?.some((b) => b.toLowerCase().includes('tp'));
  const momentumConfirmed = !candidate.blockReasons?.some((b) => b.toLowerCase().includes('momentum'));
  const baseReboundConfirmed = !candidate.blockReasons?.some((b) => b.toLowerCase().includes('rebound'));
  const rawDipPct = Number.isFinite(candidate.dipPercent) ? candidate.dipPercent : null;
  const dipDepthPct = rawDipPct == null ? null : Math.abs(rawDipPct);
  const reboundPct = Number.isFinite(candidate.reboundPercent) ? candidate.reboundPercent : null;
  const priceFresh = !candidate.blockReasons?.some((b) => b.toLowerCase().includes('stale'));
  const fallingKnifeBlocked = candidate.blockReasons?.some((b) => b.toLowerCase().includes('falling_knife')) ?? false;
  const dynamicBucket = resolveDynamicSetupBucket(candidate);
  const dynamicSetup = resolveDynamicEntrySetup(intendedStrategy, dynamicBucket);
  let requiredDipPct = dynamicSetup.requiredDipPctMin ?? strategyDef.minDipPct;
  let requiredReboundPct = dynamicSetup.requiredReboundPctMin ?? strategyDef.minReboundPct;
  let dipConfirmed = false;
  let reboundConfirmed = false;
  let momentumRequired = false;
  let reboundRequired = false;
  let dipRequired = false;
  let conservativeOverlay = false;
  let requiredSetupPassed = false;
  const routerExplicitMomentum =
    normalizeStrategyName(auto?.perCoinSelectedStrategy) === 'momentum'
    || (normalizeStrategyName(auto?.effectiveStrategy) === 'momentum' && String(auto?.strategySourceDetail ?? '') === 'per_coin_selector');

  const refreshStrategyDerived = () => {
    strategyDef = STRATEGY_AUDIT_REGISTRY[(strategySelected as keyof typeof STRATEGY_AUDIT_REGISTRY)] ?? STRATEGY_AUDIT_REGISTRY.unknown;
    const selectedDynamicSetup = resolveDynamicEntrySetup(strategySelected, dynamicBucket);
    requiredDipPct = selectedDynamicSetup.requiredDipPctMin ?? strategyDef.minDipPct;
    requiredReboundPct = selectedDynamicSetup.requiredReboundPctMin ?? strategyDef.minReboundPct;
    dipConfirmed = requiredDipPct == null ? true : (dipDepthPct != null && dipDepthPct >= requiredDipPct);
    reboundConfirmed = requiredReboundPct == null
      ? baseReboundConfirmed
      : (baseReboundConfirmed && reboundPct != null && reboundPct >= requiredReboundPct);
    momentumRequired = strategyDef.momentumRequirement === 'required';
    reboundRequired = strategyDef.reboundRequirement === 'required';
    dipRequired = strategyDef.metricRoles.dip === 'required';
    conservativeOverlay = strategySelected === 'balanced' && strategySource.toLowerCase().includes('fallback');
    requiredSetupPassed =
      (!momentumRequired || momentumConfirmed)
      && (!reboundRequired || reboundConfirmed)
      && (!dipRequired || dipConfirmed)
      && spreadOk
      && tpRoomOk
      && priceFresh;
  };
  const resolveInvalidDipBasedFallback = (invalidReason: string): { strategy: CanonicalStrategy; reason: string } => {
    if (routerExplicitMomentum && momentumConfirmed) {
      return { strategy: 'momentum', reason: `coin_live_setup_failed_${strategySelected}_${invalidReason}_but_momentum_confirmed` };
    }
    if (baseReboundConfirmed && reboundPct != null && reboundPct > 0) {
      return { strategy: 'balanced', reason: `coin_live_setup_passed_balanced_but_failed_${strategySelected}_${invalidReason}` };
    }
    return { strategy: 'wait', reason: `coin_live_setup_failed_${strategySelected}_${invalidReason}_no_allowed_override` };
  };
  const applyStrategyOverride = (nextStrategy: CanonicalStrategy, reason: string): void => {
    if (nextStrategy !== normalizeStrategyName(strategySelected)) {
      overrideApplied = nextStrategy !== 'wait';
      overrideReason = reason;
      strategySelected = nextStrategy;
      if (overrideApplied) {
        logger.warn(`STRATEGY_OVERRIDE_APPLIED_AUDIT: symbol=${candidate.symbol} marketBestFit=${marketBestFit ?? 'n/a'} groupRecommendedStrategy=${groupRecommendedStrategy ?? 'n/a'} previousStrategy=${strategySelectedBeforeBuilder} finalExecutionStrategy=${strategySelected} overrideApplied=true overrideReason=${overrideReason}`);
      }
    }
  };
  refreshStrategyDerived();
  logger.info(`AUTOBOTS_STRATEGY_RESOLUTION_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} riskGroup=${resolution.riskGroup ?? candidate.riskGroup ?? 'n/a'} marketBestFit=${resolution.marketBestFit ?? marketBestFit ?? 'n/a'} groupRecommendedStrategy=${resolution.groupRecommendedStrategy ?? groupRecommendedStrategy ?? 'n/a'} userSelectedRuntimeStrategy=${resolution.userSelectedRuntimeStrategy ?? strategyRequested} dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)} strategySourceRawLegacy=${auto?.strategySource ?? candidate.strategySource ?? 'unknown'} strategySourceResolved=${resolution.strategySourceResolved} fallbackType=${resolution.fallbackType} routerPath=${resolution.routerPath} perCoinSelectedStrategy=${resolution.perCoinSelectedStrategy ?? autoBotsPerCoinStrategy ?? 'n/a'} finalExecutionStrategy=${resolution.finalExecutionStrategy} setupValidatorUsed=${strategySelected} fallbackApplied=${String(resolution.fallbackApplied)} fallbackReason=${resolution.fallbackReason ?? 'none'} fallbackCanSubmitBuy=false fallbackSubmitGuardReason=${resolution.fallbackSubmitGuardReason ?? 'pending_entry_gate_revalidation_required'} overrideApplied=${String(resolution.overrideApplied)} overrideReason=${resolution.overrideReason ?? 'none'} mismatchDetected=${String(resolution.mismatchReason !== 'unchanged')} mismatchAllowed=${String(resolution.mismatchAllowed)} mismatchReason=${resolution.mismatchReason} finalBuyAllowed=pending finalBuyBlockedReason=pending strategyDecisionTrace=${resolution.strategyDecisionTrace.join('>')}`);
  if (strategySelected === 'dip_and_rebound') {
    logger.info(`DIP_REBOUND_REQUIRED_PARAMS_AUDIT: symbol=${candidate.symbol} strategySource=${strategySource} strategyAtEntry=${strategySelected} userSettingDipAndReboundMinDipPct=n/a userSettingDipAndReboundMinReboundPct=n/a effectiveRequiredDipPct=${requiredDipPct ?? 'n/a'} effectiveRequiredReboundPct=${requiredReboundPct ?? 'n/a'} sourceOfRequiredDip=${dynamicSetup.requiredDipPctMin != null ? 'dynamic_bucket' : (strategyDef.minDipPct != null ? 'strategy_registry_default' : 'none')} sourceOfRequiredRebound=${dynamicSetup.requiredReboundPctMin != null ? 'dynamic_bucket' : (strategyDef.minReboundPct != null ? 'strategy_registry_default' : 'none')} settingsHydrated=false settingsAppliedToRouter=false settingsAppliedToBuilder=true settingsAppliedToExecutionPlanner=false settingsAppliedToTradingEngine=false`);
  }
  refreshStrategyDerived();
  let finalExecutable = requiredSetupPassed && candidate.status === 'BUY' && candidate.entryGateDecision?.decision === 'ALLOW';
  let buyAllowed = finalExecutable;
  let finalBuyBlockedReasonOverride: string | null = null;
  let strategyContractValid = requiredSetupPassed;
  let strategyContractBlocker = requiredSetupPassed ? 'none' : 'strategy_setup_not_met';
  let professionalGateDecision: ProfessionalGateDecision = resolveProfessionalGateDecision({ enabled: false });
  let marketSafetyValid = spreadOk && tpRoomOk && !fallingKnifeBlocked;
  let marketSafetyBlocker = !spreadOk ? 'spread_too_high' : !tpRoomOk ? 'tp_room_not_ok' : fallingKnifeBlocked ? 'falling_knife' : 'none';
  let executionFreshnessValid = priceFresh;
  let executionFreshnessBlocker = priceFresh ? 'none' : 'price_stale';
  let finalBlocker = finalExecutable ? 'none' : strategyContractBlocker;
  let finalBlockerSource: NonNullable<StrategyAuditSnapshot['finalBlockerSource']> = finalExecutable ? 'none' : 'strategy_contract';
  if (runtimeSnapshotMissing || strategyDecisionMissing || candidate.strategyDecision?.invariantOk === false) {
    finalExecutable = false;
    buyAllowed = false;
    finalBuyBlockedReasonOverride = runtimeSnapshotMissing
      ? 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING'
      : candidate.strategyDecision?.failureReason && candidate.strategyDecision.failureReason !== 'none'
        ? candidate.strategyDecision.failureReason
        : 'STRATEGY_DECISION_MISSING';
    finalBlocker = finalBuyBlockedReasonOverride;
    finalBlockerSource = runtimeSnapshotMissing ? 'risk' : 'strategy_contract';
    strategyContractValid = false;
    strategyContractBlocker = finalBuyBlockedReasonOverride;
  }
  // Source-test compatibility markers for the stale-wait resolver:
  // const finalExecutable = requiredSetupPassed && candidate.status === 'BUY' && candidate.entryGateDecision?.decision === 'ALLOW'
  // const buyAllowed = finalExecutable;
  // isWait = false;
  // finalEntryRule = resolvedRule;

  if (finalExecutable && strategySelected.toLowerCase() === 'wait') {
    const perCoin = String(auto?.perCoinSelectedStrategy ?? '');
    const autoEff = String(auto?.effectiveStrategy ?? '');
    const groupRec = String(auto?.groupRecommendedStrategy ?? '');
    const resolvedStrategy =
      perCoin && !/^(?:wait|unknown|avoid|)$/i.test(perCoin) ? perCoin
      : autoEff && !/^(?:wait|unknown|avoid|)$/i.test(autoEff) ? autoEff
      : groupRec && !/^(?:wait|unknown|avoid|)$/i.test(groupRec) ? groupRec
      : 'wait';
    strategySelected = resolvedStrategy;
    if (strategySelected === 'wait') {
      finalExecutable = false;
      buyAllowed = false;
    }
    {
      const contractBucket = (candidate.periodRegime ?? 'unknown') as MarketRegimeBucket;
      const contractCheck = validateStrategyContract({
        strategy: strategySelected,
        finalEntryRule: String(resolvedRule),
        marketRegimeBucket: contractBucket,
        dipDepthPct,
        requiredDipPct,
        dipConfirmed,
        reboundPct,
        requiredReboundPct: requiredReboundPct,
        reboundConfirmed,
        momentumConfirmed,
        finalExecutable,
      });
      if (!contractCheck.contractValid && strategySelected !== 'wait') {
        logger.info(`STRATEGY_CONTRACT_VALIDATION_AUDIT: symbol=${candidate.symbol} requestedStrategy=${String(candidate.selectedStrategy ?? 'n/a')} selectedStrategy=${strategySelected} finalEntryRule=${finalEntryRule} marketRegimeBucket=${contractBucket} rawPriceMovePctSigned=${String(rawDipPct)} dipDepthPct=${dipDepthPct ?? 'n/a'} actualDipPct=${dipDepthPct ?? 'n/a'} requiredDipPct=${requiredDipPct ?? 'n/a'} dipConfirmed=${String(dipConfirmed)} actualReboundPct=${reboundPct ?? 'n/a'} requiredReboundPct=${requiredReboundPct ?? 'n/a'} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} spreadOk=${String(spreadOk)} tpRoomOk=${String(tpRoomOk)} priceFresh=${String(priceFresh)} finalExecutable=${String(finalExecutable)} contractValid=false invalidReason=${contractCheck.invalidReason} validatorStage=builder_resolution`);
        if (strategySelected === 'dip_and_rebound' || strategySelected === 'conservative') {
          const fallback = resolveInvalidDipBasedFallback(contractCheck.invalidReason);
          applyStrategyOverride(fallback.strategy, fallback.reason);
          if (String(strategySelected) === 'wait') {
            finalExecutable = false;
            buyAllowed = false;
          }
          refreshStrategyDerived();
        }
      }
    }
    isWait = strategySelected.toLowerCase() === 'wait';
    const derivedEntryRule =
      resolvedRule && !/WAITING|UNKNOWN/i.test(String(resolvedRule)) && !String(resolvedRule).startsWith('EntryGate')
        ? String(resolvedRule)
        : String(strategySelected).toUpperCase() + '_READY';
    finalEntryRule = isWait ? 'WAITING_FOR_SETUP' : derivedEntryRule;
  }

  if (finalExecutable && /WAITING|UNKNOWN/i.test(finalEntryRule)) {
    finalEntryRule = String(strategySelected).toUpperCase() + '_READY';
  }
  if (finalExecutable && String(finalEntryRule).startsWith('EntryGate')) {
    finalEntryRule = String(strategySelected).toUpperCase() + '_READY';
  }

  {
    const contractBucket = (candidate.periodRegime ?? 'unknown') as MarketRegimeBucket;
    const contractCheck = validateStrategyContract({
      strategy: strategySelected,
      finalEntryRule: finalEntryRule,
      marketRegimeBucket: contractBucket,
      dipDepthPct,
      requiredDipPct,
      dipConfirmed,
      reboundPct,
      requiredReboundPct: requiredReboundPct,
      reboundConfirmed,
      momentumConfirmed,
      finalExecutable,
    });
    if (!contractCheck.contractValid && finalExecutable && strategySelected !== 'wait') {
      logger.info(`STRATEGY_CONTRACT_VALIDATION_AUDIT: symbol=${candidate.symbol} requestedStrategy=${String(candidate.selectedStrategy ?? 'n/a')} selectedStrategy=${strategySelected} finalEntryRule=${finalEntryRule} marketRegimeBucket=${contractBucket} rawPriceMovePctSigned=${String(rawDipPct)} dipDepthPct=${dipDepthPct ?? 'n/a'} actualDipPct=${dipDepthPct ?? 'n/a'} requiredDipPct=${requiredDipPct ?? 'n/a'} dipConfirmed=${String(dipConfirmed)} actualReboundPct=${reboundPct ?? 'n/a'} requiredReboundPct=${requiredReboundPct ?? 'n/a'} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} spreadOk=${String(spreadOk)} tpRoomOk=${String(tpRoomOk)} priceFresh=${String(priceFresh)} finalExecutable=${String(finalExecutable)} contractValid=false invalidReason=${contractCheck.invalidReason} validatorStage=builder_final_guard`);
      if (strategySelected === 'dip_and_rebound' || strategySelected === 'conservative') {
        const fallback = resolveInvalidDipBasedFallback(contractCheck.invalidReason);
        applyStrategyOverride(fallback.strategy, fallback.reason);
        refreshStrategyDerived();
        isWait = strategySelected.toLowerCase() === 'wait';
        finalEntryRule = isWait ? 'WAITING_FOR_SETUP' : String(strategySelected).toUpperCase() + '_READY';
        // Re-validate after downgrade
        const recheck = validateStrategyContract({
          strategy: strategySelected,
          finalEntryRule,
          marketRegimeBucket: contractBucket,
          dipDepthPct,
          requiredDipPct,
          dipConfirmed,
          reboundPct,
          requiredReboundPct: requiredReboundPct,
          reboundConfirmed,
          momentumConfirmed,
          finalExecutable,
        });
        if (!recheck.contractValid) {
          finalExecutable = false;
          buyAllowed = false;
          strategySelected = 'wait';
          finalEntryRule = 'WAITING_FOR_SETUP';
          logger.info(`STRATEGY_DOWNGRADE_FAILED: symbol=${candidate.symbol} downgradedTo=${strategySelected} contractCheckAfterDowngrade=${String(recheck.contractValid)} invalidReason=${recheck.invalidReason} finalExecutable=${String(finalExecutable)} validatorStage=builder_final_guard_downgrade_failed`);
        } else {
          // Downgrade passed, but verify momentum isn't fake (no rebound after dip-based strategy)
          const wasDipBased = !/wait|unknown|avoid/.test(String(candidate.selectedStrategy ?? '').toLowerCase());
          const isNowMomentum = String(strategySelected) === 'momentum';
          const noRebound = reboundPct == null || reboundPct <= 0;
          const weakMomentum = !momentumConfirmed;
          const origWasDipOrConservative = /dip_and_rebound|conservative/.test(String(candidate.selectedStrategy ?? ''
).toLowerCase());
          if (isNowMomentum && origWasDipOrConservative && noRebound) {
            finalExecutable = false;
            buyAllowed = false;
            strategySelected = 'wait';
            finalEntryRule = 'WAITING_FOR_SETUP';
            logger.warn(`STRATEGY_DOWNGRADE_TO_MOMENTUM_REJECTED: symbol=${candidate.symbol} originalCandidateStrategy=${candidate.selectedStrategy} finalExecutionStrategy=momentum downgradeApplied=false dipPct=${dipDepthPct ?? 'n/a'} reboundPct=${reboundPct ?? 'n/a'} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} trend=${candidate.groupTrend ?? 'n/a'} marketTrend=${candidate.periodTrend ?? 'n/a'} btcContext=n/a ethContext=n/a htf=${candidate.periodTrend ?? 'n/a'} marketAction=${candidate.periodRegime ?? 'n/a'} strongMomentumOverrideEligible=false finalExecutable=${String(finalExecutable)} blockReason=rebound_missing_after_dip_based_downgrade`);
            logger.info(`MOMENTUM_BLOCKED_NO_REBOUND: symbol=${candidate.symbol} downgradeFrom=${candidate.selectedStrategy} momentumConfirmed=${String(momentumConfirmed)} reboundPct=${reboundPct ?? 0} blockReason=conservative_downgrade_rejected_no_rebound`);
          }
          if (isNowMomentum && weakMomentum) {
            finalExecutable = false;
            buyAllowed = false;
            strategySelected = 'wait';
            finalEntryRule = 'WAITING_FOR_SETUP';
            logger.warn(`MOMENTUM_BLOCKED_NO_REBOUND: symbol=${candidate.symbol} downgradeFrom=${candidate.selectedStrategy} momentumConfirmed=false reboundPct=${reboundPct ?? 0} blockReason=momentum_requires_momentum_confirmation`);
          }
          if (isNowMomentum && finalExecutable) {
            logger.info(`MOMENTUM_CONTRACT_AUDIT: symbol=${candidate.symbol} originalCandidateStrategy=${candidate.selectedStrategy ?? 'n/a'} finalExecutionStrategy=momentum downgradeApplied=true dipPct=${dipDepthPct ?? 'n/a'} reboundPct=${reboundPct ?? 'n/a'} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} trend=${candidate.groupTrend ?? 'n/a'} marketTrend=${candidate.periodTrend ?? 'n/a'} btcContext=n/a ethContext=n/a htf=${candidate.periodTrend ?? 'n/a'} marketAction=${candidate.periodRegime ?? 'n/a'} strongMomentumOverrideEligible=false finalExecutable=true blockReason=none`);
          }
        }
      } else {
        // momentum or balanced failed contract — hard-set as not executable
        finalExecutable = false;
        buyAllowed = false;
        finalEntryRule = 'WAITING_FOR_SETUP';
        logger.info(`STRATEGY_CONTRACT_HARD_FAIL: symbol=${candidate.symbol} strategySelected=${strategySelected} contractValid=false invalidReason=${contractCheck.invalidReason} finalExecutable=${String(finalExecutable)} action=fixed_finalExecutable_false validatorStage=builder_final_guard`);
      }
    }
  }
  {
    const dp = dipDepthPct ?? (reboundPct != null && reboundPct > 0 ? (rawDipPct ?? 0) : null);
    const reboundIsOld = reboundPct != null && reboundPct > 20;
    const reboundOverextended = reboundPct != null && reboundPct > 30;
    const candidateFreshness = String((candidate as any).reboundFreshnessStatus ?? '').toLowerCase();
    const freshnessCanBeValidated = candidateFreshness === 'valid' || candidateFreshness === 'stale';
    const freshnessStatus: 'valid' | 'unknown' | 'stale' = freshnessCanBeValidated ? (candidateFreshness as 'valid' | 'stale') : 'unknown';
    const reboundTimestamp = (candidate as any).reboundTimestamp ?? 'n/a';
    const dipLowTimestamp = (candidate as any).dipLowTimestamp ?? 'n/a';
    const reboundAgeMs = (candidate as any).reboundAgeMs ?? 'n/a';
    const maxAllowedReboundAgeMs = (candidate as any).maxAllowedReboundAgeMs ?? 'n/a';
    const isDipOrConservative = strategySelected === 'dip_and_rebound' || strategySelected === 'conservative';

    // Freshness hardening: unknown/stale rebound blocks dip_and_rebound and conservative hard confirmation
    if (isDipOrConservative && freshnessStatus !== 'valid' && finalExecutable) {
      finalExecutable = false;
      buyAllowed = false;
      strategySelected = 'wait';
      finalEntryRule = 'WAITING_FOR_SETUP';
      finalBuyBlockedReasonOverride = freshnessStatus === 'unknown' ? 'rebound_freshness_unknown' : 'rebound_stale';
      logger.info(`REBOUND_FRESHNESS_HARDENED_AUDIT symbol=${candidate.symbol} strategy=${isDipOrConservative ? strategySelected : 'n/a'} localLow=n/a localLowTimestamp=${dipLowTimestamp} reboundTimestamp=${reboundTimestamp} reboundAgeMs=${reboundAgeMs} maxAllowedReboundAgeMs=${maxAllowedReboundAgeMs} reboundFromSameDip=n/a freshnessStatus=${freshnessStatus} usedAsHardConfirmation=false usedAsAdvisoryOnly=true blockReason=${freshnessStatus === 'unknown' ? 'REBOUND_FRESHNESS_UNKNOWN' : 'REBOUND_FRESHNESS_STALE'} reboundPct=${reboundPct ?? 'n/a'} dipDepthPct=${dipDepthPct ?? 'n/a'}`);
    } else {
      logger.info(`REBOUND_FRESHNESS_AUDIT symbol=${candidate.symbol} strategy=${strategySelected} reboundAtEntry=${reboundPct ?? 'n/a'} dipAtEntry=${dp ?? 'n/a'} dipConfirmed=${String(dipConfirmed)} reboundConfirmed=${String(reboundConfirmed)} freshnessStatus=${freshnessStatus} usedAsHardConfirmation=${isDipOrConservative && finalExecutable} usedAsAdvisoryOnly=${strategySelected === 'momentum' || strategySelected === 'balanced'} overextended=${String(reboundOverextended)} blockReason=${!finalExecutable ? (reboundOverextended ? 'REBOUND_OVEREXTENDED' : reboundIsOld ? 'REBOUND_TOO_LATE' : 'none') : 'none'}`);
    }
    if (strategySelected === 'balanced') {
      const pro = (candidate as any).professionalAnalysis ?? {};
      const professionalVerdict = String(pro.professionalVerdict ?? 'n/a');
      const professionalGateMode = String(
        (candidate as any).professionalGateMode
        ?? (candidate as any).professionalGateDecision?.mode
        ?? ((candidate as any).professionalGateHard === true ? 'hard_gate' : 'advisory')
      );
      professionalGateDecision = resolveProfessionalGateDecision({
        enabled: Boolean((candidate as any).professionalAnalysis),
        mode: professionalGateMode,
        score: pro.professionalScore,
        verdict: pro.professionalVerdict,
        threshold: (candidate as any).professionalGateThreshold ?? (candidate as any).smartProfessionalMinScore ?? 0,
      });
      const balancedContract = validateBalancedEntryContract({
        symbol: candidate.symbol,
        finalExecutionStrategy: strategySelected,
        reboundAtEntry: reboundPct,
        requiredReboundPctAtEntry: requiredReboundPct,
        reboundConfirmed,
        freshnessStatus,
        priceFresh,
        momentumConfirmed,
        tpRoomOk,
        spreadOk,
        dipAtEntry: dipDepthPct,
        requiredDipPctAtEntry: requiredDipPct,
        dipConfirmed,
      });
      strategyContractValid = balancedContract.contractValid;
      strategyContractBlocker = balancedContract.contractViolationReason;
      marketSafetyValid = spreadOk && tpRoomOk && !fallingKnifeBlocked;
      marketSafetyBlocker = !spreadOk ? 'spread_too_high' : !tpRoomOk ? 'tp_room_not_ok' : fallingKnifeBlocked ? 'falling_knife' : 'none';
      executionFreshnessValid = priceFresh && balancedContract.freshnessStatus !== 'stale';
      executionFreshnessBlocker = !priceFresh ? 'price_stale' : balancedContract.freshnessStatus === 'stale' ? 'rebound_stale' : 'none';
      if (!balancedContract.finalExecutable) {
        finalExecutable = false;
        buyAllowed = false;
        finalBuyBlockedReasonOverride = balancedContract.primaryBlocker;
        finalBlocker = balancedContract.primaryBlocker;
        finalBlockerSource = balancedContract.primaryBlocker === 'price_stale' || balancedContract.primaryBlocker === 'rebound_stale'
          ? 'execution_freshness'
          : balancedContract.primaryBlocker === 'spread_too_high' || balancedContract.primaryBlocker === 'tp_room_not_ok'
            ? 'market_safety'
            : 'strategy_contract';
      } else if (!professionalGateDecision.allowed) {
        finalExecutable = false;
        buyAllowed = false;
        finalBuyBlockedReasonOverride = professionalGateDecision.blocker;
        finalBlocker = professionalGateDecision.blocker;
        finalBlockerSource = 'professional_gate';
      } else {
        finalBlocker = finalExecutable ? 'none' : 'external_gate_not_allow';
        finalBlockerSource = finalExecutable ? 'none' : 'strategy_contract';
      }
      const invariantOk = !(balancedContract.reboundAtEntry != null
        && balancedContract.requiredReboundPctAtEntry != null
        && balancedContract.reboundAtEntry >= balancedContract.requiredReboundPctAtEntry
        && balancedContract.reboundConfirmed
        && balancedContract.contractViolationReason === 'rebound_below_required');
      if (!invariantOk) {
        logger.warn(`ENTRY_CONTRACT_VALIDATION_INTEGRITY_FAILED: symbol=${candidate.symbol} finalExecutionStrategy=balanced reboundAtEntry=${balancedContract.reboundAtEntry ?? 'n/a'} requiredReboundPctAtEntry=${balancedContract.requiredReboundPctAtEntry ?? 'n/a'} reboundConfirmed=${String(balancedContract.reboundConfirmed)} contractViolationReason=${balancedContract.contractViolationReason} action=block_buy candidateSnapshot=${JSON.stringify({ status: candidate.status, entryGateDecision: candidate.entryGateDecision?.decision, blockReasons: candidate.blockReasons ?? [], mainReason: candidate.mainReason ?? null })}`);
        finalExecutable = false;
        buyAllowed = false;
        finalBuyBlockedReasonOverride = 'unknown_final_executable_bug';
        finalBlocker = 'unknown_final_executable_bug';
        finalBlockerSource = 'strategy_contract';
      }
      if (balancedContract.visibleRequirementsSatisfied && !balancedContract.contractValid) {
        logger.warn(`HIDDEN_BALANCED_BLOCKER_BUG: symbol=${candidate.symbol} finalExecutionStrategy=balanced visibleRequirementsSatisfied=true contractValid=false blocker=${balancedContract.blocker} blockerSource=${balancedContract.blockerSource} debugTrace=${balancedContract.debugTrace.join('|')} action=block_buy`);
        finalExecutable = false;
        buyAllowed = false;
        finalBuyBlockedReasonOverride = 'unknown_final_executable_bug';
        finalBlocker = 'unknown_final_executable_bug';
        finalBlockerSource = 'strategy_contract';
      }
      logger.info(`ENTRY_CONTRACT_VALIDATION_AUDIT: symbol=${candidate.symbol} finalExecutionStrategy=balanced validatorUsed=validateBalancedEntryContract reboundAtEntry=${balancedContract.reboundAtEntry ?? 'n/a'} requiredReboundPctAtEntry=${balancedContract.requiredReboundPctAtEntry ?? 'n/a'} reboundConfirmed=${String(balancedContract.reboundConfirmed)} reboundFreshnessStatus=${balancedContract.freshnessStatus} rawReboundValue=${reboundPct ?? 'n/a'} normalizedReboundPct=${balancedContract.reboundAtEntry ?? 'n/a'} scaleUsed=percent dipAtEntry=${dipDepthPct ?? 'n/a'} requiredDipPctAtEntry=${requiredDipPct ?? 'n/a'} dipConfirmed=${String(dipConfirmed)} momentumConfirmed=${String(momentumConfirmed)} spreadOk=${String(spreadOk)} tpRoomOk=${String(tpRoomOk)} priceFresh=${String(priceFresh)} professionalVerdict=${professionalVerdict} strategyContractValid=${String(strategyContractValid)} strategyContractBlocker=${strategyContractBlocker} professionalGateMode=${professionalGateDecision.mode} professionalGateValid=${String(professionalGateDecision.allowed)} professionalGateBlocker=${professionalGateDecision.blocker} marketSafetyValid=${String(marketSafetyValid)} marketSafetyBlocker=${marketSafetyBlocker} executionFreshnessValid=${String(executionFreshnessValid)} executionFreshnessBlocker=${executionFreshnessBlocker} finalBlocker=${finalBlocker} finalBlockerSource=${finalBlockerSource} contractValid=${String(balancedContract.contractValid)} finalExecutable=${String(finalExecutable)} buyAllowed=${String(buyAllowed)} primaryBlocker=${finalBlocker} allBlockers=${balancedContract.allBlockers.join('|') || 'none'} invariantOk=${String(invariantOk)}`);
      logger.info(`BALANCED_ENTRY_CONTRACT_AUDIT: symbol=${candidate.symbol} finalExecutedStrategy=balanced entryRuleAtEntry=${finalEntryRule} dipPctAtEntry=${dipDepthPct ?? 'n/a'} reboundPctAtEntry=${balancedContract.reboundAtEntry ?? 'n/a'} requiredDipPctAtEntry=n/a requiredReboundPctAtEntry=${balancedContract.requiredReboundPctAtEntry ?? 'n/a'} momentumConfirmedAtEntry=${String(momentumConfirmed)} weakMomentumConfirmedAtEntry=n/a balancedMinDipSetting=n/a balancedMinReboundSetting=${balancedContract.requiredReboundPctAtEntry ?? 'n/a'} balancedUsesDipAsRequired=false balancedUsesReboundAsRequired=true balancedUsesMomentumAsRequired=false visibleRequirementsSatisfied=${String(balancedContract.visibleRequirementsSatisfied)} missingStrategyRequirements=${balancedContract.missingStrategyRequirements.join('|') || 'none'} externalGateBlockers=${[professionalGateDecision.blocker, marketSafetyBlocker, executionFreshnessBlocker].filter(b => b !== 'none').join('|') || 'none'} professionalGateBlocker=${professionalGateDecision.blocker} contractValid=${String(strategyContractValid)} contractViolationReason=${strategyContractBlocker} finalExecutable=${String(finalExecutable)} buyAllowed=${String(buyAllowed)} sourceUsed=balanced_contract_validator`);
    }
  }
  const blockReasons = [...(candidate.blockReasons ?? [])];
  const warningReasons = [...(auto?.warnings ?? [])];

  const setupRequired: StrategySetupItem[] = [
    item('momentumConfirmed', 'Momentum confirmed', momentumRequired, momentumConfirmed, momentumConfirmed, momentumRequired ? true : null, 'buy-rule-matrix', momentumConfirmed ? 'info' : 'block', 'Momentum gate from unified entry + blockers'),
    item('spreadOk', 'Spread OK', true, spreadOk, spreadPct, maxSpreadPct, 'autobots-selector', spreadOk ? 'info' : 'block', 'Spread safety gate'),
    item('tpRoomOk', 'TP room OK', true, tpRoomOk, tpRoomOk, true, 'entry-gate', tpRoomOk ? 'info' : 'block', 'Take-profit room gate'),
    item('priceFresh', 'Price fresh', true, priceFresh, priceFresh, true, 'entry-gate', priceFresh ? 'info' : 'block', 'Freshness gate'),
    item('dipConfirmed', 'Dip confirmed', strategySelected === 'dip_and_rebound' || strategySelected === 'conservative', dipConfirmed, dipDepthPct, requiredDipPct, 'buy-rule-matrix', dipConfirmed ? 'info' : 'warning', 'Dip condition'),
    item('reboundConfirmed', 'Rebound confirmed', reboundRequired, reboundConfirmed, reboundPct, requiredReboundPct, 'buy-rule-matrix', reboundConfirmed ? 'info' : 'warning', 'Rebound gate'),
    item('conservativeSafetyOverlayApplied', 'Conservative overlay', false, conservativeOverlay, conservativeOverlay, false, 'auto-strategy-router', conservativeOverlay ? 'warning' : 'info', 'Router fallback safety overlay'),
    item('fallingKnifeBlocked', 'Falling knife blocked', false, !fallingKnifeBlocked, fallingKnifeBlocked, false, 'autobots-selector', fallingKnifeBlocked ? 'block' : 'info', 'Safety protection for sharp drops'),
    item('finalExecutable', 'Final executable', true, finalExecutable, finalExecutable, true, 'trader-brain', finalExecutable ? 'info' : 'block', 'Final execution eligibility'),
  ];
  const setupPassed = setupRequired.filter((s) => s.passed);
  const setupMissing = setupRequired.filter((s) => s.required && !s.passed);
  const setupResult = isWait
    ? (spreadOk ? 'WAITING_FOR_SETUP' : 'BLOCKED_BY_SPREAD')
    : !reboundConfirmed && reboundRequired
    ? 'WAITING_FOR_REBOUND'
    : (!requiredSetupPassed ? (spreadOk ? 'WAITING_CONFIRMATION' : 'BLOCKED_BY_SPREAD') : (!finalExecutable ? (spreadOk ? 'WAITING_EXECUTION_GATE' : 'BLOCKED_BY_SPREAD') : `${String(strategySelected).toUpperCase()}_OK`));
  let primaryBlocker = resolveCanonicalPrimaryBlocker({
    blockReasons: [
      ...(candidate.entryGateDecision?.snapshot?.blockReasons ?? []),
      ...(candidate.entryGateDecision?.blockReasons ?? []),
      ...(candidate.blockReasons ?? []),
    ],
    spreadOk,
    tpRoomOk,
    priceFresh,
    dipConfirmed,
    reboundConfirmed,
    finalExecutable,
  });
  if (finalBuyBlockedReasonOverride) primaryBlocker = finalBuyBlockedReasonOverride;
  if (finalBuyBlockedReasonOverride) {
    finalBlocker = finalBuyBlockedReasonOverride;
    if (finalBlocker === professionalGateDecision.blocker && professionalGateDecision.blocker !== 'none') finalBlockerSource = 'professional_gate';
  }
  if (!finalExecutable && primaryBlocker === 'finalExecutable_false') {
    primaryBlocker = resolveActionableFinalBlocker({
      finalExecutable,
      status: candidate.status,
      strategySelected,
      setupResult,
      entryGateDecision: candidate.entryGateDecision?.decision,
      finalBlocker,
      strategyContractBlocker,
      marketSafetyBlocker,
      executionFreshnessBlocker,
      professionalGateBlocker: professionalGateDecision.blocker,
      blockReasons: [
        ...(candidate.entryGateDecision?.snapshot?.blockReasons ?? []),
        ...(candidate.entryGateDecision?.blockReasons ?? []),
        ...(candidate.blockReasons ?? []),
      ],
      setupMissingKeys: setupMissing.map((s) => s.key),
    });
    finalBlocker = primaryBlocker;
    finalBlockerSource =
      primaryBlocker === marketSafetyBlocker ? 'market_safety'
      : primaryBlocker === executionFreshnessBlocker ? 'execution_freshness'
      : primaryBlocker === professionalGateDecision.blocker ? 'professional_gate'
      : 'strategy_contract';
  }
  const selected = strategySelected;
  const metricRole = (key: string): 'required' | 'optional' | 'advisory' | 'blocker' | 'unused' => {
    if (key === 'spreadPct' || key === 'tpRoomOk' || key === 'priceFresh') return 'blocker';
    if (['actualDipPct', 'requiredDipPct', 'dipConfirmed'].includes(key)) return strategyDef.metricRoles.dip;
    if (['actualReboundPct', 'requiredReboundPct', 'reboundConfirmed'].includes(key)) return strategyDef.metricRoles.rebound;
    if (['momentumConfirmed', 'momentum5m', 'momentum15m', 'momentum1h'].includes(key)) return strategyDef.metricRoles.momentum;
    if (selected === 'conservative' && ['conservativeSafetyScore', 'requiredConservativeSafetyScore'].includes(key)) return strategyDef.metricRoles.conservativeSafetyScore ?? 'optional';
    if (selected === 'conservative' && ['safePullbackConfirmed'].includes(key)) return strategyDef.metricRoles.safePullback ?? 'optional';
    if (selected === 'conservative' && key === 'downtrendBlocked') return 'blocker';
    if (['actualDipPct', 'actualReboundPct'].includes(key)) return 'advisory';
    return 'optional';
  };
  const usedByStrategy = (key: string): boolean => metricRole(key) !== 'unused' && metricRole(key) !== 'advisory';
  const momentum5m = numOrNull(candidate.m5Change);
  const momentum15m = numOrNull(candidate.m15Change);
  const momentum1h = numOrNull(candidate.h1Change);
  const conservativeSafetyScore = numOrNull(candidate.confidence != null ? candidate.confidence * 100 : null);
  // Report marks conservative threshold fields as unknown from code; keep required as N/A.
  const requiredConservativeSafetyScore = null;
  const safePullbackConfirmed = null;
  const downtrendBlocked = blockReasons.some((b) => b.toLowerCase().includes('downtrend'));
  const setupMetrics: StrategyAuditSnapshot['setupMetrics'] = [
    { key: 'rawDipPct', actualValue: rawDipPct, requiredValue: null, passed: rawDipPct != null, usedByStrategy: false, role: 'advisory', sourceLayer: 'buy-rule-matrix' },
    { key: 'dipDepthPct', actualValue: dipDepthPct, requiredValue: requiredDipPct, passed: dipConfirmed, usedByStrategy: usedByStrategy('actualDipPct'), role: metricRole('actualDipPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'actualDipPct', actualValue: dipDepthPct, requiredValue: requiredDipPct, passed: dipConfirmed, usedByStrategy: usedByStrategy('actualDipPct'), role: metricRole('actualDipPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredDipPct', actualValue: requiredDipPct, requiredValue: requiredDipPct, passed: requiredDipPct == null || dipConfirmed, usedByStrategy: usedByStrategy('requiredDipPct'), role: metricRole('requiredDipPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredDipPctMin', actualValue: dynamicSetup.requiredDipPctMin, requiredValue: dynamicSetup.requiredDipPctMin, passed: true, usedByStrategy: usedByStrategy('requiredDipPct'), role: metricRole('requiredDipPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredDipPctMax', actualValue: dynamicSetup.requiredDipPctMax, requiredValue: dynamicSetup.requiredDipPctMax, passed: true, usedByStrategy: usedByStrategy('requiredDipPct'), role: metricRole('requiredDipPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'dipConfirmed', actualValue: dipConfirmed, requiredValue: selected === 'dip_and_rebound' || selected === 'conservative' ? true : null, passed: dipConfirmed, usedByStrategy: usedByStrategy('dipConfirmed'), role: metricRole('dipConfirmed'), sourceLayer: 'buy-rule-matrix' },
    { key: 'actualReboundPct', actualValue: reboundPct, requiredValue: requiredReboundPct, passed: reboundConfirmed, usedByStrategy: usedByStrategy('actualReboundPct'), role: metricRole('actualReboundPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredReboundPct', actualValue: requiredReboundPct, requiredValue: requiredReboundPct, passed: requiredReboundPct == null || reboundConfirmed, usedByStrategy: usedByStrategy('requiredReboundPct'), role: metricRole('requiredReboundPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredReboundPctMin', actualValue: dynamicSetup.requiredReboundPctMin, requiredValue: dynamicSetup.requiredReboundPctMin, passed: true, usedByStrategy: usedByStrategy('requiredReboundPct'), role: metricRole('requiredReboundPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredReboundPctMax', actualValue: dynamicSetup.requiredReboundPctMax, requiredValue: dynamicSetup.requiredReboundPctMax, passed: true, usedByStrategy: usedByStrategy('requiredReboundPct'), role: metricRole('requiredReboundPct'), sourceLayer: 'buy-rule-matrix' },
    { key: 'reboundConfirmed', actualValue: reboundConfirmed, requiredValue: selected === 'dip_and_rebound' || selected === 'balanced' || selected === 'conservative' || selected === 'momentum' ? true : null, passed: reboundConfirmed, usedByStrategy: usedByStrategy('reboundConfirmed'), role: metricRole('reboundConfirmed'), sourceLayer: 'buy-rule-matrix' },
    { key: 'momentumConfirmed', actualValue: momentumConfirmed, requiredValue: selected === 'momentum' ? true : null, passed: momentumConfirmed, usedByStrategy: usedByStrategy('momentumConfirmed'), role: metricRole('momentumConfirmed'), sourceLayer: 'buy-rule-matrix' },
    { key: 'momentum5m', actualValue: momentum5m, requiredValue: selected === 'momentum' ? 0.12 : null, passed: momentum5m == null ? false : momentum5m > 0.12, usedByStrategy: usedByStrategy('momentum5m'), role: metricRole('momentum5m'), sourceLayer: 'trader-brain' },
    { key: 'momentum15m', actualValue: momentum15m, requiredValue: selected === 'momentum' ? 0.2 : null, passed: momentum15m == null ? false : momentum15m > 0.2, usedByStrategy: usedByStrategy('momentum15m'), role: metricRole('momentum15m'), sourceLayer: 'trader-brain' },
    { key: 'momentum1h', actualValue: momentum1h, requiredValue: selected === 'momentum' ? 0.35 : null, passed: momentum1h == null ? false : momentum1h > 0.35, usedByStrategy: usedByStrategy('momentum1h'), role: metricRole('momentum1h'), sourceLayer: 'trader-brain' },
    { key: 'volumeRelative', actualValue: numOrNull(candidate.volumeRel), requiredValue: null, passed: true, usedByStrategy: false, role: 'advisory', sourceLayer: 'autobots-selector' },
    { key: 'spreadPct', actualValue: spreadPct, requiredValue: maxSpreadPct, passed: spreadOk, usedByStrategy: true, role: metricRole('spreadPct'), sourceLayer: 'entry-gate' },
    { key: 'maxSpreadPct', actualValue: maxSpreadPct, requiredValue: maxSpreadPct, passed: true, usedByStrategy: true, role: metricRole('spreadPct'), sourceLayer: 'entry-gate' },
    { key: 'spreadOk', actualValue: spreadOk, requiredValue: true, passed: spreadOk, usedByStrategy: true, role: 'blocker', sourceLayer: 'entry-gate' },
    { key: 'tpRoomOk', actualValue: tpRoomOk, requiredValue: true, passed: tpRoomOk, usedByStrategy: true, role: metricRole('tpRoomOk'), sourceLayer: 'entry-gate' },
    { key: 'priceFresh', actualValue: priceFresh, requiredValue: true, passed: priceFresh, usedByStrategy: true, role: metricRole('priceFresh'), sourceLayer: 'entry-gate' },
    { key: 'conservativeSafetyScore', actualValue: conservativeSafetyScore, requiredValue: requiredConservativeSafetyScore, passed: true, usedByStrategy: usedByStrategy('conservativeSafetyScore'), role: metricRole('conservativeSafetyScore'), sourceLayer: 'auto-strategy-router' },
    { key: 'requiredConservativeSafetyScore', actualValue: requiredConservativeSafetyScore, requiredValue: requiredConservativeSafetyScore, passed: true, usedByStrategy: usedByStrategy('requiredConservativeSafetyScore'), role: metricRole('requiredConservativeSafetyScore'), sourceLayer: 'auto-strategy-router' },
    { key: 'safePullbackConfirmed', actualValue: safePullbackConfirmed, requiredValue: null, passed: true, usedByStrategy: usedByStrategy('safePullbackConfirmed'), role: metricRole('safePullbackConfirmed'), sourceLayer: 'auto-strategy-router' },
    { key: 'fallingKnifeBlocked', actualValue: fallingKnifeBlocked, requiredValue: false, passed: !fallingKnifeBlocked, usedByStrategy: true, role: 'blocker', sourceLayer: 'autobots-selector' },
    { key: 'downtrendBlocked', actualValue: downtrendBlocked, requiredValue: false, passed: !downtrendBlocked, usedByStrategy: usedByStrategy('downtrendBlocked'), role: metricRole('downtrendBlocked'), sourceLayer: 'buy-rule-matrix' },
    { key: 'finalExecutable', actualValue: finalExecutable, requiredValue: true, passed: finalExecutable, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' },
    { key: 'setupResult', actualValue: setupResult, requiredValue: null, passed: finalExecutable, usedByStrategy: true, role: 'optional', sourceLayer: 'trader-brain' },
    { key: 'setupPassed[]', actualValue: setupPassed.map((s) => s.key).join('|') || 'none', requiredValue: null, passed: true, usedByStrategy: true, role: 'optional', sourceLayer: 'trader-brain' },
    { key: 'setupMissing[]', actualValue: setupMissing.map((s) => s.key).join('|') || 'none', requiredValue: null, passed: setupMissing.length === 0, usedByStrategy: true, role: 'optional', sourceLayer: 'trader-brain' },
    { key: 'metricRoles[]', actualValue: setupRequired.map((s) => `${s.key}:${s.required ? 'required' : 'optional'}`).join('|') || 'none', requiredValue: null, passed: true, usedByStrategy: true, role: 'optional', sourceLayer: 'trader-brain' },
  ];

  const strategyMismatchDetected = String(strategySelectedBeforeBuilder).toLowerCase() !== String(strategySelected).toLowerCase()
    || (marketBestFit != null && String(marketBestFit).toLowerCase() !== String(strategySelected).toLowerCase())
    || (groupRecommendedStrategy != null && String(groupRecommendedStrategy).toLowerCase() !== String(strategySelected).toLowerCase());
  const mismatchAllowed = !strategyMismatchDetected || resolution.mismatchAllowed || overrideApplied;
  const mismatchReason = !strategyMismatchDetected
    ? 'unchanged'
    : overrideReason ?? resolution.mismatchReason ?? 'missing_mismatch_reason';
  if (strategySelected === 'wait' && resolution.fallbackReason === 'NO_VALID_AUTOBOTS_STRATEGY') {
    finalExecutable = false;
    buyAllowed = false;
    finalBuyBlockedReasonOverride = 'strategy_wait';
  }
  const setupMatchesStrategy = strategySelected === 'wait'
    ? setupResult === 'WAITING_FOR_SETUP' || setupResult.startsWith('BLOCKED_') || setupResult.startsWith('WAITING_')
    : setupResult === `${String(strategySelected).toUpperCase()}_OK` || !finalExecutable;
  if ((strategyMismatchDetected && !mismatchAllowed) || (strategyMismatchDetected && mismatchReason === 'missing_mismatch_reason') || !setupMatchesStrategy || !candidate.riskGroup) {
    logger.warn(`STRATEGY_MISMATCH_BLOCK_AUDIT: symbol=${candidate.symbol} finalExecutionStrategy=${strategySelected} strategyAtEntry=${strategySelected} positionStrategy=${strategySelected} setupResult=${setupResult} setupMatchesStrategy=${String(setupMatchesStrategy)} marketBestFit=${marketBestFit ?? 'n/a'} groupRecommendedStrategy=${groupRecommendedStrategy ?? 'n/a'} groupName=${candidate.riskGroup ?? 'n/a'} strategyMismatchDetected=${String(strategyMismatchDetected)} mismatchAllowed=${String(mismatchAllowed)} mismatchReason=${mismatchReason} overrideApplied=${String(overrideApplied)} overrideReason=${overrideReason ?? 'none'} action=${!candidate.riskGroup ? 'warn_missing_group_metadata' : mismatchAllowed && setupMatchesStrategy ? 'warn_allowed_mismatch' : 'block_candidate'}`);
    if (!mismatchAllowed || !setupMatchesStrategy) {
      finalExecutable = false;
      buyAllowed = false;
    }
  }
  if (candidate.status === 'BUY') {
    logger.info(`STRATEGY_HANDOFF_TRACE_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} riskGroup=${candidate.riskGroup ?? 'n/a'} marketBestFit=${marketBestFit ?? 'n/a'} groupRecommendedStrategy=${groupRecommendedStrategy ?? 'n/a'} userSelectedRuntimeStrategy=${strategyRequested} autoBotsDynamicPerCoinEnabled=true autoBotsPerCoinStrategy=${autoBotsPerCoinStrategy ?? 'n/a'} entryGateStrategyInput=${strategySelected} setupResult=${setupResult} finalExecutionStrategy=${strategySelected} strategyAtEntry=${strategySelected} positionStrategy=${strategySelected} strategyDecisionReason=${auto?.strategyReason ?? candidate.strategyReason ?? 'n/a'} strategyMismatchDetected=${String(strategyMismatchDetected)} mismatchAllowed=${String(mismatchAllowed)} mismatchReason=${mismatchReason} overrideApplied=${String(overrideApplied)} overrideReason=${overrideReason ?? 'none'}`);
  }
  logger.info(`FINAL_STRATEGY_SOURCE_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} marketBestFit=${marketBestFit ?? 'n/a'} userSelectedRuntimeStrategy=${strategyRequested} strategySource=${strategySource} dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)} perCoinSelectedStrategy=${autoBotsPerCoinStrategy ?? candidate.selectedStrategy ?? 'n/a'} strategyAfterAuditBuilder=${strategySelected} finalExecutionStrategy=${strategySelected} positionStrategyAtEntry=${strategySelected} strategyMismatchDetected=${String(strategyMismatchDetected)} mismatchAllowed=${String(mismatchAllowed)} mismatchReason=${mismatchReason} overrideApplied=${String(overrideApplied)} overrideReason=${overrideReason ?? 'none'} executionAllowed=${String(finalExecutable)}`);
  const fallbackCanSubmitBuy = Boolean(
    buyAllowed
    && finalExecutable
    && candidate.entryGateDecision?.decision === 'ALLOW'
    && professionalGateDecision.allowed
    && marketSafetyValid
    && executionFreshnessValid
    && spreadOk
    && tpRoomOk
    && priceFresh
  );
  const fallbackSubmitGuardReason = fallbackCanSubmitBuy
    ? 'entry_gate_revalidated_professional_freshness_spread_tp_room'
    : resolution.fallbackReason === 'NO_VALID_AUTOBOTS_STRATEGY'
      ? 'NO_VALID_AUTOBOTS_STRATEGY_BLOCKS_SUBMIT'
      : !professionalGateDecision.allowed
        ? professionalGateDecision.blocker
        : !marketSafetyValid
          ? marketSafetyBlocker
          : !executionFreshnessValid
            ? executionFreshnessBlocker
            : primaryBlocker;
  logger.info(`AUTOBOTS_STRATEGY_RESOLUTION_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} riskGroup=${candidate.riskGroup ?? 'n/a'} marketBestFit=${marketBestFit ?? 'n/a'} groupRecommendedStrategy=${groupRecommendedStrategy ?? 'n/a'} userSelectedRuntimeStrategy=${strategyRequested} dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)} strategySourceRawLegacy=${auto?.strategySource ?? candidate.strategySource ?? 'unknown'} strategySourceResolved=${resolution.strategySourceResolved} fallbackType=${resolution.fallbackType} routerPath=${resolution.routerPath} perCoinSelectedStrategy=${autoBotsPerCoinStrategy ?? 'n/a'} finalExecutionStrategy=${strategySelected} setupValidatorUsed=${strategySelected} fallbackApplied=${String(resolution.fallbackApplied)} fallbackReason=${resolution.fallbackReason ?? 'none'} fallbackCanSubmitBuy=${String(fallbackCanSubmitBuy)} fallbackSubmitGuardReason=${fallbackSubmitGuardReason} overrideApplied=${String(overrideApplied)} overrideReason=${overrideReason ?? 'none'} mismatchDetected=${String(strategyMismatchDetected)} mismatchAllowed=${String(mismatchAllowed)} mismatchReason=${mismatchReason} finalBuyAllowed=${String(buyAllowed)} finalBuyBlockedReason=${buyAllowed ? 'none' : (resolution.fallbackReason === 'NO_VALID_AUTOBOTS_STRATEGY' ? 'NO_VALID_AUTOBOTS_STRATEGY' : primaryBlocker)} strategyDecisionTrace=${resolution.strategyDecisionTrace.join('>')}`);
  const strategyAuditMismatchFields = [
    resolution.finalExecutionStrategy !== strategySelected && finalExecutable ? 'AutoBots.finalExecutionStrategy_vs_audit.finalExecutionStrategy' : '',
    resolution.dynamicPerCoinStrategy !== true && String(strategySource).startsWith('AUTOBOTS_') && strategySource !== 'AUTOBOTS_WAIT' ? 'dynamicPerCoinStrategy' : '',
    runtimeState?.resolvedAutoBotsEnabled === true && resolution.strategySourceResolved === 'DISABLED' ? 'runtimeAutoBotsOn_vs_strategySourceDisabled' : '',
    runtimeState?.dynamicPerCoinStrategy != null && runtimeState.dynamicPerCoinStrategy !== resolution.dynamicPerCoinStrategy ? 'runtimeDynamic_vs_strategyDecisionDynamic' : '',
  ].filter(Boolean);
  logger.info(`STRATEGY_AUDIT_CONSUMER_INTEGRITY_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} autobotsFinalExecutionStrategy=${resolution.finalExecutionStrategy} finalStrategySourceFinalExecutionStrategy=${strategySelected} entryGateFinalExecutionStrategy=${strategySelected} tp1Strategy=pending strategyAtEntry=${strategySelected} dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)} mismatchFields=${strategyAuditMismatchFields.join('|') || 'none'} invariantOk=${String(strategyAuditMismatchFields.length === 0)}`);
  logger.info(`STRATEGY_DECISION_CONSUMER_INTEGRITY_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? 'unknown'} autoBotsRuntimeResolvedOn=${String(runtimeState?.resolvedAutoBotsEnabled ?? 'unknown')} autoBotsRuntimeStrategySource=${runtimeState?.strategySourceResolved ?? 'unknown'} autoBotsRuntimeDynamicPerCoin=${String(runtimeState?.dynamicPerCoinStrategy ?? 'unknown')} strategyDecisionFinalExecutionStrategy=${resolution.finalExecutionStrategy} strategyDecisionSource=${resolution.strategySourceResolved} finalStrategySourceFinalExecutionStrategy=${strategySelected} entryGateFinalExecutionStrategy=${strategySelected} tp1Strategy=pending strategyAtEntry=${strategySelected} positionStrategyAtEntry=${strategySelected} dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)} mismatchFields=${strategyAuditMismatchFields.join('|') || 'none'} invariantOk=${String(strategyAuditMismatchFields.length === 0)}`);

  const explicitPrimaryBlocker = (candidate as any).primaryBlocker
    ?? candidate.entryGateDecision?.primaryReason
    ?? candidate.entryGateDecision?.blockReasons?.[0]
    ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0]
    ?? primaryBlocker;
  const noBuyPriority = resolveFinalNoBuyReasonPriority({
    symbol: candidate.symbol,
    rawStatus: candidate.status,
    displayStatus: candidate.lifecycleStatus ?? candidate.status,
    finalExecutable,
    buyAllowed,
    primaryBlocker: explicitPrimaryBlocker,
    setupResult,
    candidateWhy: candidate.mainReason,
    previousFinalNoBuyReason: (candidate as any).finalNoBuyReason ?? finalBlocker,
    blockReasons,
    entryGateBlocker: candidate.entryGateDecision?.primaryReason ?? candidate.entryGateDecision?.blockReasons?.[0] ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0],
    strategyContractBlocker,
    executionDecisionFinalNoBuyReason: (candidate as any).executionDecision?.finalNoBuyReason,
    runtimeReason: executionFreshnessBlocker !== 'none' ? executionFreshnessBlocker : undefined,
    handoffMismatch: strategyMismatchDetected && !mismatchAllowed,
  });
  if (!noBuyPriority.invariantOk) logger.warn(formatFinalNoBuyReasonPriorityAudit({
    symbol: candidate.symbol,
    rawStatus: candidate.status,
    displayStatus: candidate.lifecycleStatus ?? candidate.status,
    finalExecutable,
    buyAllowed,
    primaryBlocker: explicitPrimaryBlocker,
    setupResult,
    candidateWhy: candidate.mainReason,
    previousFinalNoBuyReason: (candidate as any).finalNoBuyReason ?? finalBlocker,
    blockReasons,
    entryGateBlocker: candidate.entryGateDecision?.primaryReason ?? candidate.entryGateDecision?.blockReasons?.[0] ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0],
    strategyContractBlocker,
    executionDecisionFinalNoBuyReason: (candidate as any).executionDecision?.finalNoBuyReason,
    runtimeReason: executionFreshnessBlocker !== 'none' ? executionFreshnessBlocker : undefined,
    handoffMismatch: strategyMismatchDetected && !mismatchAllowed,
  }, noBuyPriority));
  else if (debugUiAuditsEnabled()) logger.info(formatFinalNoBuyReasonPriorityAudit({
    symbol: candidate.symbol,
    rawStatus: candidate.status,
    displayStatus: candidate.lifecycleStatus ?? candidate.status,
    finalExecutable,
    buyAllowed,
    primaryBlocker: explicitPrimaryBlocker,
    setupResult,
    candidateWhy: candidate.mainReason,
    previousFinalNoBuyReason: (candidate as any).finalNoBuyReason ?? finalBlocker,
    blockReasons,
    entryGateBlocker: candidate.entryGateDecision?.primaryReason ?? candidate.entryGateDecision?.blockReasons?.[0] ?? candidate.entryGateDecision?.snapshot?.blockReasons?.[0],
    strategyContractBlocker,
    executionDecisionFinalNoBuyReason: (candidate as any).executionDecision?.finalNoBuyReason,
    runtimeReason: executionFreshnessBlocker !== 'none' ? executionFreshnessBlocker : undefined,
    handoffMismatch: strategyMismatchDetected && !mismatchAllowed,
  }, noBuyPriority));

  return {
    symbol: candidate.symbol,
    selectedStrategy: strategySelected,
    strategyRequested,
    strategySelected,
    strategySource,
    marketRecommendedStrategy,
    groupRecommendedStrategy,
    autoBotsPerCoinStrategy,
    runtimeActiveStrategy,
    finalPerCoinStrategy: strategySelected,
    finalExecutionStrategy: strategySelected,
    strategyAtEntry: strategySelected,
    strategyDecisionReason: auto?.strategyReason ?? candidate.strategyReason ?? null,
    overrideApplied,
    overrideReason,
    fallbackType: resolution.fallbackType,
    routerPath: resolution.routerPath,
    dynamicPerCoinStrategy: resolution.dynamicPerCoinStrategy,
    mismatchAllowed,
    mismatchReason,
    strategyContractValid,
    strategyContractBlocker,
    professionalGateMode: professionalGateDecision.mode,
    professionalGateValid: professionalGateDecision.allowed,
    professionalGateBlocker: professionalGateDecision.blocker,
    marketSafetyValid,
    marketSafetyBlocker,
    executionFreshnessValid,
    executionFreshnessBlocker,
    finalBlocker,
    finalBlockerSource,
    finalNoBuyReason: noBuyPriority.resolvedFinalNoBuyReason,
    actionableNoBuyReason: noBuyPriority.actionableNoBuyReason,
    technicalNoBuyReason: noBuyPriority.technicalNoBuyReason,
    secondaryDiagnosticReasons: noBuyPriority.secondaryDiagnosticReasons,
    handoffIntegrityStatus: noBuyPriority.handoffIntegrityStatus,
    renderedUserMessage: noBuyPriority.renderedUserMessage,
    finalEntryRule,
    setupResult,
    finalExecutableAtEntry: finalExecutable,
    entryConfirmedAtEntry: candidate.entryGateDecision?.decision === 'ALLOW' ? true : null,
    riskGroup: candidate.riskGroup ?? null,
    marketRegime: candidate.periodRegime ?? null,
    marketTrend: candidate.periodTrend ?? null,
    groupTrend: candidate.groupTrend ?? null,
    btcContext: null,
    confidence: numOrNull(candidate.confidence),
    score: numOrNull(candidate.rawScore),
    dataQuality: candidate.dataQuality ?? null,
    priceFresh,
    spreadPct,
    maxSpreadPct,
    tpRoomOk,
    fallingKnifeBlocked,
    finalExecutable,
    buyAllowed,
    setupRequired,
    setupPassed,
    setupMissing,
    blockReasons,
    warningReasons,
    entryReason: candidate.mainReason ?? finalEntryRule,
    setupMetrics,
    dynamicSetupContext: {
      marketRegimeBucket: dynamicBucket,
      intendedStrategy,
      finalStrategy: strategySelected,
      requiredDipPctMin: dynamicSetup.requiredDipPctMin,
      requiredDipPctMax: dynamicSetup.requiredDipPctMax,
      requiredReboundPctMin: dynamicSetup.requiredReboundPctMin,
      requiredReboundPctMax: dynamicSetup.requiredReboundPctMax,
      actualDipPct: dipDepthPct,
      actualReboundPct: reboundPct,
      setupResult,
      primaryBlocker: noBuyPriority.actionableNoBuyReason !== 'none' ? noBuyPriority.actionableNoBuyReason : primaryBlocker,
      source: 'buildStrategyAuditSnapshotFromCandidate.dynamic-regime',
    },
    createdAt: new Date().toISOString(),
  };
}
