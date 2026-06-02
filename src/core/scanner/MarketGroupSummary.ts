import type { TradeV4CandidateView } from '../../components/trade-v4/types';
import { logger } from '../../utils/logger';

let _lastGroupSummaryLogKey: string | undefined;

export type GroupTrend = 'bullish' | 'bearish' | 'bearish_or_unsafe' | 'sideways' | 'waiting_for_rebound' | 'caution';
export type StrategyRecommendation = 'balanced' | 'conservative' | 'momentum' | 'dip_and_rebound' | 'wait';
export type SuggestedAction = 'TRADE_ALLOWED' | 'WAIT_ONLY' | 'BLOCK_GROUP' | 'MICRO_ONLY' | 'REDUCE_RISK';
export type MarketState = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE' | 'HOT' | 'WEAK' | 'OFF';
export type TrendDirection = 'UP' | 'DOWN' | 'SIDEWAYS' | 'NONE';

export interface GroupSummaryRow {
  group: string;
  groupLabel: string;
  enabled: boolean;
  totalCandidates: number;
  buyCount: number;
  waitCount: number;
  blockCount: number;
  avoidCount: number;
  avgConfidence: number;
  avgScore: number;
  avgSpread: number;
  avgMomentum: number;
  avgDip: number;
  avgRebound: number;
  topReason: string;
  topBlockers: string[];
  groupTrend: GroupTrend;
  recommendedStrategy: StrategyRecommendation;
  suggestedAction: SuggestedAction;
  marketState: MarketState;
  trendDirection: TrendDirection;
  bestSymbols: string[];
  worstSymbols: string[];
  scannedCount: number;
}

export interface MarketGroupSummaryResult {
  rows: GroupSummaryRow[];
  referencePeriod: string;
  totalCandidates: number;
  totalEnabled: number;
}

const GROUP_LABELS: Record<string, string> = {
  top_caps: 'Top Caps',
  large_caps: 'Large Caps',
  mid_caps: 'Mid Caps',
  high_risk: 'High Risk',
  very_high_risk: 'Very High Risk',
};

const GROUP_ORDER = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];

function determineGroupTrend(
  buyCount: number,
  waitCount: number,
  blockCount: number,
  avoidCount: number,
  avgConfidence: number,
  topReason: string,
): GroupTrend {
  if (buyCount > 0 && avgConfidence >= 70) return 'bullish';
  if (waitCount > 0 && topReason.toLowerCase().includes('rebound')) return 'waiting_for_rebound';
  if (blockCount > 0 && topReason.toLowerCase().includes('spread')) return 'caution';
  if (avoidCount > 0 || blockCount > buyCount) return 'bearish_or_unsafe';
  if (buyCount === 0 && avgConfidence < 40) return 'bearish';
  return 'sideways';
}

function recommendStrategy(trend: GroupTrend): StrategyRecommendation {
  if (trend === 'bullish') return 'balanced';
  if (trend === 'waiting_for_rebound') return 'dip_and_rebound';
  if (trend === 'caution') return 'conservative';
  if (trend === 'bearish_or_unsafe') return 'wait';
  if (trend === 'bearish') return 'wait';
  return 'conservative';
}

function suggestAction(trend: GroupTrend, buyCount: number, avgSpread: number): SuggestedAction {
  if (!trend || trend === 'bullish') {
    if (buyCount > 0) return 'TRADE_ALLOWED';
    if (avgSpread > 0.5) return 'REDUCE_RISK';
    return 'WAIT_ONLY';
  }
  if (trend === 'waiting_for_rebound' || trend === 'caution' || trend === 'sideways') return 'WAIT_ONLY';
  if (trend === 'bearish') return 'REDUCE_RISK';
  if (trend === 'bearish_or_unsafe') return 'BLOCK_GROUP';
  return 'WAIT_ONLY';
}

function computeMarketState(gt: GroupTrend, avgMomentum: number, avgScore: number, buyCount: number, blockCount: number, enabled: boolean): MarketState {
  if (!enabled) return 'OFF';
  if (gt === 'bullish' && avgMomentum > 0.5 && avgScore > 50) return 'BULL';
  if (gt === 'bullish') return 'BULL';
  if (gt === 'bearish_or_unsafe' || (gt === 'bearish' && blockCount > 0)) return 'BEAR';
  if (gt === 'bearish') return 'WEAK';
  if (gt === 'caution' && Math.abs(avgMomentum) > 2) return 'VOLATILE';
  if (avgMomentum > 2 && buyCount > 0) return 'HOT';
  if (gt === 'caution') return 'SIDEWAYS';
  return 'SIDEWAYS';
}

function computeTrendDirection(ms: MarketState, avgMomentum: number): TrendDirection {
  if (ms === 'BULL' || ms === 'HOT') return 'UP';
  if (ms === 'BEAR' || ms === 'WEAK') return 'DOWN';
  if (avgMomentum > 0.2) return 'UP';
  if (avgMomentum < -0.2) return 'DOWN';
  return 'SIDEWAYS';
}

function getTopBlockers(candidates: TradeV4CandidateView[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const brs = Array.isArray(c.blockReasons) ? c.blockReasons : [];
    for (const r of brs) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([r]) => r);
}

