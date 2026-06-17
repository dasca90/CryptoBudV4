import { logger } from '../../utils/logger';

export interface SmartModeGuardInput {
  symbol: string;
  entryMode: 'strict' | 'smart' | 'aggressive';
  strategy: string;
  momentum: number;
  dipPct: number;
  reboundPct: number;
  reboundFreshnessStatus: 'valid' | 'unknown' | 'stale';
  refPrice: number;
  currentPrice: number;
  overextended: boolean;
  candleExhaustion: boolean;
  priceFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  momentumConfirmed: boolean;
  marketAction: string;
}

export interface SmartModeGuardResult {
  allowed: boolean;
  downgraded: boolean;
  blockReason: string | null;
  warnings: string[];
}

const SMART_MAX_MOMENTUM_REBOUND_PCT = 12;
const SMART_MAX_DISTANCE_FROM_REF_PCT = 15;
const AGGRESSIVE_MAX_MOMENTUM_REBOUND_PCT = 25;
const AGGRESSIVE_MAX_DISTANCE_FROM_REF_PCT = 30;

export function evaluateSmartLateEntryGuard(input: SmartModeGuardInput): SmartModeGuardResult {
  const warnings: string[] = [];
  const isMomentum = input.strategy === 'momentum';
  const isSmartOrStrict = input.entryMode === 'smart' || input.entryMode === 'strict';

  // Gate 1: Candle exhaustion — always block in Smart/Strict
  if (input.candleExhaustion && isSmartOrStrict) {
    return {
      allowed: false,
      downgraded: true,
      blockReason: 'SMART_CANDLE_EXHAUSTION_BLOCK',
      warnings: ['Candle exhaustion detected — RSI extreme'],
    };
  }

  // Gate 2: Overextended — always block in Smart/Strict
  if (input.overextended && isSmartOrStrict) {
    return {
      allowed: false,
      downgraded: true,
      blockReason: 'SMART_OVEREXTENDED_BLOCK',
      warnings: ['Price overextended (RSI > 75) — waiting for pullback'],
    };
  }

  // Gate 3: Large rebound late entry — only for momentum strategies
  if (isMomentum && isSmartOrStrict) {
    const maxRebound = input.entryMode === 'smart' ? SMART_MAX_MOMENTUM_REBOUND_PCT : AGGRESSIVE_MAX_MOMENTUM_REBOUND_PCT;
    const maxDistanceFromRef = input.entryMode === 'smart' ? SMART_MAX_DISTANCE_FROM_REF_PCT : AGGRESSIVE_MAX_DISTANCE_FROM_REF_PCT;

    if (input.reboundPct > maxRebound) {
      warnings.push(`Rebound ${input.reboundPct.toFixed(1)}% exceeds Smart max ${maxRebound}% for momentum`);
      return {
        allowed: false,
        downgraded: true,
        blockReason: 'SMART_LATE_ENTRY_REBOUND_TOO_HIGH',
        warnings,
      };
    }

    // Gate 4: Price too far from reference
    if (input.refPrice > 0 && input.currentPrice > 0) {
      const distanceFromRef = Math.abs(((input.currentPrice - input.refPrice) / input.refPrice) * 100);
      if (distanceFromRef > maxDistanceFromRef) {
        warnings.push(`Price ${distanceFromRef.toFixed(1)}% from ref — exceeds max ${maxDistanceFromRef}%`);
        return {
          allowed: false,
          downgraded: true,
          blockReason: 'SMART_PRICE_TOO_FAR_FROM_REFERENCE',
          warnings,
        };
      }
    }

    // Gate 5: Unknown rebound freshness + large rebound
    if (input.reboundFreshnessStatus !== 'valid' && input.reboundPct > 8) {
      warnings.push(`Rebound freshness ${input.reboundFreshnessStatus} with large rebound ${input.reboundPct.toFixed(1)}%`);
      if (input.entryMode === 'smart') {
        return {
          allowed: false,
          downgraded: true,
          blockReason: 'SMART_REBOUND_FRESHNESS_UNKNOWN_LARGE',
          warnings,
        };
      }
    }
  }

  // Aggressive mode: block only on extreme values
  if (isMomentum && input.entryMode === 'aggressive') {
    if (input.reboundPct > AGGRESSIVE_MAX_MOMENTUM_REBOUND_PCT) {
      return {
        allowed: false,
        downgraded: true,
        blockReason: 'LATE_ENTRY_REBOUND_EXTREME',
        warnings: [`Rebound ${input.reboundPct.toFixed(1)}% exceeds aggressive max ${AGGRESSIVE_MAX_MOMENTUM_REBOUND_PCT}%`],
      };
    }
    if (input.candleExhaustion || input.overextended) {
      warnings.push(input.candleExhaustion ? 'Candle exhaustion' : 'Overextended');
      // Aggressive still allows through but warns
    }
  }

  logger.info(`SMART_LATE_ENTRY_GUARD_AUDIT symbol=${input.symbol} strategy=${input.strategy} entryMode=${input.entryMode} refPrice=${input.refPrice.toFixed(2)} currentPrice=${input.currentPrice.toFixed(2)} distanceFromRefPct=${input.refPrice > 0 ? (((input.currentPrice - input.refPrice) / input.refPrice) * 100).toFixed(1) : 'n/a'} reboundPct=${input.reboundPct.toFixed(2)} reboundFreshnessStatus=${input.reboundFreshnessStatus} candleExhaustion=${input.candleExhaustion} overextended=${input.overextended} maxAllowedReboundPct=${isMomentum ? (input.entryMode === 'smart' ? SMART_MAX_MOMENTUM_REBOUND_PCT : AGGRESSIVE_MAX_MOMENTUM_REBOUND_PCT) : 'n/a'} blocked=false blockReason=none`);

  return { allowed: true, downgraded: false, blockReason: null, warnings };
}
