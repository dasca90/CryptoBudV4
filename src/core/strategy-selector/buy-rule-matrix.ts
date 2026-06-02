import type { BuyRuleName, BuyRuleDefinition, UnifiedEntryInput, UnifiedEntrySignal, RuleProfile, SignalStatus } from '../types';

const RULES: Record<BuyRuleName, BuyRuleDefinition> = {
  dip_and_rebound: {
    buyRule: 'dip_and_rebound', family: 'dip', profile: 'cautious',
    dipRequired: true, reboundRequired: true, dipUsed: true, reboundUsed: true,
    profileAdjustable: false, explanationLabel: 'Requires dip + confirmed rebound',
  },
  dip_only: {
    buyRule: 'dip_only', family: 'dip', profile: 'aggressive',
    dipRequired: true, reboundRequired: false, dipUsed: true, reboundUsed: false,
    profileAdjustable: false, explanationLabel: 'Buys the dip without rebound confirmation',
  },
  conservative: {
    buyRule: 'conservative', family: 'balanced', profile: 'cautious',
    dipRequired: true, reboundRequired: true, dipUsed: true, reboundUsed: true,
    profileAdjustable: true, explanationLabel: 'Requires deep dip + rebound with defensive confirmation',
  },
  aggressive: {
    buyRule: 'aggressive', family: 'momentum', profile: 'aggressive',
    dipRequired: false, reboundRequired: false, dipUsed: false, reboundUsed: false,
    profileAdjustable: true, explanationLabel: 'Enters early on momentum signals',
  },
  balanced: {
    buyRule: 'balanced', family: 'balanced', profile: 'moderate',
    dipRequired: false, reboundRequired: true, dipUsed: false, reboundUsed: true,
    profileAdjustable: false, explanationLabel: 'Requires rebound confirmation, protects against falling knife',
  },
  grid: {
    buyRule: 'grid', family: 'grid', profile: 'moderate',
    dipRequired: true, reboundRequired: false, dipUsed: true, reboundUsed: false,
    profileAdjustable: false, explanationLabel: 'Prefers range or dip for grid entries',
  },
  dca: {
    buyRule: 'dca', family: 'dca', profile: 'cautious',
    dipRequired: true, reboundRequired: false, dipUsed: true, reboundUsed: false,
    profileAdjustable: false, explanationLabel: 'Waits for smaller dip, scales in',
  },
  momentum: {
    buyRule: 'momentum', family: 'momentum', profile: 'aggressive',
    dipRequired: false, reboundRequired: true, dipUsed: false, reboundUsed: true,
    profileAdjustable: false, explanationLabel: 'Requires momentum confirmation + rebound confirmation',
  },
  smart: {
    buyRule: 'smart', family: 'adaptive', profile: 'moderate',
    dipRequired: false, reboundRequired: false, dipUsed: false, reboundUsed: false,
    profileAdjustable: true, explanationLabel: 'Adaptive rule based on market conditions',
  },
};

export function getBuyRuleEntryDefinition(buyRule: BuyRuleName): BuyRuleDefinition {
  return RULES[buyRule] ?? RULES.conservative;
}

