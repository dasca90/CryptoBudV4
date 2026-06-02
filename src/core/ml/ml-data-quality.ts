import type { TradeRecord, CloseSnapshot, BuySnapshot, MLQualityResult, DataQuality, MLUse } from '../types';

export function evaluateCloseQuality(close: CloseSnapshot): DataQuality {
  if (!close) return 'BAD';
  if (close.exitReason === 'INVALID_PRICE') return 'BAD';
  if (close.executionQuality === 'PRICE_UNAVAILABLE') return 'BAD';
  if (close.executionQuality === 'INVALID_PRICE') return 'BAD';
  if (close.isRealMarketPrice && close.executionQuality === 'CLEAN_REAL_MARKET_PRICE') return 'GOOD';
  if (close.executionQuality === 'FALLBACK_TRIGGER_PRICE') return 'MEDIUM';
  if (close.dynamicTrailAudit && !close.dynamicTrailAudit.floorRespected) return 'MEDIUM';
  return 'MEDIUM';
}

export function evaluateTradeMLQuality(trade: TradeRecord): MLQualityResult {
  const tradeId = trade.tradeId;
  const reasons: string[] = [];
  const warnings: string[] = [];

  const buy = trade.buySnapshot;
  const close = trade.closeSnapshot;

  if (!buy) reasons.push('missing_buy_snapshot');
  if (!close) reasons.push('missing_close_snapshot');
  if (!trade.strategy || trade.strategy === 'default') reasons.push('missing_strategy');
  if (!close?.exitReason) reasons.push('missing_exit_reason');
  if (trade.status !== 'closed') reasons.push('trade_not_closed');

  if (close) {
    if (close.exitReason === 'INVALID_PRICE') reasons.push('invalid_price_exit');
    if (close.executionQuality === 'PRICE_UNAVAILABLE') reasons.push('close_price_unavailable');
    if (close.executionQuality === 'INVALID_PRICE') reasons.push('close_price_invalid');
    if (!close.isRealMarketPrice) reasons.push('non_real_close_price');
    if (close.executionQuality === 'FALLBACK_TRIGGER_PRICE') reasons.push('fallback_close_price');
  }

  if (buy) {
    if (!buy.isRealMarketPriceAtBuy) reasons.push('non_real_buy_price');
    if (!buy.entryGateDecision) reasons.push('missing_entry_gate_decision');
    if (!buy.traderBrainDecision) reasons.push('missing_trader_brain_decision');
  }

  if (trade.pnl !== undefined && trade.pnlPercent !== undefined && close) {
    const expectedPnl = (close.exitPrice - trade.entryPrice) * trade.quantity;
    if (Math.abs(expectedPnl - trade.pnl) > 0.01) {
      reasons.push('pnl_mismatch');
    }
  }

  if (buy?.entryGateDecision?.decision === 'BLOCK') {
    reasons.push('contradiction_entry_gate_blocked_but_executed');
  }

  const hardBlockReasons = ['missing_buy_snapshot', 'missing_close_snapshot', 'close_price_unavailable', 'close_price_invalid', 'invalid_price_exit', 'trade_not_closed', 'pnl_mismatch'];
  const hasHardBlock = reasons.some(r => hardBlockReasons.includes(r));
  const hasMedium = reasons.some(r => r === 'fallback_close_price' || r === 'non_real_close_price' || r === 'non_real_buy_price' || r === 'contradiction_entry_gate_blocked_but_executed' || r === 'missing_strategy' || r === 'missing_exit_reason');

  let dataQuality: DataQuality;
  let mlUse: MLUse;
  let trainingWeight: number;
  let trainingEligible: boolean;

  if (hasHardBlock) {
    dataQuality = 'BAD';
    mlUse = 'excluded';
    trainingWeight = 0;
    trainingEligible = false;
  } else if (hasMedium) {
    dataQuality = 'MEDIUM';
    mlUse = 'advisory_only';
    trainingWeight = 0.25;
    trainingEligible = false;
  } else {
    dataQuality = 'GOOD';
    mlUse = 'training';
    trainingWeight = trade.adapter === 'live' ? 1.0 : 0.6;
    trainingEligible = true;
  }

  if (dataQuality === 'GOOD' && reasons.length > 0) {
    warnings.push('GOOD quality with minor reasons: ' + reasons.join(', '));
  }

  return {
    tradeId,
    dataQuality,
    mlUse,
    trainingWeight,
    trainingEligible,
    reasons,
    warnings,
  };
}
