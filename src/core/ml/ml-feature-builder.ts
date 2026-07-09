import type { TradeRecord, MLFeatureVector, BuySnapshot, CloseSnapshot, MLLabel } from '../types';

export function buildMLFeatures(trade: TradeRecord): MLFeatureVector {
  const buy = trade.buySnapshot;
  const close = trade.closeSnapshot;
  const label = trade.mlLabel;
  const realMarketPriceAtClose = close?.realMarketPriceAtClose && close.realMarketPriceAtClose > 0
    ? close.realMarketPriceAtClose
    : close?.exitPrice ?? trade.exitPrice ?? 0;
  const isRealMarketPriceAtClose = close?.isRealMarketPrice
    ?? (close?.executionQuality === 'CLEAN_REAL_MARKET_PRICE'
      || (trade.mlQuality?.dataQuality === 'GOOD' && realMarketPriceAtClose > 0));

  const predictionFeatures: Record<string, number | string | boolean> = {
    symbol: trade.coin,
    mode: trade.mode,
    adapter: trade.adapter,
    riskGroup: buy?.riskGroup ?? 'unknown',
    strategy: trade.strategy,
    playbook: buy?.selectedPlaybook ?? 'unknown',
    confidence: buy?.confidence ?? 0,
    marketRegime: buy?.marketRegime ?? 'unknown',
    btcRegime: buy?.btcRegime ?? 'unknown',
    spreadPct: buy?.spreadPct ?? 0,
    volumeRel: buy?.volumeRel ?? 0,
    priceFresh: buy ? (buy.entryPriceAgeMs < 10000) : false,
    bookFresh: buy ? (buy.entryPriceAgeMs < 5000) : false,
    tpRoomOk: buy?.traderBrainDecision?.blockReasons?.some(r => r.includes('tp') || r.includes('room')) === false,
    reboundConfirmed: buy?.traderBrainDecision?.blockReasons?.some(r => r.includes('rebound')) === false,
    momentumConfirmed: buy?.traderBrainDecision?.blockReasons?.some(r => r.includes('momentum')) === false,
    dipPercent: buy?.traderBrainDecision?.ruleDecisionTrace?.unifiedSignal?.signal === 'BUY' ? 0 : -1,
    reboundPercent: buy?.traderBrainDecision?.ruleDecisionTrace?.unifiedSignal?.signal === 'BUY' ? 1 : 0,
    m5Change: buy?.traderBrainDecision?.ruleDecisionTrace?.unifiedSignal ? 0 : 0,
    m15Change: 0,
    h1Change: 0,
    change24h: 0,
    realMarketPriceAtBuy: buy?.realMarketPriceAtBuy ?? trade.entryPrice,
    mlBadEntryRiskAtEntry: buy?.traderBrainDecision?.blockReasons?.some(r => r.includes('risk') || r.includes('bad_entry')) ? 1 : 0,
    mlWinProbabilityAtEntry: buy?.confidence ?? 0,
    entryGateDecision: buy?.entryGateDecision?.decision ?? 'UNKNOWN',
    primaryBlockOrAllowReason: buy?.entryGateDecision?.primaryReason ?? 'ALLOW',
  };

  const outcomeLabels: Record<string, number | string | boolean> = {
    durationMs: close?.durationMs ?? 0,
    pnlPercent: trade.pnlPercent ?? 0,
    exitReason: close?.exitReason ?? 'UNKNOWN',
    exitPrice: close?.exitPrice ?? trade.exitPrice ?? 0,
    realMarketPriceAtClose,
    isRealMarketPriceAtClose,
    executionQuality: close?.executionQuality ?? 'UNKNOWN',
    closePriceSource: close?.closePriceSource ?? 'unknown',
    closePriceStatus: close?.closePriceStatus ?? 'unknown',
    grossPnlUsd: trade.grossPnlUsd ?? close?.grossPnlUsd ?? trade.pnl ?? 0,
    netPnlUsd: trade.netPnlUsd ?? close?.netPnlUsd ?? ((trade.pnl ?? 0) - (close?.fees ?? 0)),
    feeUsdEntry: trade.feeUsdEntry ?? close?.feeUsdEntry ?? (buy as any)?.feeUsdEntry ?? 0,
    feeUsdExit: trade.feeUsdExit ?? close?.feeUsdExit ?? 0,
    feeUsdTotal: trade.feeUsdTotal ?? close?.feeUsdTotal ?? close?.fees ?? 0,
    feeRate: trade.feeRate ?? close?.feeRate ?? (buy as any)?.feeRate ?? 0,
    feeSource: trade.feeSource ?? close?.feeSource ?? (buy as any)?.feeSource ?? 'unknown',
    operatorName: trade.operatorName ?? close?.operatorName ?? (buy as any)?.operatorName ?? 'unknown',
    hitTp1: label?.hitTp1 ?? false,
    hitTp2: label?.hitTp2 ?? false,
    hitStopLoss: label?.hitStopLoss ?? false,
    mfePercent: close?.mfePercent ?? 0,
    maePercent: close?.maePercent ?? 0,
    dataQuality: trade.mlQuality?.dataQuality ?? 'BAD',
    mlUse: trade.mlQuality?.mlUse ?? 'excluded',
    trainingEligible: trade.trainingEligible ?? false,
    trainingWeight: trade.mlQuality?.trainingWeight ?? 0,
    targetWinLoss: label?.trainingTarget ?? 'UNKNOWN',
    targetGoodEntry: label?.goodEntry === true ? 1 : 0,
  };

  return {
    tradeId: trade.tradeId,
    symbol: trade.coin,
    mode: trade.mode,
    adapter: trade.adapter,
    predictionFeatures,
    outcomeLabels,
  };
}
