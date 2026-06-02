export interface PostTradeInput {
  symbol: string;
  hasLastTrade: boolean;
  lastCloseReason: string;
  lastPnlPct: number;
  closedAtMs: number | null;
  reboundConfirmed: boolean;
  momentumConfirmed: boolean;
  volumeRel: number | null;
  groupTrend: string | null;
  spreadPct: number | null;
  tpRoomOk: boolean;
  priceFresh: boolean;
  maxSpread: number;
  minVolume: number;
}

export interface PostTradeReentryDecision {
  allowed: boolean;
  state: 'NO_PREVIOUS_TRADE' | 'RESET_AFTER_PROFIT' | 'WAITING_AFTER_LOSS' | 'RECOVERY_CONFIRMED' | 'BLOCKED_RECENT_LOSS';
  reason: string;
  requiredConfirmations: string[];
  lastPnlPct: number;
  recoveryScore: number;
}

export function evaluatePostTradeReentry(input: PostTradeInput): PostTradeReentryDecision {
  if (!input.hasLastTrade) {
    return {
      allowed: true,
      state: 'NO_PREVIOUS_TRADE',
      reason: 'No previous trade for this symbol.',
      requiredConfirmations: [],
      lastPnlPct: 0,
      recoveryScore: 100,
    };
  }

  const wasProfit = input.lastPnlPct > 0;

  if (wasProfit) {
    return {
      allowed: true,
      state: 'RESET_AFTER_PROFIT',
      reason: `Previous trade was profit (${input.lastPnlPct.toFixed(2)}%). State reset.`,
      requiredConfirmations: [],
      lastPnlPct: input.lastPnlPct,
      recoveryScore: 100,
    };
  }

  // Loss: require recovery confirmations
  const required: string[] = [];
  let recoveryScore = 0;

  if (input.reboundConfirmed) {
    recoveryScore += 30;
  } else {
    required.push('rebound_not_confirmed');
  }

  if (input.momentumConfirmed) {
    recoveryScore += 25;
  } else {
    required.push('momentum_not_confirmed');
  }

  const vol = input.volumeRel ?? 0;
  if (vol >= input.minVolume) {
    recoveryScore += 20;
  } else {
    required.push('volume_too_low');
  }

  if (input.spreadPct != null && input.spreadPct <= input.maxSpread) {
    recoveryScore += 10;
  } else {
    required.push('spread_too_high');
  }

  if (input.tpRoomOk) recoveryScore += 10;
  else required.push('no_tp_room');

  if (input.priceFresh) recoveryScore += 5;
  else required.push('price_stale');

  if (input.groupTrend && input.groupTrend !== 'bearish' && input.groupTrend !== 'bearish_or_unsafe') {
    recoveryScore += 10;
  }

  const recovered = recoveryScore >= 60;

  if (recovered) {
    return {
      allowed: true,
      state: 'RECOVERY_CONFIRMED',
      reason: `Recovery confirmed (score=${recoveryScore}). Ready for re-evaluation.`,
      requiredConfirmations: [],
      lastPnlPct: input.lastPnlPct,
      recoveryScore,
    };
  }

  return {
    allowed: false,
    state: required.length > 0 ? 'WAITING_AFTER_LOSS' : 'BLOCKED_RECENT_LOSS',
    reason: `Previous loss (${input.lastPnlPct.toFixed(2)}%). Recovery not confirmed (score=${recoveryScore}/60). Missing: ${required.join(', ')}.`,
    requiredConfirmations: required,
    lastPnlPct: input.lastPnlPct,
    recoveryScore,
  };
}
