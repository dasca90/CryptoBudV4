import type { StrategyAuditKey } from './strategy-audit-types';

type MetricRole = 'required' | 'optional' | 'advisory' | 'blocker' | 'unused';

export interface StrategyAuditDefinition {
  strategyKey: StrategyAuditKey;
  strategyLabel: string;
  classification: string;
  requiredSetup: string[];
  optionalSetup: string[];
  blockers: string[];
  metricRoles: {
    dip: MetricRole;
    rebound: MetricRole;
    momentum: MetricRole;
    spread: MetricRole;
    tpRoom: MetricRole;
    priceFresh: MetricRole;
    conservativeSafetyScore?: MetricRole;
    safePullback?: MetricRole;
  };
  minDipPct: number | null;
  minReboundPct: number | null;
  momentumRequirement: 'required' | 'optional' | 'advisory' | 'unused';
  reboundRequirement: 'required' | 'optional' | 'advisory' | 'unused';
  finalExecutableRequirement: 'required' | 'optional';
}

export const STRATEGY_AUDIT_REGISTRY: Record<StrategyAuditKey, StrategyAuditDefinition> = {
  momentum: {
    strategyKey: 'momentum',
    strategyLabel: 'Momentum',
    classification: 'continuation / strong momentum',
    requiredSetup: ['momentumConfirmed', 'reboundConfirmed', 'priceFresh', 'spreadOk', 'tpRoomOk', 'finalExecutable'],
    optionalSetup: ['dipObserved'],
    blockers: ['spreadOk', 'tpRoomOk', 'priceFresh'],
    metricRoles: {
      dip: 'advisory',
      rebound: 'required',
      momentum: 'required',
      spread: 'blocker',
      tpRoom: 'blocker',
      priceFresh: 'blocker',
    },
    minDipPct: null,
    minReboundPct: null,
    momentumRequirement: 'required',
    reboundRequirement: 'required',
    finalExecutableRequirement: 'required',
  },
  balanced: {
    strategyKey: 'balanced',
    strategyLabel: 'Balanced',
    classification: 'weaker momentum / moderate confirmation',
    requiredSetup: ['priceFresh', 'spreadOk', 'tpRoomOk', 'finalExecutable'],
    optionalSetup: ['momentumConfirmed', 'reboundConfirmed', 'dipObserved'],
    blockers: ['spreadOk', 'tpRoomOk', 'priceFresh'],
    metricRoles: {
      dip: 'advisory',
      rebound: 'required',
      momentum: 'optional',
      spread: 'blocker',
      tpRoom: 'blocker',
      priceFresh: 'blocker',
    },
    minDipPct: null,
    minReboundPct: null,
    momentumRequirement: 'optional',
    reboundRequirement: 'required',
    finalExecutableRequirement: 'required',
  },
  conservative: {
    strategyKey: 'conservative',
    strategyLabel: 'Conservative',
    classification: 'defensive pullback / safer rebound',
    requiredSetup: ['dipConfirmed', 'reboundConfirmed', 'priceFresh', 'spreadOk', 'tpRoomOk', 'finalExecutable'],
    optionalSetup: ['conservativeSafetyScore', 'safePullbackConfirmed', 'momentumObserved'],
    blockers: ['spreadOk', 'tpRoomOk', 'priceFresh'],
    metricRoles: {
      dip: 'required',
      rebound: 'required',
      momentum: 'advisory',
      spread: 'blocker',
      tpRoom: 'blocker',
      priceFresh: 'blocker',
      conservativeSafetyScore: 'optional',
      safePullback: 'optional',
    },
    minDipPct: 2.0,
    minReboundPct: 1.0,
    momentumRequirement: 'advisory',
    reboundRequirement: 'required',
    finalExecutableRequirement: 'required',
  },
  dip_and_rebound: {
    strategyKey: 'dip_and_rebound',
    strategyLabel: 'Dip and Rebound',
    classification: 'reversal / dip recovery',
    requiredSetup: ['dipConfirmed', 'reboundConfirmed', 'priceFresh', 'spreadOk', 'tpRoomOk', 'finalExecutable'],
    optionalSetup: ['momentumConfirmed'],
    blockers: ['spreadOk', 'tpRoomOk', 'priceFresh'],
    metricRoles: {
      dip: 'required',
      rebound: 'required',
      momentum: 'optional',
      spread: 'blocker',
      tpRoom: 'blocker',
      priceFresh: 'blocker',
    },
    minDipPct: 0.8,
    minReboundPct: 0.4,
    momentumRequirement: 'optional',
    reboundRequirement: 'required',
    finalExecutableRequirement: 'required',
  },
  wait: {
    strategyKey: 'wait',
    strategyLabel: 'Wait',
    classification: 'no entry',
    requiredSetup: [],
    optionalSetup: [],
    blockers: [],
    metricRoles: { dip: 'unused', rebound: 'unused', momentum: 'unused', spread: 'optional', tpRoom: 'optional', priceFresh: 'optional' },
    minDipPct: null,
    minReboundPct: null,
    momentumRequirement: 'unused',
    reboundRequirement: 'unused',
    finalExecutableRequirement: 'optional',
  },
  avoid: {
    strategyKey: 'avoid',
    strategyLabel: 'Avoid',
    classification: 'blocked',
    requiredSetup: [],
    optionalSetup: [],
    blockers: [],
    metricRoles: { dip: 'unused', rebound: 'unused', momentum: 'unused', spread: 'optional', tpRoom: 'optional', priceFresh: 'optional' },
    minDipPct: null,
    minReboundPct: null,
    momentumRequirement: 'unused',
    reboundRequirement: 'unused',
    finalExecutableRequirement: 'optional',
  },
  unknown: {
    strategyKey: 'unknown',
    strategyLabel: 'Unknown',
    classification: 'unknown',
    requiredSetup: [],
    optionalSetup: [],
    blockers: [],
    metricRoles: { dip: 'unused', rebound: 'unused', momentum: 'unused', spread: 'optional', tpRoom: 'optional', priceFresh: 'optional' },
    minDipPct: null,
    minReboundPct: null,
    momentumRequirement: 'unused',
    reboundRequirement: 'unused',
    finalExecutableRequirement: 'optional',
  },
};
