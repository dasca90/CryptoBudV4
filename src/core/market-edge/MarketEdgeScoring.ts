import type { EdgeClass, EdgeComponentScores, EdgePenalty, EdgeSignal, MarketEdgeSnapshot } from './types';
import type { MarketEdgeConfig } from './config';
import { clamp } from './MarketEdgeMath';

export interface MarketEdgeScoreInput {
  compressionScore: number | null;
  spotExtensionPct: number | null;
  spotOFI: number | null;
  futuresOFI: number | null;
  perpLead5s: number | null;
  perpLead15s: number | null;
  perpLead60s: number | null;
  spotReturn60s: number | null;
  oiChange5m: number | null;
  futuresTakerBuyRatio: number | null;
  takerFlowAcceleration: number | null;
  longLiquidationUsd1m: number | null;
  shortLiquidationUsd1m: number | null;
  volumeAcceleration: number | null;
  fundingRate: number | null;
  spreadPct: number | null;
  liquidityQuality: number | null;
  breadthBullishPct: number | null;
  availableRatio: number;
  stableLeadSamples: number;
  liquidationIntensity?: number | null;
  unstableBook?: boolean;
}

const positive = (value: number | null, scale: number) => value == null ? 0 : clamp(value / scale, 0, 1);

export function classifyEdge(score: number, config: MarketEdgeConfig): EdgeClass {
  return [...config.classThresholds].sort((a, b) => b.min - a.min).find(row => score >= row.min)?.edgeClass ?? 'IGNORE';
}

export function calculateEdgeScore(input: MarketEdgeScoreInput, config: MarketEdgeConfig): Pick<MarketEdgeSnapshot, 'componentScores' | 'penalties' | 'rawEdgeScore' | 'edgeScore' | 'edgeClass' | 'edgeSignals'> {
  const lead = [input.perpLead5s, input.perpLead15s, input.perpLead60s].filter((v): v is number => v != null);
  const sustainedBullLead = lead.length >= 2 && lead.filter(v => v > 0.08).length >= 2 && input.stableLeadSamples >= 2;
  const sustainedBearLead = lead.length >= 2 && lead.filter(v => v < -0.08).length >= 2 && input.stableLeadSamples >= 2;
  const orderPressure = ((input.spotOFI ?? 0) + (input.futuresOFI ?? 0)) / 2;
  const components: EdgeComponentScores = {
    spotSetupScore: config.weights.spotSetup * clamp(((input.compressionScore ?? 0) / 100) * 0.65 + (1 - positive(Math.abs(input.spotExtensionPct ?? 0), 5)) * 0.35, 0, 1),
    orderFlowScore: config.weights.orderFlow * clamp((orderPressure + 1) / 2, 0, 1),
    perpLeadScore: config.weights.perpLead * (sustainedBullLead ? positive(Math.max(...lead), 0.6) : 0),
    openInterestScore: config.weights.openInterest * positive(input.oiChange5m, 5),
    takerFlowScore: config.weights.takerFlow * clamp(((input.futuresTakerBuyRatio ?? 0.5) - 0.5) * 2 + positive(input.takerFlowAcceleration, 2) * 0.25, 0, 1),
    liquidationScore: config.weights.liquidations * clamp(0.5 + positive(input.liquidationIntensity ?? null, 1) * ((input.shortLiquidationUsd1m ?? 0) >= (input.longLiquidationUsd1m ?? 0) ? 0.5 : -0.5), 0, 1),
    breadthScore: config.weights.breadth * clamp((input.breadthBullishPct ?? 50) / 100, 0, 1),
    liquidityScore: config.weights.liquidity * clamp((input.liquidityQuality ?? 0) / 100, 0, 1),
  };
  const rawEdgeScore = clamp(Object.values(components).reduce((sum, score) => sum + score, 0), 0, 100);
  const penalties: EdgePenalty[] = [];
  if ((input.spotExtensionPct ?? 0) >= 5) penalties.push({ code: 'FOMO_EXTENSION', points: 12 });
  if ((input.fundingRate ?? 0) >= 0.001) penalties.push({ code: 'EXTREME_FUNDING', points: 6 });
  if ((input.spreadPct ?? 0) > 0.5) penalties.push({ code: 'SPREAD_TOO_HIGH', points: 10 });
  if ((input.liquidityQuality ?? 100) < 30) penalties.push({ code: 'LIQUIDITY_TOO_LOW', points: 10 });
  if (input.stableLeadSamples < 2 && lead.some(v => Math.abs(v) > 0.2)) penalties.push({ code: 'ONE_TICK_SIGNAL', points: 8 });
  if (input.availableRatio < 0.7) penalties.push({ code: 'DATA_PARTIAL', points: 8 });
  if (input.unstableBook) penalties.push({ code: 'UNSTABLE_BOOK', points: 6 });
  if (sustainedBullLead && (input.spotReturn60s ?? 0) <= 0 && (input.oiChange5m ?? 0) > 3) penalties.push({ code: 'OI_SPIKE_WITHOUT_SPOT_SUPPORT', points: 6 });
  if ((input.liquidationIntensity ?? 0) >= 0.5 && (input.longLiquidationUsd1m ?? 0) > (input.shortLiquidationUsd1m ?? 0) * 2) penalties.push({ code: 'ACTIVE_LONG_LIQUIDATION_CASCADE', points: 10 });
  const edgeScore = clamp(rawEdgeScore - penalties.reduce((sum, penalty) => sum + penalty.points, 0), 0, 100);
  const signals: EdgeSignal[] = [];
  if (sustainedBullLead) signals.push('PERP_LEADING_BULLISH');
  if (sustainedBearLead) signals.push('PERP_LEADING_BEARISH');
  if ((input.oiChange5m ?? 0) > 0 && (input.perpLead60s ?? 0) > 0) signals.push('NEW_LONG_POSITION_EXPANSION');
  if ((input.oiChange5m ?? 0) < 0 && (input.perpLead60s ?? 0) > 0) signals.push('SHORT_COVERING');
  if ((input.oiChange5m ?? 0) > 0 && (input.perpLead60s ?? 0) < 0) signals.push('NEW_SHORT_PRESSURE');
  const early = sustainedBullLead && orderPressure > 0.15 && (input.futuresTakerBuyRatio ?? 0) > 0.58 && (input.spotExtensionPct ?? 99) < 3;
  if (early && (input.compressionScore ?? 0) >= 50) signals.push('EARLY_ACCUMULATION');
  if (early && (input.volumeAcceleration ?? 0) >= 1.3) signals.push('PRE_SPOT_BREAKOUT_PRESSURE');
  if ((input.spotExtensionPct ?? 0) >= 5) signals.push('FOMO_OVEREXTENDED');
  if ((input.fundingRate ?? 0) >= 0.001) signals.push('CROWDING_RISK');
  return { componentScores: components, penalties, rawEdgeScore, edgeScore, edgeClass: classifyEdge(edgeScore, config), edgeSignals: [...new Set(signals)] };
}
