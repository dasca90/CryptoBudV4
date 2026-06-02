import type { TradeRecord, MLLabel, CloseSnapshot, BuySnapshot } from '../types';

export function createMLLabel(trade: TradeRecord): MLLabel {
  const buy = trade.buySnapshot;
  const close = trade.closeSnapshot;

  const pnlPercent = trade.pnlPercent ?? 0;
  const durationMs = close?.durationMs ?? 0;
  const mfe = close?.mfePercent ?? null;
  const mae = close?.maePercent ?? null;
  const hitTp1 = close?.exitReason === 'TP1_FIXED' || close?.exitReason === 'TP2_FIXED' || false;
  const hitTp2 = close?.exitReason === 'TP2_FIXED' || false;
  const hitStopLoss = close?.exitReason === 'STOP_LOSS' || false;

  let outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'UNKNOWN' = 'UNKNOWN';
  if (pnlPercent > 0.1) outcome = 'WIN';
  else if (pnlPercent < -0.1) outcome = 'LOSS';
  else if (trade.status === 'closed') outcome = 'BREAKEVEN';

  const badEntryReasons: string[] = [];
  const goodEntryReasons: string[] = [];

  if (buy?.entryGateDecision?.blockReasons && buy.entryGateDecision.blockReasons.length > 0) {
    badEntryReasons.push(...buy.entryGateDecision.blockReasons.map(r => `entryGate_warn_${r}`));
  }

  if (buy?.traderBrainDecision?.warnings) {
    badEntryReasons.push(...buy.traderBrainDecision.warnings.map(w => `brain_warn_${w}`));
  }

  if (outcome === 'WIN' && mfe !== null && mfe > 0) {
    goodEntryReasons.push('positive_mfe');
  }

  if (outcome === 'LOSS' && mae !== null && mae !== 0) {
    const deeplyNegative = mae < -5;
    if (deeplyNegative) badEntryReasons.push('deep_mae_before_recovery');
    if (hitStopLoss) badEntryReasons.push('stopped_out');
  }

  if (close?.isRealMarketPrice === false) {
    badEntryReasons.push('non_real_close_price');
  }

  let entryTimingLabel: 'EARLY' | 'GOOD' | 'LATE' | 'UNKNOWN' = 'UNKNOWN';
  if (outcome === 'WIN' && mfe !== null && mfe > pnlPercent * 1.5) {
    entryTimingLabel = 'GOOD';
  } else if (outcome === 'LOSS' && mae !== null && mae < pnlPercent * 2) {
    entryTimingLabel = 'LATE';
  } else if (outcome === 'WIN') {
    entryTimingLabel = 'GOOD';
  } else if (outcome === 'LOSS') {
    entryTimingLabel = 'LATE';
  }

  let exitTimingLabel: 'GOOD_EXIT' | 'EARLY_EXIT' | 'LATE_EXIT' | 'STOPPED_OUT' | 'UNKNOWN' = 'UNKNOWN';
  if (hitStopLoss) exitTimingLabel = 'STOPPED_OUT';
  else if (hitTp1 || hitTp2) exitTimingLabel = 'GOOD_EXIT';
  else if (close?.exitReason === 'TIME_BASED_EXIT') exitTimingLabel = 'LATE_EXIT';
  else if (pnlPercent > 0 && mfe !== null && mfe > pnlPercent * 2) exitTimingLabel = 'EARLY_EXIT';
  else if (pnlPercent > 0) exitTimingLabel = 'GOOD_EXIT';
  else if (pnlPercent < 0) exitTimingLabel = 'LATE_EXIT';

  let trainingTarget: 'WIN' | 'LOSS' | null = null;
  if (outcome === 'WIN') trainingTarget = 'WIN';
  else if (outcome === 'LOSS') trainingTarget = 'LOSS';

  const goodEntry = goodEntryReasons.length > 0 ? true : (badEntryReasons.length > 0 ? false : null);
  const badEntry = badEntryReasons.length > 0 ? true : (goodEntryReasons.length > 0 ? false : null);
  const goodExit = exitTimingLabel === 'GOOD_EXIT' ? true : (exitTimingLabel === 'STOPPED_OUT' || exitTimingLabel === 'LATE_EXIT' ? false : null);
  const badExit = exitTimingLabel === 'STOPPED_OUT' || exitTimingLabel === 'LATE_EXIT' ? true : (exitTimingLabel === 'GOOD_EXIT' ? false : null);

  return {
    tradeId: trade.tradeId,
    symbol: trade.coin,
    mode: trade.mode,
    adapter: trade.adapter,
    selectedStrategy: trade.strategy,
    riskGroup: buy?.riskGroup ?? null,
    marketRegime: buy?.marketRegime ?? null,
    outcome,
    goodEntry,
    badEntry,
    goodExit,
    badExit,
    hitTp1,
    hitTp2,
    hitStopLoss,
    maxFavorableExcursionPct: mfe ?? 0,
    maxAdverseExcursionPct: mae ?? 0,
    pnlPercent,
    durationMs,
    entryTimingLabel,
    exitTimingLabel,
    badEntryReasons,
    goodEntryReasons,
    trainingTarget,
  };
}