export function computeMarketGroupSummary(
  candidates: TradeV4CandidateView[],
  enabledRiskGroups: {
    top_caps: boolean;
    large_caps: boolean;
    mid_caps: boolean;
    high_risk: boolean;
    very_high_risk: boolean;
  },
  referencePeriod: string,
): MarketGroupSummaryResult {
  const rows: GroupSummaryRow[] = [];
  let totalEnabled = 0;

  for (const group of GROUP_ORDER) {
    const enabled = enabledRiskGroups[group as keyof typeof enabledRiskGroups];
    const groupCandidates = candidates.filter(c => c.riskGroup === group);
    const buyCount = groupCandidates.filter(c => c.status === 'BUY').length;
    const waitCount = groupCandidates.filter(c => c.status === 'WAIT').length;
    const blockCount = groupCandidates.filter(c => c.status === 'BLOCK').length;
    const avoidCount = groupCandidates.filter(c => c.status === 'AVOID').length;
    const avgConfidence = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + c.confidence, 0) / groupCandidates.length
      : 0;
    const avgScore = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + (c.score ?? 0), 0) / groupCandidates.length
      : 0;
    const avgSpread = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + (c.spreadPct ?? 0), 0) / groupCandidates.length
      : 0;
    const avgMomentum = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + (c.momentum ?? 0), 0) / groupCandidates.length
      : 0;
    const avgDip = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + (c.dipPct ?? 0), 0) / groupCandidates.length
      : 0;
    const avgRebound = groupCandidates.length > 0
      ? groupCandidates.reduce((sum, c) => sum + (c.reboundPct ?? 0), 0) / groupCandidates.length
      : 0;
    const topReason = groupCandidates.length > 0
      ? groupCandidates.map(c => c.mainReason).filter(Boolean).sort((a, b) => a.length - b.length)[0] || 'n/a'
      : 'n/a';
    const topBlockers = getTopBlockers(groupCandidates);
    const sorted = [...groupCandidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const bestSymbols = sorted.slice(0, 3).map(c => c.symbol.replace('USDT', ''));
    const worstSymbols = sorted.slice(-3).reverse().map(c => c.symbol.replace('USDT', ''));

    const groupTrend = enabled
      ? determineGroupTrend(buyCount, waitCount, blockCount, avoidCount, avgConfidence, topReason)
      : 'sideways';
    const recommendedStrategy = recommendStrategy(groupTrend);
    const suggestedAction = enabled ? suggestAction(groupTrend, buyCount, avgSpread) : 'BLOCK_GROUP';
    const scannedCount = groupCandidates.length;
    const marketState = computeMarketState(groupTrend, avgMomentum, avgScore, buyCount, blockCount, enabled);
    const trendDirection = computeTrendDirection(marketState, avgMomentum);

    if (enabled) totalEnabled++;

    rows.push({
      group,
      groupLabel: GROUP_LABELS[group] || group,
      enabled,
      totalCandidates: groupCandidates.length,
      buyCount,
      waitCount,
      blockCount,
      avoidCount,
      avgConfidence,
      avgScore,
      avgSpread,
      avgMomentum,
      avgDip,
      avgRebound,
      topReason,
      topBlockers,
      groupTrend: enabled ? groupTrend : 'sideways',
      recommendedStrategy: enabled ? recommendedStrategy : 'wait',
      suggestedAction: enabled ? suggestedAction : 'BLOCK_GROUP',
      marketState,
      trendDirection,
      bestSymbols,
      worstSymbols,
      scannedCount,
    });
  }

  const totalCandidates = candidates.length;

  const logKey = `sum:${totalCandidates}:${referencePeriod}`;
  if (logKey !== _lastGroupSummaryLogKey) {
    _lastGroupSummaryLogKey = logKey;
    logger.info(`SCANNER_GROUP_SUMMARY: groups=${rows.map(r => `${r.groupLabel}:${r.totalCandidates}cand:${r.groupTrend}:${r.recommendedStrategy}`).join('|')} total=${totalCandidates} refPeriod=${referencePeriod}`);
    logger.info(`SCANNER_GROUP_STRATEGY_RECOMMENDATION: topStrategies=${rows.filter(r => r.enabled).map(r => `${r.groupLabel}=>${r.recommendedStrategy}`).join('|')}`);

    for (const r of rows) {
      logger.info(`GROUP_MARKET_HEALTH_SUMMARY: group=${r.group} enabled=${r.enabled} scanned=${r.scannedCount} buy=${r.buyCount} wait=${r.waitCount} block=${r.blockCount} avoid=${r.avoidCount} avgScore=${r.avgScore.toFixed(1)} avgSpread=${r.avgSpread.toFixed(3)} avgMomentum=${r.avgMomentum.toFixed(2)} avgDip=${r.avgDip.toFixed(2)} avgRebound=${r.avgRebound.toFixed(2)} topBlockers=${r.topBlockers.join('|') || 'none'} recommended=${r.recommendedStrategy} action=${r.suggestedAction} best=${r.bestSymbols.join(',')} worst=${r.worstSymbols.join(',')}`);
    }

    const bestGroup = rows.filter(r => r.enabled).sort((a, b) => b.avgScore - a.avgScore)[0];
    const worstGroup = rows.filter(r => r.enabled).sort((a, b) => a.avgScore - b.avgScore)[rows.filter(r => r.enabled).length - 1];
    logger.info(`MARKET_GROUPS_OVERVIEW: refPeriod=${referencePeriod} totalGroups=${rows.length} enabledGroups=${totalEnabled} blockedGroups=${rows.length - totalEnabled} bestGroup=${bestGroup?.groupLabel ?? 'n/a'} worstGroup=${worstGroup?.groupLabel ?? 'n/a'} tradeAllowed=${rows.filter(r => r.suggestedAction === 'TRADE_ALLOWED').length} waitOnly=${rows.filter(r => r.suggestedAction === 'WAIT_ONLY').length} blockSuggested=${rows.filter(r => r.suggestedAction === 'BLOCK_GROUP').length} timestamp=${new Date().toISOString()}`);
  }

  return { rows, referencePeriod, totalCandidates, totalEnabled };
}