export function evaluateUnifiedEntrySignal(input: UnifiedEntryInput): UnifiedEntrySignal {
  const def = getBuyRuleEntryDefinition(input.buyRule);

  let dipPassed = true;
  let reboundPassed = true;
  let signal: SignalStatus = 'HOLD';
  let confidence = 0;
  let reasonCode = '';
  let reason = '';
  let waitingReason: string | null = null;

  const absDipPct = Math.abs(input.dipPercent ?? 0);
  const reboundPct = input.reboundPct ?? 0;
  const requiredDipPct = input.buyRule === 'dip_and_rebound' ? 0.8 : input.buyRule === 'conservative' ? 2.0 : 0;
  const requiredReboundPct = input.buyRule === 'dip_and_rebound' ? 0.4 : input.buyRule === 'conservative' ? 1.0 : 0;

  if (def.dipRequired && (!input.dipDetected || absDipPct < requiredDipPct)) {
    dipPassed = false;
    waitingReason = requiredDipPct > 0 ? `Dip too small (${absDipPct.toFixed(2)}% < ${requiredDipPct.toFixed(2)}%)` : 'No dip detected';
  }

  if (def.reboundRequired && (!input.reboundConfirmed || reboundPct < requiredReboundPct)) {
    reboundPassed = false;
    waitingReason = waitingReason ?? (requiredReboundPct > 0
      ? `Rebound too weak (${reboundPct.toFixed(2)}% < ${requiredReboundPct.toFixed(2)}%)`
      : 'Rebound not confirmed');
  }

  if (!dipPassed || !reboundPassed) {
    signal = 'WAITING';
    reasonCode = 'WAITING_FOR_SETUP';
    reason = waitingReason ?? 'Conditions not met';
    return { signal, confidence, reasonCode, reason, waitingReason, dipPassed, reboundPassed, definition: def };
  }

  switch (input.buyRule) {
    case 'conservative': {
      if (input.isDowntrend) {
        signal = 'WAITING';
        reasonCode = 'DOWNTREND_BLOCK';
        waitingReason = 'Downtrend — conservative waits';
        reason = 'Downtrend active, conservative blocks';
      } else if (input.btcDumping) {
        signal = 'WAITING';
        reasonCode = 'BTC_DUMP';
        waitingReason = 'BTC dumping';
        reason = 'BTC dumping, conservative waits';
      } else {
        signal = 'BUY';
        confidence = 0.7;
        reasonCode = 'CONSERVATIVE_BUY';
        reason = 'Conservative setup ok';
      }
      break;
    }

    case 'balanced': {
      if (input.isDowntrend && input.dipDetected && !input.reboundConfirmed) {
        signal = 'WAITING';
        reasonCode = 'FALLING_KNIFE';
        waitingReason = 'Falling knife — weak rebound, balanced waits';
        reason = 'Deep dip with weak rebound, balanced protects';
      } else if (input.reboundConfirmed && input.dipDetected) {
        signal = 'BUY';
        confidence = 0.75;
        reasonCode = 'BALANCED_DIP_REBOUND';
        reason = 'Dip + rebound confirmed';
      } else if (input.momentumConfirmed) {
        signal = 'BUY';
        confidence = 0.65;
        reasonCode = 'BALANCED_MOMENTUM';
        reason = 'Momentum confirmed';
      } else {
        signal = 'WAITING';
        reasonCode = 'BALANCED_WAITING';
        waitingReason = 'No dip/rebound or momentum';
        reason = 'Balanced waiting for confirmation';
      }
      break;
    }

    case 'aggressive': {
      if (input.momentumConfirmed || input.momentum > 0.001) {
        signal = 'BUY';
        confidence = 0.6;
        reasonCode = 'AGGRESSIVE_MOMENTUM';
        reason = 'Early momentum entry';
      } else if (input.dipDetected) {
        signal = 'BUY';
        confidence = 0.5;
        reasonCode = 'AGGRESSIVE_DIP';
        reason = 'Buying dip aggressively';
      } else {
        signal = 'WAITING';
        reasonCode = 'AGGRESSIVE_WAITING';
        waitingReason = 'No momentum or dip';
        reason = 'Aggressive waiting for signal';
      }
      break;
    }

    case 'momentum': {
      if (input.momentumConfirmed && (input.isUptrend || input.momentum > 0.002)) {
        signal = 'BUY';
        confidence = 0.8;
        reasonCode = 'MOMENTUM_BUY';
        reason = 'Strong momentum in uptrend';
      } else if (!input.momentumConfirmed && input.momentum > 0) {
        signal = 'WAITING';
        reasonCode = 'MOMENTUM_WEAK';
        waitingReason = 'Momentum weak, not confirmed';
        reason = 'Momentum positive but below threshold';
      } else {
        signal = 'WAITING';
        reasonCode = 'NO_MOMENTUM';
        waitingReason = 'No momentum';
        reason = 'No positive momentum detected';
      }
      break;
    }

    case 'dip_and_rebound': {
      if (input.dipDetected && input.reboundConfirmed) {
        signal = 'BUY';
        confidence = 0.85;
        reasonCode = 'DIP_REBOUND_BUY';
        reason = 'Clean dip + rebound';
      } else {
        signal = 'WAITING';
        reasonCode = 'DIP_REBOUND_WAITING';
        waitingReason = input.dipDetected ? 'Rebound not confirmed' : 'No dip detected';
        reason = 'Waiting for dip and rebound';
      }
      break;
    }

    case 'dip_only': {
      if (input.dipDetected) {
        signal = 'BUY';
        confidence = 0.55;
        reasonCode = 'DIP_ONLY_BUY';
        reason = 'Buying dip without rebound';
      } else {
        signal = 'WAITING';
        reasonCode = 'NO_DIP';
        waitingReason = 'No dip detected';
        reason = 'Dip only waiting for dip';
      }
      break;
    }

    case 'grid': {
      if (input.dipDetected || input.isSideways || input.isChoppy) {
        signal = 'BUY';
        confidence = 0.65;
        reasonCode = 'GRID_ENTRY';
        reason = 'Grid entry in range or dip';
      } else {
        signal = 'WAITING';
        reasonCode = 'GRID_WAITING';
        waitingReason = 'No range or dip';
        reason = 'Grid waiting for range condition';
      }
      break;
    }

    case 'dca': {
      if (input.dipDetected && input.dipPercent < -1) {
        signal = 'BUY';
        confidence = 0.7;
        reasonCode = 'DCA_ENTRY';
        reason = 'DCA buying smaller dip';
      } else if (input.dipDetected) {
        signal = 'WAITING';
        reasonCode = 'DCA_DIP_TOO_SMALL';
        waitingReason = 'Dip too small for DCA';
        reason = 'DCA waiting for deeper dip';
      } else {
        signal = 'WAITING';
        reasonCode = 'DCA_WAITING';
        waitingReason = 'No dip';
        reason = 'DCA waiting for dip';
      }
      break;
    }

    case 'smart': {
      if (input.isUptrend && input.momentumConfirmed) {
        signal = 'BUY';
        confidence = 0.8;
        reasonCode = 'SMART_UPTREND';
        reason = 'Smart entry in uptrend';
      } else if (input.dipDetected && input.reboundConfirmed) {
        signal = 'BUY';
        confidence = 0.75;
        reasonCode = 'SMART_DIP_REBOUND';
        reason = 'Smart dip + rebound';
      } else if (input.isDowntrend && input.dipDetected && !input.reboundConfirmed) {
        signal = 'WAITING';
        reasonCode = 'SMART_FALLING_KNIFE';
        waitingReason = 'Falling knife, smart waits';
        reason = 'Smart avoids falling knife';
      } else if (input.btcDumping) {
        signal = 'WAITING';
        reasonCode = 'SMART_BTC_DUMP';
        waitingReason = 'BTC dumping, smart waits';
        reason = 'Smart avoids BTC dump';
      } else {
        signal = 'WAITING';
        reasonCode = 'SMART_WAITING';
        waitingReason = 'No clear setup';
        reason = 'Smart waiting for opportunity';
      }
      break;
    }

    default: {
      signal = 'WAITING';
      reasonCode = 'UNSUPPORTED_RULE';
      waitingReason = 'Unsupported buy rule';
      reason = `No implementation for rule: ${input.buyRule}`;
    }
  }

  return { signal, confidence, reasonCode, reason, waitingReason, dipPassed, reboundPassed, definition: def };
}
