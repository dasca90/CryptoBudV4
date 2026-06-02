import type { TradeRecord, MLFeatureVector, BuySnapshot, CloseSnapshot, MLLabel } from '../types';

export function buildMLFeatures(trade: TradeRecord): MLFeatureVector {
  const buy = trade.buySnapshot;
  const close = trade.closeSnapshot;
  const label = trade.mlLabel;

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
    mlBadEntryRiskAtEntry: buy?.traderBrainDecision?.blockReasons?.some(r => r.includes('risk') || r.includes('bad_entry')) ? 1 : 0,
    mlWinProbabilityAtEntry: buy?.confidence ?? 0,
    entryGateDecision: buy?.entryGateDecision?.decision ?? 'UNKNOWN',
    primaryBlockOrAllowReason: buy?.entryGateDecision?.primaryReason ?? 'ALLOW',
  };

  const outcomeLabels: Record<string, number | string | boolean> = {
    durationMs: close?.durationMs ?? 0,
    pnlPercent: trade.pnlPercent ?? 0,
    hitTp1: label?.hitTp1 ?? false,
    hitTp2: label?.hitTp2 ?? false,
    hitStopLoss: label?.hitStopLoss ?? false,
    mfePercent: close?.mfePercent ?? 0,
    maePercent: close?.maePercent ?? 0,
    dataQuality: trade.mlQuality?.dataQuality ?? 'BAD',
    trainingEligible: trade.trainingEligible ?? false,
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
