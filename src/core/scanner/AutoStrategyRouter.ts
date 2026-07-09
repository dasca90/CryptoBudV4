import type { AutoStrategyName, StrategyConfidenceTier, StrategySourceOwner, StrategySourceDetail } from '../types';
import type { AutoStrategyDecision } from '../types';
import { logger } from '../../utils/logger';
import {
  STRATEGY_CONTRACTS,
  type ExecutableStrategy,
  type MarketRegimeBucket,
  getRequiredDipForContract,
  getRequiredReboundForContract,
} from '../strategy-audit/strategy-contracts';
export type { AutoStrategyName, StrategyConfidenceTier, AutoStrategyDecision };

export type GroupTrendInput = 'bullish' | 'bearish' | 'bearish_or_unsafe' | 'sideways' | 'waiting_for_rebound' | 'caution';

export interface AutoStrategyRouterInput {
  symbol: string;
  riskGroup: string;
  referencePeriod: string;
  groupTrend: GroupTrendInput;
  groupRecommendedStrategy: AutoStrategyName;
  groupEnabled: boolean;
  candidateStatus: string;
  confidence: number;
  dipPct: number;
  reboundPct: number;
  momentumPct: number;
  volumeRelative: number;
  spreadPct: number;
  tpRoomOk: boolean;
  priceFresh: boolean;
  fallingKnife: boolean;
  overextended: boolean;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  mlBadEntryRisk: boolean;
  mlWinProbability: number;
  recentLossStreak: number;
  userStrategyMode: string;
  blockReasons: string[];
  manualSelectedStrategy?: string;
  takeoverModeActive?: boolean;
  takeoverValidated?: boolean;
  takeoverSelectedStrategy?: AutoStrategyName;
  marketAnalyzerBestFit?: AutoStrategyName | null;
}

export interface AutoBotsFinalStrategyCandidate {
  symbol: string;
  candidateId?: string | null;
  riskGroup?: string | null;
  groupTrend?: string | null;
  groupRecommendedStrategy?: AutoStrategyName | string | null;
  selectedStrategy?: AutoStrategyName | string | null;
  effectiveStrategy?: AutoStrategyName | string | null;
  strategySource?: string | null;
  strategySourceDetail?: string | null;
  strategyReason?: string | null;
  marketAnalyzerBestFit?: AutoStrategyName | string | null;
  marketBestFit?: AutoStrategyName | string | null;
  perCoinSelectedStrategy?: AutoStrategyName | string | null;
  autoBotsPerCoinStrategy?: AutoStrategyName | string | null;
  autoStrategyDecision?: Partial<AutoStrategyDecision> | null;
  runtimeSnapshot?: unknown;
  strategyDecision?: unknown;
  professionalGateMode?: 'advisory' | 'hard_gate' | string;
  professionalGateHard?: boolean;
  professionalAnalysis?: unknown;
  dipPercent?: number | null;
  reboundPercent?: number | null;
  reboundAtEntry?: number | null;
  reboundConfirmed?: boolean | null;
  reboundFreshnessStatus?: 'valid' | 'unknown' | 'stale' | string | null;
  momentumConfirmed?: boolean | null;
  weakMomentumConfirmed?: boolean | null;
  m5Change?: number | null;
  m15Change?: number | null;
  h1Change?: number | null;
  spreadOk?: boolean | null;
  spreadPct?: number | null;
  tpRoomOk?: boolean | null;
  priceFresh?: boolean | null;
  bookFresh?: boolean | null;
  volumeRel?: number | null;
  candleExhaustion?: boolean | null;
  overextended?: boolean | null;
  blockReasons?: string[];
  mlBadEntryRisk?: boolean | null;
  mlWinProbability?: number | null;
}

export interface AutoBotsMarketVerdictInput {
  marketBestFit?: AutoStrategyName | string | null;
}

export interface AutoBotsGroupVerdictInput {
  groupRecommendedStrategy?: AutoStrategyName | string | null;
  groupTrend?: string | null;
  groupConfidence?: number | null;
}

export interface AutoBotsRuntimeSettingsInput {
  autoBotsOn?: boolean;
  dynamicPerCoinStrategy?: boolean;
  userSelectedRuntimeStrategy?: AutoStrategyName | string | null;
  manualOverrideActive?: boolean;
}

export interface AutoBotsSmartStrategyEvaluation {
  strategy: ExecutableStrategy;
  eligible: boolean;
  requiredConditions: string[];
  passedConditions: string[];
  failedConditions: string[];
  blocker: string;
  confidence: number;
}

export interface AutoBotsSmartStrategyDecision {
  symbol: string;
  scanId: string;
  riskGroup: string | null;
  smartEnabled: boolean;
  professionalMode: 'advisory' | 'hard_gate';
  professionalScore: number | null;
  professionalVerdict: string;
  professionalBlockers: string[];
  evaluatedStrategies: AutoBotsSmartStrategyEvaluation[];
  selectedStrategy: ExecutableStrategy | null;
  selectionReason: string;
  noValidStrategyReason: string | null;
  noValidStrategyTrace: string[];
  finalExecutionStrategy: AutoStrategyName;
  setupValidatorUsed: AutoStrategyName;
  strategySourceResolved: AutoBotsResolvedStrategySource;
  routerPath: string;
  invariantOk: boolean;
  failureReason: string;
}

export type AutoBotsResolvedStrategySource =
  | 'AUTOBOTS_DYNAMIC'
  | 'AUTOBOTS_GROUP_FALLBACK'
  | 'AUTOBOTS_MARKET_FALLBACK'
  | 'AUTOBOTS_WAIT'
  | 'UNICORN_HUNTER'
  | 'MANUAL'
  | 'SCANNER_ADVISORY'
  | 'DISABLED';

export type AutoBotsFallbackType =
  | 'NONE'
  | 'GROUP_RECOMMENDATION'
  | 'MARKET_BEST_FIT'
  | 'WAIT'
  | 'MANUAL_INVALID'
  | 'GROUP_CONSTRAINT';

export interface AutoBotsFinalStrategyResolution {
  symbol: string;
  riskGroup: string | null;
  groupTrend: string | null;
  groupRecommendedStrategy: AutoStrategyName | null;
  groupConfidence: number | null;
  marketBestFit: AutoStrategyName | null;
  userSelectedRuntimeStrategy: AutoStrategyName | null;
  dynamicPerCoinStrategy: boolean;
  perCoinSelectedStrategy: AutoStrategyName | null;
  finalExecutionStrategy: AutoStrategyName;
  strategySourceResolved: AutoBotsResolvedStrategySource;
  fallbackApplied: boolean;
  fallbackType: AutoBotsFallbackType;
  fallbackReason: string | null;
  overrideApplied: boolean;
  overrideReason: string | null;
  mismatchAllowed: boolean;
  mismatchReason: string;
  routerPath: string;
  strategyDecisionTrace: string[];
  evaluatedStrategies: AutoBotsSmartStrategyEvaluation[];
  selectedStrategy: AutoStrategyName | null;
  selectionReason: string | null;
  noValidStrategyReason: string | null;
  noValidStrategyTrace: string[];
  fallbackCanSubmitBuy: boolean;
  fallbackSubmitGuardReason: string;
}

