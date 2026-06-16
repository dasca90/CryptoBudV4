export type ExecutableStrategy = 'momentum' | 'balanced' | 'dip_and_rebound' | 'conservative';
export type MarketRegimeBucket = 'bullish_selective' | 'sideways_range' | 'bearish_risk_off' | 'unknown';

export interface StrategyContract {
  strategy: ExecutableStrategy;
  label: string;
  dip: 'required' | 'advisory';
  rebound: 'required' | 'advisory';
  momentum: 'required' | 'optional' | 'advisory';
  defaultMinDipPct: number | null;
  defaultMinReboundPct: number | null;
  dynamicDipThresholds: Record<MarketRegimeBucket, number | null>;
  dynamicReboundThresholds: Record<MarketRegimeBucket, number | null>;
  requiredDipCanBeNA: boolean;
  requiredReboundCanBeNA: boolean;
  observedOnlyAccepted: boolean;
  validFinalEntryRules: string[];
  strongDipRequired: boolean;
  strongReboundRequired: boolean;
}

export const STRATEGY_CONTRACTS: Record<ExecutableStrategy, StrategyContract> = {
  momentum: {
    strategy: 'momentum',
    label: 'Momentum',
    dip: 'advisory',
    rebound: 'required',
    momentum: 'required',
    defaultMinDipPct: null,
    defaultMinReboundPct: 0.8,
    dynamicDipThresholds: { bullish_selective: null, sideways_range: null, bearish_risk_off: null, unknown: null },
    dynamicReboundThresholds: { bullish_selective: 0.8, sideways_range: 0.8, bearish_risk_off: 0.8, unknown: null },
    requiredDipCanBeNA: true,
    requiredReboundCanBeNA: false,
    observedOnlyAccepted: false,
    validFinalEntryRules: ['MOMENTUM_READY'],
    strongDipRequired: false,
    strongReboundRequired: true,
  },
  balanced: {
    strategy: 'balanced',
    label: 'Balanced',
    dip: 'advisory',
    rebound: 'required',
    momentum: 'optional',
    defaultMinDipPct: null,
    defaultMinReboundPct: 0.4,
    dynamicDipThresholds: { bullish_selective: null, sideways_range: null, bearish_risk_off: null, unknown: null },
    dynamicReboundThresholds: { bullish_selective: 0.4, sideways_range: 0.4, bearish_risk_off: 0.4, unknown: null },
    requiredDipCanBeNA: true,
    requiredReboundCanBeNA: false,
    observedOnlyAccepted: false,
    validFinalEntryRules: ['BALANCED_READY'],
    strongDipRequired: false,
    strongReboundRequired: true,
  },
  dip_and_rebound: {
    strategy: 'dip_and_rebound',
    label: 'Dip and Rebound',
    dip: 'required',
    rebound: 'required',
    momentum: 'optional',
    defaultMinDipPct: 0.8,
    defaultMinReboundPct: 0.4,
    dynamicDipThresholds: { bullish_selective: 0.2, sideways_range: 0.8, bearish_risk_off: 1.2, unknown: null },
    dynamicReboundThresholds: { bullish_selective: 0.2, sideways_range: 0.4, bearish_risk_off: 0.7, unknown: null },
    requiredDipCanBeNA: false,
    requiredReboundCanBeNA: false,
    observedOnlyAccepted: false,
    validFinalEntryRules: ['DIP_AND_REBOUND_READY', 'DIP_REBOUND_READY'],
    strongDipRequired: true,
    strongReboundRequired: true,
  },
  conservative: {
    strategy: 'conservative',
    label: 'Conservative',
    dip: 'required',
    rebound: 'required',
    momentum: 'advisory',
    defaultMinDipPct: 2.0,
    defaultMinReboundPct: 1.0,
    dynamicDipThresholds: { bullish_selective: 0.6, sideways_range: 2.0, bearish_risk_off: 2.5, unknown: null },
    dynamicReboundThresholds: { bullish_selective: 0.4, sideways_range: 1.0, bearish_risk_off: 1.2, unknown: null },
    requiredDipCanBeNA: false,
    requiredReboundCanBeNA: false,
    observedOnlyAccepted: false,
    validFinalEntryRules: ['CONSERVATIVE_READY'],
    strongDipRequired: true,
    strongReboundRequired: true,
  },
};

import { logger } from '../../utils/logger';

