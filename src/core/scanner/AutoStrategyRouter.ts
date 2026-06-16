import type { AutoStrategyName, StrategyConfidenceTier, StrategySourceOwner, StrategySourceDetail } from '../types';
import type { AutoStrategyDecision } from '../types';
import { logger } from '../../utils/logger';
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
      return ret('wait', 'AutoBots_SafeFallback', 'confidence_below_tier', 'Caution group and confidence below tier — waiting', ['CONFIDENCE_BELOW_TIER', 'GROUP_VOLATILITY_CAUTION'], { blockedByConfidence: true, confidenceAdjustment: 0 });
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