function normalizeAutoStrategy(value: unknown): AutoStrategyName | null {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'conservative' || s === 'balanced' || s === 'momentum' || s === 'dip_and_rebound' || s === 'wait' || s === 'avoid') {
    return s as AutoStrategyName;
  }
  return null;
}

function isExecutableAutoStrategy(value: AutoStrategyName | null | undefined): value is AutoStrategyName {
  return value === 'conservative' || value === 'balanced' || value === 'momentum' || value === 'dip_and_rebound';
}

function isHighRiskGroup(riskGroup: string | null): boolean {
  return riskGroup === 'high_risk' || riskGroup === 'very_high_risk';
}

function resolveMarketRegimeBucket(candidate: AutoBotsFinalStrategyCandidate, groupTrend: string | null): MarketRegimeBucket {
  const trend = String(groupTrend ?? candidate.groupTrend ?? candidate.autoStrategyDecision?.groupTrend ?? '').toLowerCase();
  const reasons = (candidate.blockReasons ?? []).map((r) => String(r).toLowerCase()).join('|');
  if (trend.includes('bullish')) return 'bullish_selective';
  if (trend.includes('bearish') || trend.includes('risk_off') || reasons.includes('risk_off')) return 'bearish_risk_off';
  if (trend.includes('sideways') || trend.includes('caution') || trend.includes('range')) return 'sideways_range';
  return 'unknown';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractProfessional(candidate: AutoBotsFinalStrategyCandidate): {
  score: number | null;
  verdict: string;
  blockers: string[];
  mode: 'advisory' | 'hard_gate';
  hardAllowed: boolean;
  hardBlocker: string | null;
} {
  const analysis = (candidate.professionalAnalysis ?? {}) as Record<string, unknown>;
  const score = finiteNumber(analysis.professionalScore ?? analysis.score ?? (candidate as any).professionalScore);
  const verdict = String(analysis.professionalVerdict ?? analysis.verdict ?? (candidate as any).professionalVerdict ?? 'UNKNOWN').toUpperCase();
  const rawBlockers = analysis.professionalBlockers ?? analysis.blockers ?? (candidate as any).professionalBlockers ?? [];
  const blockers = Array.isArray(rawBlockers) ? rawBlockers.map((b) => String(b)).filter(Boolean) : [];
  const mode = String(candidate.professionalGateMode ?? (candidate.professionalGateHard === true ? 'hard_gate' : 'advisory')).toLowerCase() === 'hard_gate' ? 'hard_gate' : 'advisory';
  let hardBlocker: string | null = null;
  if (mode === 'hard_gate') {
    if (verdict === 'WAIT') hardBlocker = 'PROFESSIONAL_VERDICT_WAIT';
    else if (verdict === 'AVOID') hardBlocker = 'PROFESSIONAL_VERDICT_AVOID';
    else if (blockers.length > 0) hardBlocker = `PROFESSIONAL_BLOCKERS:${blockers.join('|')}`;
  }
  return { score, verdict, blockers, mode, hardAllowed: hardBlocker == null, hardBlocker };
}

function condition(name: string, passed: boolean, failed: string[], passedList: string[], required: string[]): void {
  required.push(name);
  if (passed) passedList.push(name);
  else failed.push(name);
}

export function resolveAutoBotsSmartStrategy(
  candidate: AutoBotsFinalStrategyCandidate,
  context: {
    marketVerdict?: AutoBotsMarketVerdictInput;
    groupVerdict?: AutoBotsGroupVerdictInput;
    runtimeSettings?: AutoBotsRuntimeSettingsInput;
  } = {},
): AutoBotsSmartStrategyDecision {
  const groupTrend = (context.groupVerdict?.groupTrend ?? candidate.groupTrend ?? String(candidate.autoStrategyDecision?.groupTrend ?? '')) || null;
  const riskGroup = candidate.riskGroup ?? null;
  const professional = extractProfessional(candidate);
  const bucket = resolveMarketRegimeBucket(candidate, groupTrend);
  const blockReasons = (candidate.blockReasons ?? []).map((r) => String(r).toLowerCase());
  const hasReason = (needle: string) => blockReasons.some((r) => r.includes(needle));
  const dipRaw = finiteNumber(candidate.dipPercent ?? (candidate as any).dipPct);
  const dipDepthPct = dipRaw == null ? null : Math.abs(dipRaw);
  const reboundPct = finiteNumber(candidate.reboundAtEntry ?? candidate.reboundPercent ?? (candidate as any).reboundPct);
  const spreadPct = finiteNumber(candidate.spreadPct);
  const spreadOk = candidate.spreadOk ?? (spreadPct == null ? true : spreadPct < 0.5);
  const tpRoomOk = candidate.tpRoomOk ?? !hasReason('tp_room');
  const priceFresh = candidate.priceFresh ?? !hasReason('stale');
  const bookFresh = candidate.bookFresh ?? true;
  const reboundConfirmed = candidate.reboundConfirmed ?? !hasReason('rebound');
  const reboundFreshnessStatus = String(candidate.reboundFreshnessStatus ?? 'valid').toLowerCase();
  const momentumConfirmed = candidate.momentumConfirmed ?? !hasReason('momentum');
  const overextended = candidate.overextended ?? hasReason('overextended');
  const candleExhaustion = candidate.candleExhaustion ?? hasReason('candle');
  const professionalGateAllowed = professional.mode === 'advisory'
    ? professional.blockers.length === 0 || professional.verdict === 'STRONG_BUY' || professional.verdict === 'BUY'
    : professional.hardAllowed;

  const evaluatedStrategies: AutoBotsSmartStrategyEvaluation[] = (['conservative', 'dip_and_rebound', 'balanced', 'momentum'] as ExecutableStrategy[]).map((strategy) => {
    const contract = STRATEGY_CONTRACTS[strategy];
    const requiredConditions: string[] = [];
    const passedConditions: string[] = [];
    const failedConditions: string[] = [];
    const requiredDip = getRequiredDipForContract(strategy, bucket);
    const requiredRebound = getRequiredReboundForContract(strategy, bucket);
    condition('professional_gate_allowed', professionalGateAllowed, failedConditions, passedConditions, requiredConditions);
    condition('spreadOk=true', spreadOk === true, failedConditions, passedConditions, requiredConditions);
    condition('tpRoomOk=true', tpRoomOk === true, failedConditions, passedConditions, requiredConditions);
    condition('priceFresh=true', priceFresh === true, failedConditions, passedConditions, requiredConditions);
    condition('bookFresh=true', bookFresh === true, failedConditions, passedConditions, requiredConditions);
    condition('not_overextended', overextended !== true, failedConditions, passedConditions, requiredConditions);
    condition('no_candle_exhaustion', candleExhaustion !== true, failedConditions, passedConditions, requiredConditions);
    if (contract.dip === 'required') {
      condition(`dipPct>=${requiredDip ?? 'n/a'}`, requiredDip != null && dipDepthPct != null && dipDepthPct >= requiredDip, failedConditions, passedConditions, requiredConditions);
    }
    if (contract.rebound === 'required') {
      condition(`reboundPct>=${requiredRebound ?? 'n/a'}`, requiredRebound == null || (reboundPct != null && reboundPct >= requiredRebound), failedConditions, passedConditions, requiredConditions);
      condition('reboundConfirmed=true', reboundConfirmed === true, failedConditions, passedConditions, requiredConditions);
      condition('reboundFreshnessStatus=valid', reboundFreshnessStatus === 'valid', failedConditions, passedConditions, requiredConditions);
    }
    if (contract.momentum === 'required') {
      condition('momentumConfirmed=true', momentumConfirmed === true, failedConditions, passedConditions, requiredConditions);
    }
    const eligible = failedConditions.length === 0;
    const confidence = eligible
      ? Math.min(100, Math.round((professional.score ?? 70) + (strategy === 'balanced' ? 2 : strategy === 'momentum' ? 3 : 0)))
      : Math.max(0, 100 - failedConditions.length * 12);
    return {
      strategy,
      eligible,
      requiredConditions,
      passedConditions,
      failedConditions,
      blocker: failedConditions[0] ?? 'none',
      confidence,
    };
  });

  const conservativeRequired = isHighRiskGroup(riskGroup) && normalizeAutoStrategy(context.groupVerdict?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy) === 'conservative';
  const priority: ExecutableStrategy[] = conservativeRequired
    ? ['conservative', 'dip_and_rebound', 'balanced', 'momentum']
    : ['dip_and_rebound', 'balanced', 'momentum', 'conservative'];
  const selected = priority.map((s) => evaluatedStrategies.find((e) => e.strategy === s)).find((e): e is AutoBotsSmartStrategyEvaluation => Boolean(e?.eligible)) ?? null;
  const noValidStrategyTrace = evaluatedStrategies.map((e) => `${e.strategy}:${e.eligible ? 'passed' : e.failedConditions.join('|')}`);
  const finalExecutionStrategy = selected?.strategy ?? 'wait';
  const hardGateBlocker = professional.mode === 'hard_gate' && !professional.hardAllowed ? professional.hardBlocker : null;
  const noValidStrategyReason = selected ? null : (hardGateBlocker ?? 'NO_VALID_AUTOBOTS_STRATEGY');
  return {
    symbol: candidate.symbol,
    scanId: candidate.candidateId ?? (candidate as any).scanId ?? 'unknown',
    riskGroup,
    smartEnabled: context.runtimeSettings?.dynamicPerCoinStrategy !== false,
    professionalMode: professional.mode,
    professionalScore: professional.score,
    professionalVerdict: professional.verdict,
    professionalBlockers: professional.blockers,
    evaluatedStrategies,
    selectedStrategy: selected?.strategy ?? null,
    selectionReason: selected ? `${selected.strategy}_contract_satisfied` : 'all_strategy_contracts_failed',
    noValidStrategyReason,
    noValidStrategyTrace,
    finalExecutionStrategy,
    setupValidatorUsed: finalExecutionStrategy,
    strategySourceResolved: finalExecutionStrategy === 'wait' ? 'AUTOBOTS_WAIT' : 'AUTOBOTS_DYNAMIC',
    routerPath: finalExecutionStrategy === 'wait' ? (hardGateBlocker ? 'professional_gate_wait' : 'wait_no_valid_strategy') : 'smart_strategy_router',
    invariantOk: Boolean(selected) || evaluatedStrategies.length === 4,
    failureReason: selected ? 'none' : (noValidStrategyReason ?? 'NO_VALID_AUTOBOTS_STRATEGY'),
  };
}

function groupAllowsStrategy(riskGroup: string | null, groupStrategy: AutoStrategyName | null, candidateStrategy: AutoStrategyName): { allowed: boolean; reason: string | null } {
  if (!groupStrategy || groupStrategy === 'wait' || groupStrategy === 'avoid') return { allowed: true, reason: null };
  if (candidateStrategy === groupStrategy) return { allowed: true, reason: null };
  if (isHighRiskGroup(riskGroup) && groupStrategy === 'conservative' && candidateStrategy !== 'conservative') {
    return { allowed: false, reason: 'GROUP_REQUIRES_CONSERVATIVE' };
  }
  if (groupStrategy === 'dip_and_rebound' && candidateStrategy === 'balanced') {
    return { allowed: false, reason: 'GROUP_REQUIRES_DIP_AND_REBOUND' };
  }
  return { allowed: true, reason: null };
}

export function resolveAutoBotsFinalStrategy(
  candidate: AutoBotsFinalStrategyCandidate,
  marketVerdict: AutoBotsMarketVerdictInput = {},
  groupVerdict: AutoBotsGroupVerdictInput = {},
  runtimeSettings: AutoBotsRuntimeSettingsInput = {},
): AutoBotsFinalStrategyResolution {
  const auto = candidate.autoStrategyDecision ?? null;
  const riskGroup = candidate.riskGroup ?? null;
  const groupTrend = groupVerdict.groupTrend ?? candidate.groupTrend ?? (String(auto?.groupTrend ?? '') || null);
  const groupRecommendedStrategy = normalizeAutoStrategy(groupVerdict.groupRecommendedStrategy ?? auto?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy);
  const marketBestFit = normalizeAutoStrategy(marketVerdict.marketBestFit ?? auto?.marketAnalyzerBestFit ?? candidate.marketAnalyzerBestFit ?? candidate.marketBestFit ?? groupRecommendedStrategy);
  const userSelectedRuntimeStrategy = normalizeAutoStrategy(runtimeSettings.userSelectedRuntimeStrategy ?? candidate.selectedStrategy);
  const autoEffectiveStrategy = normalizeAutoStrategy(auto?.effectiveStrategy ?? candidate.effectiveStrategy);
  const perCoinSelectedStrategy = normalizeAutoStrategy(candidate.perCoinSelectedStrategy ?? candidate.autoBotsPerCoinStrategy ?? auto?.perCoinSelectedStrategy ?? autoEffectiveStrategy);
  const autoBotsOn = runtimeSettings.autoBotsOn !== false && !runtimeSettings.manualOverrideActive;
  const dynamicPerCoinStrategy = runtimeSettings.dynamicPerCoinStrategy !== false && autoBotsOn;
  const smartStrategyDecision = resolveAutoBotsSmartStrategy(candidate, { marketVerdict, groupVerdict, runtimeSettings });
  const professionalAllowsEvaluation =
    smartStrategyDecision.professionalVerdict === 'STRONG_BUY'
    || smartStrategyDecision.professionalVerdict === 'BUY';
  const trace: string[] = [
    `riskGroup=${riskGroup ?? 'unknown'}`,
    `marketBestFit=${marketBestFit ?? 'none'}`,
    `groupRecommendedStrategy=${groupRecommendedStrategy ?? 'none'}`,
    `perCoinSelectedStrategy=${perCoinSelectedStrategy ?? 'none'}`,
    `userSelectedRuntimeStrategy=${userSelectedRuntimeStrategy ?? 'none'}`,
    `dynamicPerCoinStrategy=${String(dynamicPerCoinStrategy)}`,
  ];

  if (runtimeSettings.manualOverrideActive) {
    const manual = userSelectedRuntimeStrategy;
    return {
      symbol: candidate.symbol,
      riskGroup,
      groupTrend,
      groupRecommendedStrategy,
      groupConfidence: groupVerdict.groupConfidence ?? null,
      marketBestFit,
      userSelectedRuntimeStrategy,
      dynamicPerCoinStrategy: false,
      perCoinSelectedStrategy,
      finalExecutionStrategy: isExecutableAutoStrategy(manual) ? manual : 'wait',
      strategySourceResolved: isExecutableAutoStrategy(manual) ? 'MANUAL' : 'AUTOBOTS_WAIT',
      fallbackApplied: !isExecutableAutoStrategy(manual),
      fallbackType: isExecutableAutoStrategy(manual) ? 'NONE' : 'MANUAL_INVALID',
      fallbackReason: isExecutableAutoStrategy(manual) ? null : 'NO_VALID_MANUAL_STRATEGY',
      overrideApplied: false,
      overrideReason: null,
      mismatchAllowed: true,
      mismatchReason: 'manual_override_selected_strategy',
      routerPath: isExecutableAutoStrategy(manual) ? 'manual_override' : 'manual_invalid_wait',
      strategyDecisionTrace: [...trace, `final=${isExecutableAutoStrategy(manual) ? manual : 'wait'}`],
      evaluatedStrategies: [],
      selectedStrategy: isExecutableAutoStrategy(manual) ? manual : null,
      selectionReason: isExecutableAutoStrategy(manual) ? 'manual_override' : null,
      noValidStrategyReason: isExecutableAutoStrategy(manual) ? null : 'NO_VALID_MANUAL_STRATEGY',
      noValidStrategyTrace: [],
      fallbackCanSubmitBuy: false,
      fallbackSubmitGuardReason: isExecutableAutoStrategy(manual) ? 'manual_override_requires_final_entry_gate' : 'NO_VALID_MANUAL_STRATEGY',
    };
  }

  let finalExecutionStrategy: AutoStrategyName | null = null;
  let fallbackApplied = false;
  let fallbackType: AutoBotsFallbackType = 'NONE';
  let fallbackReason: string | null = null;
  let overrideApplied = false;
  let overrideReason: string | null = null;
  let mismatchReason = 'unchanged';
  let routerPath = 'unresolved';
  let resolvedPerCoinSelectedStrategy = perCoinSelectedStrategy;

  if (dynamicPerCoinStrategy) {
    const routerChoice = isExecutableAutoStrategy(perCoinSelectedStrategy) ? perCoinSelectedStrategy : isExecutableAutoStrategy(autoEffectiveStrategy) ? autoEffectiveStrategy : null;
    const smartChoice = smartStrategyDecision.noValidStrategyReason == null && isExecutableAutoStrategy(smartStrategyDecision.selectedStrategy)
      ? smartStrategyDecision.selectedStrategy
      : null;
    const preferredDynamicChoice = smartChoice ?? routerChoice;
    if (preferredDynamicChoice) {
      resolvedPerCoinSelectedStrategy = preferredDynamicChoice;
      const groupAllowance = groupAllowsStrategy(riskGroup, groupRecommendedStrategy, preferredDynamicChoice);
      if (groupAllowance.allowed) {
        finalExecutionStrategy = preferredDynamicChoice;
        routerPath = smartChoice ? 'smart_strategy_router' : 'per_coin_router';
        if (smartChoice && routerChoice && routerChoice !== smartChoice) {
          overrideApplied = true;
          overrideReason = `smart_strategy_router_overrode_legacy_${routerChoice}`;
          mismatchReason = overrideReason;
        } else if (marketBestFit && marketBestFit !== preferredDynamicChoice) {
          overrideApplied = true;
          overrideReason = preferredDynamicChoice === groupRecommendedStrategy
            ? 'group_recommended_strategy_overrode_market_best_fit'
            : 'per_coin_live_setup_overrode_market_best_fit';
          mismatchReason = overrideReason;
        } else if (groupRecommendedStrategy && groupRecommendedStrategy !== preferredDynamicChoice) {
          overrideApplied = true;
          overrideReason = 'per_coin_live_setup_overrode_group_strategy';
          mismatchReason = overrideReason;
        }
      } else {
        finalExecutionStrategy = groupAllowance.reason === 'GROUP_REQUIRES_CONSERVATIVE' && isExecutableAutoStrategy(groupRecommendedStrategy)
          ? groupRecommendedStrategy
          : 'wait';
        fallbackApplied = finalExecutionStrategy === 'wait';
        fallbackType = finalExecutionStrategy === 'wait' ? 'GROUP_CONSTRAINT' : 'GROUP_RECOMMENDATION';
        fallbackReason = groupAllowance.reason;
        mismatchReason = groupAllowance.reason ?? 'group_constraint_blocked_router_strategy';
        routerPath = finalExecutionStrategy === 'wait' ? 'group_constraint_wait' : 'group_constraint_group_recommendation';
      }
    } else if (smartStrategyDecision.noValidStrategyReason?.startsWith('PROFESSIONAL_VERDICT_')) {
      finalExecutionStrategy = 'wait';
      fallbackApplied = true;
      fallbackType = 'WAIT';
      fallbackReason = smartStrategyDecision.noValidStrategyReason;
      mismatchReason = smartStrategyDecision.noValidStrategyReason;
      routerPath = 'professional_gate_wait';
    } else if (isExecutableAutoStrategy(groupRecommendedStrategy)) {
      finalExecutionStrategy = groupRecommendedStrategy;
      fallbackApplied = true;
      fallbackType = 'GROUP_RECOMMENDATION';
      fallbackReason = 'router_missing_per_coin_strategy_used_group_recommendation';
      mismatchReason = fallbackReason;
      routerPath = 'group_fallback';
    } else if (professionalAllowsEvaluation && smartStrategyDecision.selectedStrategy) {
      finalExecutionStrategy = smartStrategyDecision.selectedStrategy;
      fallbackApplied = false;
      fallbackType = 'NONE';
      fallbackReason = null;
      mismatchReason = smartStrategyDecision.selectionReason;
      routerPath = 'smart_strategy_router';
      overrideApplied = Boolean((marketBestFit && marketBestFit !== finalExecutionStrategy) || (groupRecommendedStrategy && groupRecommendedStrategy !== finalExecutionStrategy));
      overrideReason = overrideApplied ? smartStrategyDecision.selectionReason : null;
    } else if (isExecutableAutoStrategy(marketBestFit)) {
      finalExecutionStrategy = marketBestFit;
      fallbackApplied = true;
      fallbackType = 'MARKET_BEST_FIT';
      fallbackReason = 'router_missing_group_strategy_used_market_best_fit';
      mismatchReason = fallbackReason;
      routerPath = 'market_fallback';
    }
  } else if (isExecutableAutoStrategy(userSelectedRuntimeStrategy)) {
    finalExecutionStrategy = userSelectedRuntimeStrategy;
    mismatchReason = 'runtime_strategy_selected';
    routerPath = 'runtime_strategy';
  }

  if (!finalExecutionStrategy) {
    finalExecutionStrategy = 'wait';
    fallbackApplied = true;
    fallbackType = 'WAIT';
    fallbackReason = smartStrategyDecision.noValidStrategyReason ?? 'NO_VALID_AUTOBOTS_STRATEGY';
    mismatchReason = fallbackReason;
    routerPath = smartStrategyDecision.routerPath === 'professional_gate_wait' ? 'professional_gate_wait' : 'wait_no_valid_strategy';
  }

  // PART C — NO_VALID_AUTOBOTS_STRATEGY guard
  if (finalExecutionStrategy === 'wait' && smartStrategyDecision.selectedStrategy && isExecutableAutoStrategy(smartStrategyDecision.selectedStrategy)) {
    finalExecutionStrategy = smartStrategyDecision.selectedStrategy;
    resolvedPerCoinSelectedStrategy = smartStrategyDecision.selectedStrategy;
    fallbackApplied = false;
    fallbackType = 'NONE';
    fallbackReason = null;
    routerPath = 'smart_strategy_router';
  }

  // PART B — Aggressive mode handoff audit
  const autoBotsMode = String(runtimeSettings.userSelectedRuntimeStrategy ?? 'auto').toLowerCase();
  if (autoBotsMode !== 'conservative') {
    const smartSelected = smartStrategyDecision.selectedStrategy;
    const smartExecutable = Boolean(smartSelected && isExecutableAutoStrategy(smartSelected));
    const aggressiveInvariantOk = !smartExecutable || (finalExecutionStrategy !== 'wait' && finalExecutionStrategy !== 'avoid');
    const aggressiveFailureReason = smartExecutable && finalExecutionStrategy === 'wait'
      ? 'SMART_EXECUTABLE_STRATEGY_LOST_BEFORE_RESOLUTION'
      : 'none';
    const hardBlockers: string[] = [];
    if (smartStrategyDecision.noValidStrategyReason?.startsWith('PROFESSIONAL_VERDICT_')) hardBlockers.push(smartStrategyDecision.noValidStrategyReason);
    if (smartStrategyDecision.professionalMode === 'hard_gate' && smartStrategyDecision.professionalVerdict !== 'STRONG_BUY' && smartStrategyDecision.professionalVerdict !== 'BUY') hardBlockers.push('PROFESSIONAL_HARD_GATE');
    logger.info(
      `AUTOBOTS_AGGRESSIVE_HANDOFF_AUDIT: ` +
      `symbol=${candidate.symbol} ` +
      `autoBotsMode=${autoBotsMode} ` +
      `smartSelectedStrategy=${smartSelected ?? 'n/a'} ` +
      `smartSelectedStrategyReason=${smartStrategyDecision.selectionReason} ` +
      `smartEligibleStrategies=${JSON.stringify(smartStrategyDecision.evaluatedStrategies.map(e => `${e.strategy}:${e.eligible ? 'eligible' : e.blocker}`))} ` +
      `routerInputSelectedStrategy=${String(finalExecutionStrategy)} ` +
      `routerOutputStrategy=${String(finalExecutionStrategy)} ` +
      `finalExecutionStrategy=${String(finalExecutionStrategy)} ` +
      `fallbackApplied=${String(fallbackApplied)} ` +
      `fallbackReason=${fallbackReason ?? 'none'} ` +
      `noValidStrategyReason=${smartStrategyDecision.noValidStrategyReason ?? 'none'} ` +
      `hardBlockers=${hardBlockers.join('|') || 'none'} ` +
      `invariantOk=${String(aggressiveInvariantOk)} ` +
      `failureReason=${aggressiveFailureReason}`
    );
  }

  const mismatchDetected = Boolean(
    (marketBestFit && finalExecutionStrategy !== marketBestFit)
    || (groupRecommendedStrategy && finalExecutionStrategy !== groupRecommendedStrategy),
  );
  const hasExplicitMismatchReason = mismatchReason !== 'router_selected_per_coin_strategy' && mismatchReason !== 'unchanged' && mismatchReason.length > 0;
  const mismatchAllowed = !mismatchDetected || hasExplicitMismatchReason;
  const strategySourceResolved: AutoBotsFinalStrategyResolution['strategySourceResolved'] =
    runtimeSettings.autoBotsOn === false
      ? 'DISABLED'
      : finalExecutionStrategy === 'wait' || finalExecutionStrategy === 'avoid'
        ? 'AUTOBOTS_WAIT'
        : fallbackType === 'GROUP_RECOMMENDATION'
          ? 'AUTOBOTS_GROUP_FALLBACK'
          : fallbackType === 'MARKET_BEST_FIT'
            ? 'AUTOBOTS_MARKET_FALLBACK'
            : dynamicPerCoinStrategy
              ? 'AUTOBOTS_DYNAMIC'
              : 'MANUAL';

  const evaluationTrace = smartStrategyDecision.evaluatedStrategies.length > 0
    ? smartStrategyDecision.noValidStrategyTrace
    : [];
  const smartNoValidStrategy = smartStrategyDecision.noValidStrategyReason === 'NO_VALID_AUTOBOTS_STRATEGY';
  const fallbackAfterSmartNoValid = fallbackApplied && smartNoValidStrategy && finalExecutionStrategy !== 'wait';
  const fallbackSubmitGuardReason = fallbackAfterSmartNoValid
    ? 'ENTRY_GATE_REVALIDATION_REQUIRED_AFTER_NO_VALID_SMART_STRATEGY'
    : finalExecutionStrategy === 'wait'
      ? (fallbackReason ?? smartStrategyDecision.noValidStrategyReason ?? 'WAIT_NON_EXECUTABLE')
      : 'smart_strategy_or_legacy_route_requires_final_entry_gate';
  const invariantOk = finalExecutionStrategy !== 'wait'
    || fallbackReason !== 'NO_VALID_AUTOBOTS_STRATEGY'
    || smartStrategyDecision.evaluatedStrategies.length === 4;
  logger.info(
    `AUTOBOTS_SMART_STRATEGY_EVALUATION_AUDIT: ` +
    `symbol=${candidate.symbol} ` +
    `scanId=${candidate.candidateId ?? (candidate as any).scanId ?? 'unknown'} ` +
    `riskGroup=${riskGroup ?? 'n/a'} ` +
    `professionalScore=${smartStrategyDecision.professionalScore ?? 'n/a'} ` +
    `professionalVerdict=${smartStrategyDecision.professionalVerdict} ` +
    `professionalBlockers=${smartStrategyDecision.professionalBlockers.join('|') || 'none'} ` +
    `dipPct=${finiteNumber(candidate.dipPercent ?? (candidate as any).dipPct) ?? 'n/a'} ` +
    `reboundPct=${finiteNumber(candidate.reboundAtEntry ?? candidate.reboundPercent ?? (candidate as any).reboundPct) ?? 'n/a'} ` +
    `reboundConfirmed=${String(candidate.reboundConfirmed ?? 'n/a')} ` +
    `reboundFreshnessStatus=${candidate.reboundFreshnessStatus ?? 'n/a'} ` +
    `momentumConfirmed=${String(candidate.momentumConfirmed ?? 'n/a')} ` +
    `spreadOk=${String(candidate.spreadOk ?? (finiteNumber(candidate.spreadPct) == null ? 'n/a' : finiteNumber(candidate.spreadPct)! < 0.5))} ` +
    `tpRoomOk=${String(candidate.tpRoomOk ?? 'n/a')} ` +
    `priceFresh=${String(candidate.priceFresh ?? 'n/a')} ` +
    `bookFresh=${String(candidate.bookFresh ?? 'n/a')} ` +
    `selectedStrategy=${smartStrategyDecision.selectedStrategy ?? 'n/a'} ` +
    `selectedStrategyReason=${smartStrategyDecision.selectionReason} ` +
    `noValidStrategyReason=${smartStrategyDecision.noValidStrategyReason ?? 'none'} ` +
    `evaluatedStrategies=${JSON.stringify(smartStrategyDecision.evaluatedStrategies)} ` +
    `invariantOk=${String(invariantOk)}`
  );
  const smartExecutable = Boolean(
    smartStrategyDecision.selectedStrategy
    && isExecutableAutoStrategy(smartStrategyDecision.selectedStrategy)
    && smartStrategyDecision.noValidStrategyReason == null,
  );
  const smartHandoffInvariantOk = !smartExecutable
    || (
      finalExecutionStrategy !== 'wait'
      && fallbackReason !== 'NO_VALID_AUTOBOTS_STRATEGY'
      && resolvedPerCoinSelectedStrategy != null
    );
  logger.info(
    `SMART_STRATEGY_HANDOFF_AUDIT: ` +
    `symbol=${candidate.symbol} ` +
    `scanId=${candidate.candidateId ?? (candidate as any).scanId ?? 'unknown'} ` +
    `autoBotsMode=${autoBotsMode} ` +
    `smartSelectedStrategy=${smartStrategyDecision.selectedStrategy ?? 'n/a'} ` +
    `smartSelectedStrategyReason=${smartStrategyDecision.selectionReason} ` +
    `smartEligibleStrategies=${JSON.stringify(smartStrategyDecision.evaluatedStrategies.filter(e => e.eligible).map(e => e.strategy))} ` +
    `smartNoValidStrategyReason=${smartStrategyDecision.noValidStrategyReason ?? 'none'} ` +
    `routerInputSelectedStrategy=${perCoinSelectedStrategy ?? autoEffectiveStrategy ?? 'n/a'} ` +
    `routerOutputPerCoinStrategy=${resolvedPerCoinSelectedStrategy ?? 'n/a'} ` +
    `finalExecutionStrategy=${finalExecutionStrategy} ` +
    `fallbackApplied=${String(fallbackApplied)} ` +
    `fallbackReason=${fallbackReason ?? 'none'} ` +
    `invariantOk=${String(smartHandoffInvariantOk)} ` +
    `failureReason=${smartHandoffInvariantOk ? 'none' : 'SMART_EXECUTABLE_STRATEGY_LOST_BEFORE_RESOLUTION'}`
  );
  if (finalExecutionStrategy === 'wait') {
    logger.info(`WAIT_STRATEGY_NON_EXECUTABLE_AUDIT: symbol=${candidate.symbol} scanId=${candidate.candidateId ?? (candidate as any).scanId ?? 'unknown'} reason=${fallbackReason ?? 'wait'} evaluatedStrategies=${JSON.stringify(smartStrategyDecision.evaluatedStrategies)} tp1Executable=false noTp1ExecutionAttempted=true noPositionManagerPersistence=true noExecutionAttempted=true invariantOk=${String(invariantOk)}`);
  }

  return {
    symbol: candidate.symbol,
    riskGroup,
    groupTrend,
    groupRecommendedStrategy,
    groupConfidence: groupVerdict.groupConfidence ?? null,
    marketBestFit,
    userSelectedRuntimeStrategy,
    dynamicPerCoinStrategy,
    perCoinSelectedStrategy: resolvedPerCoinSelectedStrategy,
    finalExecutionStrategy,
    strategySourceResolved,
    fallbackApplied,
    fallbackType,
    fallbackReason,
    overrideApplied,
    overrideReason,
    mismatchAllowed,
    mismatchReason: mismatchDetected ? mismatchReason : 'unchanged',
    routerPath,
    strategyDecisionTrace: [...trace, `routerPath=${routerPath}`, `fallbackType=${fallbackType}`, `finalExecutionStrategy=${finalExecutionStrategy}`, `mismatchAllowed=${String(mismatchAllowed)}`, `mismatchReason=${mismatchDetected ? mismatchReason : 'unchanged'}`, `smartTrace=${evaluationTrace.join(';') || 'none'}`],
    evaluatedStrategies: smartStrategyDecision.evaluatedStrategies,
    selectedStrategy: smartStrategyDecision.selectedStrategy,
    selectionReason: smartStrategyDecision.selectedStrategy ? smartStrategyDecision.selectionReason : null,
    noValidStrategyReason: finalExecutionStrategy === 'wait' ? (fallbackReason ?? smartStrategyDecision.noValidStrategyReason) : null,
    noValidStrategyTrace: evaluationTrace,
    fallbackCanSubmitBuy: false,
    fallbackSubmitGuardReason,
  };
}

function getConfidenceTier(confidence: number): StrategyConfidenceTier {
  const pct = confidence > 1 ? confidence : Math.round(confidence * 100);
  if (pct >= 80) return 'A_80_PLUS';
  if (pct >= 70) return 'B_70_80';
  return 'C_BELOW_70';
}

function hasHardBlock(blockReasons: string[]): boolean {
  const hardBlockers = ['BLOCK_SYMBOL_NOT_TRADABLE', 'BLOCK_MARKET_DATA_OFFLINE', 'BLOCK_DATA_QUALITY_BAD',
    'BLOCK_VERY_HIGH_RISK_LIVE', 'BLOCK_BOOK_STALE', 'BLOCK_REBOUND_NOT_CONFIRMED', 'BLOCK_BREAKOUT_NOT_CONFIRMED', 'BLOCK_LTF_CONFIRMATION_MISSING'];
  return blockReasons.some(r => hardBlockers.some(h => r.includes(h)));
}

export function computeAutoStrategy(input: AutoStrategyRouterInput): AutoStrategyDecision {
  const {
    symbol, referencePeriod, groupTrend, groupRecommendedStrategy, groupEnabled,
    candidateStatus, confidence, dipPct, reboundPct, momentumPct, volumeRelative, spreadPct,
    tpRoomOk, priceFresh, fallingKnife, overextended, reboundConfirmed, momentumConfirmed,
    mlBadEntryRisk, mlWinProbability, blockReasons,
  } = input;

  const { userStrategyMode } = input;
  const warnings: string[] = [];
  let confidenceAdjustment = 0;
  const tier = getConfidenceTier(confidence);

  function ret(strategy: AutoStrategyName, owner: StrategySourceOwner, detail: StrategySourceDetail, strategyReason: string, extraWarnings: string[], overrides?: Partial<AutoStrategyDecision>): AutoStrategyDecision {
    const fallbackUsed = owner === 'AutoBots_SafeFallback' || detail === 'fallback_conservative' || detail === 'data_stale_safe_fallback' || detail === 'group_fallback';
    const fallbackReason = fallbackUsed ? strategyReason : null;
    const isDipRebound = String(strategy) === 'dip_and_rebound';
    const recommendedIsDipRebound = String((overrides as any)?.groupRecommendedStrategy ?? '') === 'dip_and_rebound';
    if (isDipRebound || (recommendedIsDipRebound && !isDipRebound)) {
      const rejected = !isDipRebound;
      const rejectionReason = rejected ? (dipPct == null || dipPct >= 0 ? 'dip_missing_or_zero' : !reboundConfirmed ? 'rebound_not_confirmed' : 'none') : 'none';
      logger.info(`AUTOSTRATEGY_ROUTER_DIP_REBOUND_DECISION_AUDIT: symbol=${symbol} marketRecommendedStrategy=${groupRecommendedStrategy} candidateStrategyBefore=${candidateStatus} actualDipPct=${dipPct?.toFixed(2) ?? 'n/a'} requiredDipPct=n/a dipConfirmed=${String(dipPct != null && dipPct < 0)} actualReboundPct=${reboundPct?.toFixed(2) ?? 'n/a'} requiredReboundPct=n/a reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} selectedStrategy=${String(strategy)} finalEntryRule=n/a decisionSource=${detail} rejectedDipAndRebound=${String(rejected)} rejectionReason=${rejectionReason}`);
    }
    return {
      symbol,
      effectiveStrategy: strategy,
      strategySource: owner,
      strategySourceDetail: detail,
      strategyReason,
      groupRecommendedStrategy,
      groupTrend,
      referencePeriod,
      confidenceTier: tier,
      confidenceAdjustment,
      blockedByGroupRegime: false,
      blockedBySafety: false,
      reason: strategyReason,
      warnings: [...warnings, ...extraWarnings].filter((w, i, a) => a.indexOf(w) === i),
      marketAnalyzerBestFit: input.marketAnalyzerBestFit ?? null,
      perCoinSelectedStrategy: detail === 'per_coin_selector' ? strategy : null,
      fallbackUsed,
      fallbackReason,
      ...overrides,
    };
  }

  const manualStrategyName = input.userStrategyMode === 'manual' ? input.manualSelectedStrategy : undefined;
  if (userStrategyMode === 'manual' && manualStrategyName && manualStrategyName !== 'auto' && manualStrategyName !== 'smart') {
    const validStrategies: AutoStrategyName[] = ['conservative', 'balanced', 'momentum', 'dip_and_rebound'];
    if (validStrategies.includes(manualStrategyName as AutoStrategyName)) {
      return ret(manualStrategyName as AutoStrategyName, 'ManualOverride', 'manual_override', `Manual override active: ${manualStrategyName}`, [], { confidenceAdjustment: 0 });
    }
  }

  if (input.takeoverModeActive && input.takeoverValidated) {
    const takeoverStrategy = input.takeoverSelectedStrategy ?? groupRecommendedStrategy;
    return ret(takeoverStrategy, 'Takeover', 'takeover_validated', 'Takeover mode active and validated', []);
  }

  if (mlWinProbability > 0) {
    if (mlWinProbability >= 80) confidenceAdjustment = Math.min(8, Math.round((mlWinProbability - 80) / 5));
    else if (mlWinProbability >= 60) confidenceAdjustment = Math.min(3, Math.round((mlWinProbability - 60) / 10));
    if (mlBadEntryRisk) {
      confidenceAdjustment = Math.max(-8, -Math.round(mlBadEntryRisk ? 5 : 0));
      warnings.push('ML_BAD_ENTRY_RISK');
    }
  }

  if (!groupEnabled) {
    return ret('avoid', 'AutoBots_SafeFallback', 'group_fallback', 'Group disabled - no strategy applicable', ['GROUP_DISABLED'], { blockedByGroupRegime: true, confidenceAdjustment: 0 });
  }

  if (hasHardBlock(blockReasons)) {
    return ret('avoid', 'AutoBots_SafeFallback', 'safety_downgrade', 'Hard block present - avoiding symbol', ['HARD_BLOCK_ACTIVE'], { blockedBySafety: true, confidenceAdjustment: 0 });
  }

  if (fallingKnife) {
    return ret('wait', 'AutoBots_SafeFallback', 'safety_downgrade', 'Falling knife detected - waiting for stabilization', ['FALLING_KNIFE'], { blockedBySafety: true, confidenceAdjustment: 0 });
  }

  if (candidateStatus === 'AVOID') {
    return ret('avoid', 'AutoBots_SafeFallback', 'safety_downgrade', 'Candidate marked AVOID', [], { blockedBySafety: true, confidenceAdjustment: 0 });
  }

  if (!priceFresh) {
    return ret('wait', 'AutoBots_SafeFallback', 'data_stale_safe_fallback', 'Stale price - waiting for fresh data', ['PRICE_STALE'], { confidenceAdjustment: 0, blockedBySafety: true });
  }
  if (!tpRoomOk) {
    return ret('wait', 'AutoBots_SafeFallback', 'fallback_conservative', 'No TP room - waiting', ['NO_TP_ROOM'], { confidenceAdjustment: 0, blockedBySafety: true });
  }
  if (spreadPct >= 0.5) {
    return ret('wait', 'AutoBots_SafeFallback', 'fallback_conservative', 'Spread too high - waiting', ['SPREAD_TOO_HIGH'], { confidenceAdjustment: 0, blockedBySafety: true });
  }
  if (!reboundConfirmed) {
    return ret('wait', 'AutoBots_SafeFallback', 'group_fallback', 'Rebound not confirmed - waiting', ['REBOUND_NOT_CONFIRMED'], { confidenceAdjustment: 0 });
  }

  if (groupTrend === 'bearish' || groupTrend === 'bearish_or_unsafe') {
    if (tier === 'C_BELOW_70') {
      if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh) {
        return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Dip and rebound setup selected for bearish group despite low confidence', ['GROUP_BEARISH']);
      }
      return ret('wait', 'AutoBots_SafeFallback', 'confidence_below_tier', 'Bearish group and confidence below tier — waiting for safer setup', ['CONFIDENCE_BELOW_TIER'], { blockedByConfidence: true, confidenceAdjustment: 0 });
    }
    if (tier === 'A_80_PLUS' && !overextended) {
      if (momentumConfirmed && reboundConfirmed && tpRoomOk && spreadPct < 0.5 && priceFresh) {
        return ret('momentum', 'AutoBots', 'per_coin_selector', 'Bearish group but A-tier with momentum+rebound — momentum selected', ['GROUP_BEARISH_PROMOTED']);
      }
      if (reboundConfirmed && tpRoomOk && spreadPct < 0.5 && priceFresh) {
        return ret('balanced', 'AutoBots', 'per_coin_selector', 'Bearish group but A-tier with strong rebound — balanced selected', ['GROUP_BEARISH_PROMOTED']);
      }
      return ret('conservative', 'AutoBots_SafeFallback', 'safety_downgrade', 'Group trend bearish - A-tier downgraded to conservative', ['GROUP_BEARISH_DOWNGRADE'], { blockedByGroupRegime: true });
    }
    if (confidence >= 75 && momentumConfirmed && reboundConfirmed && tpRoomOk && spreadPct < 0.5 && priceFresh && !overextended) {
      return ret('balanced', 'AutoBots', 'per_coin_selector', 'Bearish group but strong per-symbol balance — balanced selected', ['GROUP_BEARISH_PROMOTED']);
    }
    if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh) {
      return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Dip and rebound setup selected for bearish group', ['GROUP_BEARISH']);
    }
    return ret('wait', 'AutoBots_SafeFallback', 'group_fallback', 'Group trend bearish - waiting for safer conditions', ['GROUP_BEARISH'], { blockedByGroupRegime: true, confidenceAdjustment: 0 });
  }

  if (groupTrend === 'caution') {
    if (tier === 'C_BELOW_70') {
      warnings.push('CONFIDENCE_BELOW_TIER');
      // Fall through to conservative below — don't return wait
    }
    warnings.push('GROUP_VOLATILITY_CAUTION');
    if (confidence >= 70 && reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh) {
      return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Caution group - dip and rebound selected with confirmation', ['GROUP_VOLATILITY_CAUTION']);
    }
    return ret('conservative', 'AutoBots_SafeFallback', 'group_fallback', 'Group trend caution - conservative approach', ['GROUP_VOLATILITY_CAUTION'], { blockedByGroupRegime: true });
  }

  if (groupTrend === 'waiting_for_rebound') {
    if (tier === 'C_BELOW_70') {
      return ret('wait', 'AutoBots_SafeFallback', 'confidence_below_tier', 'Waiting for rebound and confidence below tier', ['CONFIDENCE_BELOW_TIER'], { blockedByConfidence: true, confidenceAdjustment: 0 });
    }
    if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh) {
      return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Dip and rebound setup detected', []);
    }
    return ret('wait', 'AutoBots_SafeFallback', 'group_fallback', 'Waiting for rebound confirmation', ['REBOUND_NOT_CONFIRMED'], { confidenceAdjustment: 0, groupRecommendedStrategy: 'dip_and_rebound' as AutoStrategyName });
  }

  if (groupTrend === 'sideways') {
    if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh && !overextended) return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Sideways group - dip and rebound selected', []);
    if (confidence >= 70 && momentumConfirmed && spreadPct < 0.3 && priceFresh && tpRoomOk) return ret('balanced', 'AutoBots', 'per_coin_selector', 'Sideways group - balanced selected', []);
    if (momentumPct > 1 && volumeRelative >= 0.5 && spreadPct < 0.3 && !fallingKnife) return ret('momentum', 'AutoBots', 'per_coin_selector', 'Sideways group - momentum selected', []);
    if (momentumPct > 0.5 && volumeRelative >= 0.8 && spreadPct < 0.4) return ret('momentum', 'AutoBots', 'per_coin_selector', 'Sideways group - momentum with volume', []);
    if (dipPct < -1 && tpRoomOk && !fallingKnife) return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Sideways group - dip and rebound with strong dip', []);
    if (momentumPct > 0.3 && volumeRelative > 0.8 && spreadPct < 0.4) return ret('balanced', 'AutoBots', 'per_coin_selector', 'Sideways group - balanced with mild momentum', []);
    return ret('conservative', 'AutoBots_SafeFallback', 'fallback_conservative', 'Sideways group conservative fallback', []);
  }

  if (tier === 'A_80_PLUS' && momentumConfirmed && volumeRelative >= 0.5 && !overextended && spreadPct < 0.3 && priceFresh) return ret('momentum', 'AutoBots', 'per_coin_selector', 'Bullish group momentum strategy with high confidence', []);
  if (tier === 'C_BELOW_70') {
    if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh && !fallingKnife) {
      return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Bullish group - dip and rebound selected despite low confidence', ['CONFIDENCE_BELOW_TIER']);
    }
    return ret('wait', 'AutoBots_SafeFallback', 'confidence_below_tier', `Bullish group but confidence below tier — tier=${tier} confidence=${confidence}`, ['CONFIDENCE_BELOW_TIER'], { blockedByConfidence: true, confidenceAdjustment: 0 });
  }
  if (momentumConfirmed && spreadPct < 0.5 && priceFresh && tpRoomOk) return ret('balanced', 'AutoBots', 'per_coin_selector', 'Bullish group balanced strategy', []);
  if (reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh && !fallingKnife) return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Bullish group dip and rebound strategy', []);
  if (momentumPct > 0.5 && volumeRelative >= 0.8 && spreadPct < 0.4 && !fallingKnife && !overextended) return ret('momentum', 'AutoBots', 'per_coin_selector', 'Bullish group momentum via per-candidate features', []);
  if (momentumPct > 0.3 && volumeRelative > 1 && spreadPct < 0.4) return ret('balanced', 'AutoBots', 'per_coin_selector', 'Bullish group balanced via per-candidate features', []);
  if (dipPct < -0.5 && tpRoomOk && !fallingKnife) return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Bullish group dip and rebound via dipPct', []);

  if (momentumPct > 0.5 && volumeRelative >= 0.8 && spreadPct < 0.4) return ret('momentum', 'AutoBots', 'per_coin_selector', 'Default momentum via per-candidate features', []);
  if (momentumPct > 0.3 && volumeRelative >= 0.5 && spreadPct < 0.5) return ret('balanced', 'AutoBots', 'per_coin_selector', 'Default balanced via per-candidate features', []);
  if (dipPct < -0.5 && tpRoomOk) return ret('dip_and_rebound', 'AutoBots', 'per_coin_selector', 'Default dip and rebound via dipPct', []);
  return ret('conservative', 'AutoBots_SafeFallback', 'fallback_conservative', `Default conservative fallback — tier=${tier} confidence=${confidence} momentumConfirmed=${momentumConfirmed} spreadPct=${spreadPct.toFixed(2)}`, confidence < 70 ? ['CONFIDENCE_BELOW_TIER'] : ['NO_STRATEGY_MATCHED']);
}

export function buildAutoStrategySummary(decisions: AutoStrategyDecision[]): {
  totalCandidates: number;
  conservative: number;
  balanced: number;
  momentum: number;
  dip_and_rebound: number;
  wait: number;
  avoid: number;
  downgrades: number;
  referencePeriod: string;
} {
  const summary = {
    totalCandidates: decisions.length,
    conservative: 0, balanced: 0, momentum: 0, dip_and_rebound: 0, wait: 0, avoid: 0,
    downgrades: 0,
    referencePeriod: decisions.length > 0 ? decisions[0].referencePeriod : '1h',
  };
  for (const d of decisions) {
    if (d.effectiveStrategy === 'conservative') summary.conservative++;
    else if (d.effectiveStrategy === 'balanced') summary.balanced++;
    else if (d.effectiveStrategy === 'momentum') summary.momentum++;
    else if (d.effectiveStrategy === 'dip_and_rebound') summary.dip_and_rebound++;
    else if (d.effectiveStrategy === 'wait') summary.wait++;
    else if (d.effectiveStrategy === 'avoid') summary.avoid++;
    if (d.strategySource === 'AutoBots_SafeFallback') summary.downgrades++;
  }
  return summary;
}