for (const [key, c] of Object.entries(STRATEGY_CONTRACTS)) {
  logger.info(`STRATEGY_CONTRACT_SOURCE_OF_TRUTH_AUDIT: strategy=${key} momentumRequired=${String(c.momentum === 'required')} dipRequired=${String(c.dip === 'required')} reboundRequired=${String(c.rebound === 'required')} minDipPct=${c.defaultMinDipPct ?? 'n/a'} minReboundPct=${c.defaultMinReboundPct ?? 'n/a'} safePullbackRequired=false conservativeSafetyRequired=false`);
}

export function getStrategyContract(strategy: string): StrategyContract | null {
  const s = String(strategy ?? '').toLowerCase();
  if (s === 'momentum') return STRATEGY_CONTRACTS.momentum;
  if (s === 'balanced') return STRATEGY_CONTRACTS.balanced;
  if (s === 'dip_and_rebound') return STRATEGY_CONTRACTS.dip_and_rebound;
  if (s === 'conservative') return STRATEGY_CONTRACTS.conservative;
  return null;
}

export function validateStrategyContract(params: {
  strategy: string;
  finalEntryRule: string;
  marketRegimeBucket: MarketRegimeBucket;
  dipDepthPct: number | null;
  requiredDipPct?: number | null;
  dipConfirmed?: boolean;
  reboundPct: number | null;
  requiredReboundPct?: number | null;
  reboundConfirmed?: boolean;
  momentumConfirmed?: boolean;
  finalExecutable?: boolean;
}): { contractValid: boolean; invalidReason: string } {
  const contract = getStrategyContract(params.strategy);
  if (!contract) return { contractValid: false, invalidReason: 'unknown_strategy' };

  const bucket = params.marketRegimeBucket;
  const effectiveRequiredDip = params.requiredDipPct ?? contract.dynamicDipThresholds[bucket] ?? contract.defaultMinDipPct;
  const effectiveRequiredRebound = params.requiredReboundPct ?? contract.dynamicReboundThresholds[bucket] ?? contract.defaultMinReboundPct;

  // Dip validation for required strategies
  if (contract.dip === 'required') {
    if (!contract.requiredDipCanBeNA && (effectiveRequiredDip == null || effectiveRequiredDip == null)) {
      return { contractValid: false, invalidReason: 'requiredDipPct_missing_or_n/a' };
    }
    if (params.dipDepthPct == null || params.dipDepthPct <= 0) {
      return { contractValid: false, invalidReason: 'actualDipPct_missing_or_zero' };
    }
    if (effectiveRequiredDip != null && params.dipDepthPct < effectiveRequiredDip) {
      return { contractValid: false, invalidReason: 'dip_below_required' };
    }
    if (params.dipConfirmed !== undefined && !params.dipConfirmed && !contract.observedOnlyAccepted) {
      return { contractValid: false, invalidReason: 'dip_not_confirmed' };
    }
  }

  // Rebound validation for required strategies
  if (contract.rebound === 'required') {
    if (!contract.requiredReboundCanBeNA && (effectiveRequiredRebound == null || effectiveRequiredRebound == null)) {
      return { contractValid: false, invalidReason: 'requiredReboundPct_missing_or_n/a' };
    }
    if (params.reboundPct == null || params.reboundPct <= 0) {
      return { contractValid: false, invalidReason: 'actualReboundPct_missing_or_zero' };
    }
    if (effectiveRequiredRebound != null && params.reboundPct < effectiveRequiredRebound) {
      return { contractValid: false, invalidReason: 'rebound_below_required' };
    }
    if (params.reboundConfirmed !== undefined && !params.reboundConfirmed && !contract.observedOnlyAccepted) {
      return { contractValid: false, invalidReason: 'rebound_not_confirmed' };
    }
  }

  // Momentum validation
  if (contract.momentum === 'required' && params.momentumConfirmed !== undefined && !params.momentumConfirmed) {
    return { contractValid: false, invalidReason: 'momentum_not_confirmed' };
  }

  // Final executable check
  if (params.finalExecutable !== undefined && !params.finalExecutable) {
    return { contractValid: false, invalidReason: 'finalExecutable_false' };
  }

  return { contractValid: true, invalidReason: 'none' };
}

export function getRequiredDipForContract(strategy: string, bucket: MarketRegimeBucket): number | null {
  const contract = getStrategyContract(strategy);
  if (!contract) return null;
  return contract.dynamicDipThresholds[bucket] ?? contract.defaultMinDipPct;
}

export function getRequiredReboundForContract(strategy: string, bucket: MarketRegimeBucket): number | null {
  const contract = getStrategyContract(strategy);
  if (!contract) return null;
  return contract.dynamicReboundThresholds[bucket] ?? contract.defaultMinReboundPct;
}
