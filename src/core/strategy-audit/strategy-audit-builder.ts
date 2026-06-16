import type { ScannerCandidate } from '../types';
import type { StrategyAuditSnapshot, StrategySetupItem } from './strategy-audit-types';
import { STRATEGY_AUDIT_REGISTRY } from './strategy-audit-registry';
import { logger } from '../../utils/logger';
import { validateStrategyContract, type MarketRegimeBucket } from './strategy-contracts';

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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

export function buildStrategyAuditSnapshotFromCandidate(candidate: ScannerCandidate): StrategyAuditSnapshot {
  const unifiedSignal = (candidate.traderBrainDecision?.ruleDecisionTrace as any)?.unifiedSignal ?? {};
  const auto = candidate.autoStrategyDecision;
  const strategyRequested = String((unifiedSignal?.definition?.buyRule ?? candidate.selectedStrategy ?? 'unknown'));
  let strategySelected = String(candidate.selectedStrategy ?? auto?.effectiveStrategy ?? 'unknown');
  const runtimeActiveStrategy = String(auto?.effectiveStrategy ?? candidate.effectiveStrategy ?? strategySelected);
  const finalPerCoinStrategy = String(auto?.effectiveStrategy ?? strategySelected);
  const marketRecommendedStrategy = auto?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy ?? null;
  const intendedStrategy = resolveIntendedStrategy({
    strategyRequested,
    finalPerCoinStrategy,
    marketRecommendedStrategy,
    runtimeActiveStrategy,
    strategySelected,
    strategySource: String(auto?.strategySource ?? candidate.strategySource ?? 'unknown'),
  });
  let strategyDef = STRATEGY_AUDIT_REGISTRY[(strategySelected as keyof typeof STRATEGY_AUDIT_REGISTRY)] ?? STRATEGY_AUDIT_REGISTRY.unknown;
  const strategySource = String(auto?.strategySource ?? candidate.strategySource ?? 'unknown');
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
  const dynamicBucket = resolveDynamicSetupBucket(candidate);
  const dynamicSetup = resolveDynamicEntrySetup(intendedStrategy, dynamicBucket);
  const requiredDipPct = dynamicSetup.requiredDipPctMin ?? strategyDef.minDipPct;
  const requiredReboundPct = dynamicSetup.requiredReboundPctMin ?? strategyDef.minReboundPct;
  if (strategySelected === 'dip_and_rebound') {
    logger.info(`DIP_REBOUND_REQUIRED_PARAMS_AUDIT: symbol=${candidate.symbol} strategySource=${strategySource} strategyAtEntry=${strategySelected} userSettingDipAndReboundMinDipPct=n/a userSettingDipAndReboundMinReboundPct=n/a effectiveRequiredDipPct=${requiredDipPct ?? 'n/a'} effectiveRequiredReboundPct=${requiredReboundPct ?? 'n/a'} sourceOfRequiredDip=${dynamicSetup.requiredDipPctMin != null ? 'dynamic_bucket' : (strategyDef.minDipPct != null ? 'strategy_registry_default' : 'none')} sourceOfRequiredRebound=${dynamicSetup.requiredReboundPctMin != null ? 'dynamic_bucket' : (strategyDef.minReboundPct != null ? 'strategy_registry_default' : 'none')} settingsHydrated=false settingsAppliedToRouter=false settingsAppliedToBuilder=true settingsAppliedToExecutionPlanner=false settingsAppliedToTradingEngine=false`);
  }
  const dipConfirmed = requiredDipPct == null ? true : (dipDepthPct != null && dipDepthPct >= requiredDipPct);
  const reboundConfirmed = requiredReboundPct == null
    ? baseReboundConfirmed
    : (baseReboundConfirmed && reboundPct != null && reboundPct >= requiredReboundPct);
  const momentumRequired = strategyDef.momentumRequirement === 'required';
  const reboundRequired = strategyDef.reboundRequirement === 'required';
  const dipRequired = strategyDef.metricRoles.dip === 'required';
  const priceFresh = !candidate.blockReasons?.some((b) => b.toLowerCase().includes('stale'));
  const fallingKnifeBlocked = candidate.blockReasons?.some((b) => b.toLowerCase().includes('falling_knife')) ?? false;
  const conservativeOverlay = strategySelected === 'balanced' && strategySource.toLowerCase().includes('fallback');
  const requiredSetupPassed =
    (!momentumRequired || momentumConfirmed)
    && (!reboundRequired || reboundConfirmed)
    && (!dipRequired || dipConfirmed)
    && spreadOk
    && tpRoomOk
    && priceFresh;
  let finalExecutable = requiredSetupPassed && candidate.status === 'BUY' && candidate.entryGateDecision?.decision === 'ALLOW';
  const buyAllowed = finalExecutable;

  if (finalExecutable && strategySelected.toLowerCase() === 'wait') {
    const perCoin = String(auto?.perCoinSelectedStrategy ?? '');
    const autoEff = String(auto?.effectiveStrategy ?? '');
    const groupRec = String(auto?.groupRecommendedStrategy ?? '');
    const resolvedStrategy =
      perCoin && !/^(?:wait|unknown|avoid|)$/i.test(perCoin) ? perCoin
      : autoEff && !/^(?:wait|unknown|avoid|)$/i.test(autoEff) ? autoEff
      : groupRec && !/^(?:wait|unknown|avoid|)$/i.test(groupRec) ? groupRec
      : 'balanced';
    strategySelected = resolvedStrategy;
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
          strategySelected = momentumConfirmed ? 'momentum' : (reboundPct != null && reboundPct > 0 ? 'balanced' : 'momentum');
        }
      }
    }
    strategyDef = STRATEGY_AUDIT_REGISTRY[(strategySelected as keyof typeof STRATEGY_AUDIT_REGISTRY)] ?? STRATEGY_AUDIT_REGISTRY.unknown;
    isWait = false;
    const derivedEntryRule =
      resolvedRule && !/WAITING|UNKNOWN/i.test(String(resolvedRule)) && !String(resolvedRule).startsWith('EntryGate')
        ? String(resolvedRule)
        : String(strategySelected).toUpperCase() + '_READY';
    finalEntryRule = derivedEntryRule;
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
        strategySelected = momentumConfirmed ? 'momentum' : (reboundPct != null && reboundPct > 0 ? 'balanced' : 'momentum');
        strategyDef = STRATEGY_AUDIT_REGISTRY[(strategySelected as keyof typeof STRATEGY_AUDIT_REGISTRY)] ?? STRATEGY_AUDIT_REGISTRY.unknown;
        isWait = false;
        finalEntryRule = String(strategySelected).toUpperCase() + '_READY';
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
          strategySelected = 'wait';
          finalEntryRule = 'WAITING_FOR_SETUP';
          logger.info(`STRATEGY_DOWNGRADE_FAILED: symbol=${candidate.symbol} downgradedTo=${strategySelected} contractCheckAfterDowngrade=${String(recheck.contractValid)} invalidReason=${recheck.invalidReason} finalExecutable=${String(finalExecutable)} validatorStage=builder_final_guard_downgrade_failed`);
        } else {
          // Downgrade passed, but verify momentum isn't fake (no rebound after dip-based strategy)
          const wasDipBased = !/wait|unknown|avoid/.test(String(candidate.selectedStrategy ?? '').toLowerCase());
          const isNowMomentum = strategySelected === 'momentum';
          const noRebound = reboundPct == null || reboundPct <= 0;
          const weakMomentum = !momentumConfirmed;
          const origWasDipOrConservative = /dip_and_rebound|conservative/.test(String(candidate.selectedStrategy ?? ''
).toLowerCase());
          if (isNowMomentum && origWasDipOrConservative && noRebound) {
            finalExecutable = false;
            strategySelected = 'wait';
            finalEntryRule = 'WAITING_FOR_SETUP';
            logger.warn(`STRATEGY_DOWNGRADE_TO_MOMENTUM_REJECTED: symbol=${candidate.symbol} originalCandidateStrategy=${candidate.selectedStrategy} finalExecutionStrategy=momentum downgradeApplied=false dipPct=${dipDepthPct ?? 'n/a'} reboundPct=${reboundPct ?? 'n/a'} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} trend=${candidate.groupTrend ?? 'n/a'} marketTrend=${candidate.periodTrend ?? 'n/a'} btcContext=n/a ethContext=n/a htf=${candidate.periodTrend ?? 'n/a'} marketAction=${candidate.periodRegime ?? 'n/a'} strongMomentumOverrideEligible=false finalExecutable=${String(finalExecutable)} blockReason=rebound_missing_after_dip_based_downgrade`);
            logger.info(`MOMENTUM_BLOCKED_NO_REBOUND: symbol=${candidate.symbol} downgradeFrom=${candidate.selectedStrategy} momentumConfirmed=${String(momentumConfirmed)} reboundPct=${reboundPct ?? 0} blockReason=conservative_downgrade_rejected_no_rebound`);
          }
          if (isNowMomentum && weakMomentum) {
            finalExecutable = false;
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
        finalEntryRule = 'WAITING_FOR_SETUP';
        logger.info(`STRATEGY_CONTRACT_HARD_FAIL: symbol=${candidate.symbol} strategySelected=${strategySelected} contractValid=false invalidReason=${contractCheck.invalidReason} finalExecutable=${String(finalExecutable)} action=fixed_finalExecutable_false validatorStage=builder_final_guard`);
      }
    }
  }
  {
    const dp = dipDepthPct ?? (reboundPct != null && reboundPct > 0 ? (rawDipPct ?? 0) : null);
    const reboundIsOld = reboundPct != null && reboundPct > 20; // >20% rebound likely from old reference
    const reboundOverextended = reboundPct != null && reboundPct > 30;
    logger.info(`REBOUND_FRESHNESS_AUDIT: symbol=${candidate.symbol} strategy=${strategySelected} scannerPeriod=${candidate.referencePeriod ?? candidate.periodTrend ?? 'n/a'} dipAtEntry=${dp ?? 'n/a'} reboundAtEntry=${reboundPct ?? 'n/a'} dipConfirmed=${String(dipConfirmed)} reboundConfirmed=${String(reboundConfirmed)} dipLowTimestamp=n/a reboundTimestamp=n/a reboundAgeMs=n/a maxAllowedReboundAgeMs=n/a reboundFromSameDip=${String(dp != null && reboundPct != null)} overextended=${String(reboundOverextended)} blockReason=${!finalExecutable ? (reboundOverextended ? 'REBOUND_OVEREXTENDED' : reboundIsOld ? 'REBOUND_TOO_LATE' : 'none') : 'none'}`);
    if (strategySelected === 'balanced') {
      logger.info(`BALANCED_ENTRY_CONTRACT_AUDIT: symbol=${candidate.symbol} finalExecutedStrategy=balanced entryRuleAtEntry=${finalEntryRule} dipPctAtEntry=${dipDepthPct ?? 'n/a'} reboundPctAtEntry=${reboundPct ?? 'n/a'} requiredDipPctAtEntry=n/a requiredReboundPctAtEntry=0.4 momentumConfirmedAtEntry=${String(momentumConfirmed)} weakMomentumConfirmedAtEntry=n/a balancedMinDipSetting=n/a balancedMinReboundSetting=0.4 balancedUsesDipAsRequired=false balancedUsesReboundAsRequired=true balancedUsesMomentumAsRequired=false contractValid=${String(finalExecutable)} contractViolationReason=${finalExecutable ? 'none' : 'rebound_below_required'} finalExecutable=${String(finalExecutable)} buyAllowed=${String(finalExecutable)} sourceUsed=balanced_contract_rebound_required`);
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
    : (!requiredSetupPassed ? (spreadOk ? 'WAITING_CONFIRMATION' : 'BLOCKED_BY_SPREAD') : (!finalExecutable ? (spreadOk ? 'WAITING_EXECUTION_GATE' : 'BLOCKED_BY_SPREAD') : (strategySelected === 'balanced' ? 'BALANCED_OK' : 'SETUP_OK')));
  const primaryBlocker = resolveCanonicalPrimaryBlocker({
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

  logger.info(`FINAL_STRATEGY_SOURCE_AUDIT: symbol=${candidate.symbol} marketBestFit=${marketRecommendedStrategy ?? 'n/a'} userSelectedRuntimeStrategy=${strategyRequested} strategySource=${strategySource} dynamicPerCoinStrategy=${String(strategyRequested !== strategySelected)} perCoinSelectedStrategy=${candidate.selectedStrategy ?? 'n/a'} strategyAfterAuditBuilder=${strategySelected} finalExecutionStrategy=${strategySelected} positionStrategyAtEntry=${strategySelected} strategyMismatchDetected=${String(candidate.selectedStrategy !== strategySelected)} mismatchAllowed=${String(strategyRequested !== strategySelected || true)} mismatchReason=${candidate.selectedStrategy !== strategySelected ? 'audit_builder_resolved_per_coin' : strategyRequested !== strategySelected ? 'runtime_strategy_vs_per_coin' : 'unchanged'} executionAllowed=${String(finalExecutable)}`);

  return {
    symbol: candidate.symbol,
    selectedStrategy: strategySelected,
    strategyRequested,
    strategySelected,
    strategySource,
    marketRecommendedStrategy,
    runtimeActiveStrategy,
    finalPerCoinStrategy,
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
      primaryBlocker,
      source: 'buildStrategyAuditSnapshotFromCandidate.dynamic-regime',
    },
    createdAt: new Date().toISOString(),
  };
}
