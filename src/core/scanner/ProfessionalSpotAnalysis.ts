import type { ScannerCandidate } from '../types';
import { logger } from '../../utils/logger';

export type ProfessionalVerdict = 'STRONG_BUY' | 'WAIT' | 'AVOID';
export type RiskLabel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface ProfessionalAnalysis {
  symbol: string;
  professionalScore: number;         // 0-100
  professionalVerdict: ProfessionalVerdict;
  professionalReasons: string[];
  professionalBlockers: string[];
  riskLabel: RiskLabel;
  confidenceSource: string;
  scoreBreakdown: Record<string, number>;
  anchorSettingEnabled: boolean;
  anchorDataAvailable: boolean;
  btcFresh: boolean;
  ethFresh: boolean;
  anchorDecision: AnchorDecision;
  anchorBlockApplied: boolean;
}

export interface ProfessionalAnalysisInput {
  symbol: string;
  riskGroup: string;
  status: string;
  confidence: number;
  spreadPct: number;
  volumeRel: number;
  tpRoomOk: boolean;
  dipPercent: number;
  reboundPercent: number;
  momentumConfirmed: boolean;
  reboundConfirmed: boolean;
  periodTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  groupTrend: string | null;
  priceFresh: boolean;
  bookFresh: boolean;
  overextended: boolean;
  candleExhaustion: boolean;
  fallingKnife: boolean;
  isAlt: boolean;
  blockReasons: string[];
  periodVolatility: number | null;
  periodMomentum: number | null;
  anchorSettingEnabled: boolean;
  anchorDataAvailable: boolean;
  btcFresh: boolean;
  ethFresh: boolean;
  btcDumping?: boolean;
  ethDumping?: boolean;
  btcTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  ethTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  btcMomentum?: number;
  ethMomentum?: number;
}

export type AnchorDecision = 'ALIGNED' | 'ADVISORY_WARNING' | 'BLOCKED' | 'UNAVAILABLE';

const STRONG_BUY_THRESHOLD = 80;
const WAIT_THRESHOLD = 50;

export function computeProfessionalAnalysis(input: ProfessionalAnalysisInput): ProfessionalAnalysis {
  const breakdown: Record<string, number> = {};
  const reasons: string[] = [];
  const blockers: string[] = [];

  // 1. Market regime alignment (0-15)
  let regimeScore = 10; // neutral baseline
  const trend = input.periodTrend;
  const groupTrend = input.groupTrend;
  if (trend === 'BULLISH' || groupTrend === 'bullish') regimeScore = 15;
  else if (trend === 'BEARISH' || groupTrend === 'bearish' || groupTrend === 'bearish_or_unsafe') regimeScore = 3;
  else if (groupTrend === 'caution') regimeScore = 7;
  else if (groupTrend === 'sideways') regimeScore = 10;
  breakdown.regime = regimeScore;
  if (regimeScore >= 15) reasons.push('bullish_regime');
  if (regimeScore <= 5) blockers.push('bearish_high_risk_regime');

  // 2. BTC/ETH anchor alignment (0-10)
  // Logic: anchorSettingEnabled=true + data available => blocks on dumping, UNAVAILABLE on stale/missing
  //        anchorSettingEnabled=false => advisory only, no blocks
  let anchorScore = 10;
  let anchorDecision: AnchorDecision = 'ALIGNED';
  let anchorBlockApplied = false;
  const settingOn = input.anchorSettingEnabled === true;
  const dataAvailable = input.anchorDataAvailable === true;
  const btcDumping = input.btcDumping === true;
  const ethDumping = input.ethDumping === true;
  const btcFresh = input.btcFresh === true;
  const ethFresh = input.ethFresh === true;

  if (input.isAlt && settingOn) {
    // Anchor ON: data determines outcome
    if (!dataAvailable || (!btcFresh && !ethFresh)) {
      // No anchor data at all = fail closed
      anchorScore = 0;
      anchorDecision = 'UNAVAILABLE';
      anchorBlockApplied = true;
      blockers.push('BTC_ETH_ANCHOR_UNAVAILABLE');
    } else if (!btcFresh) {
      anchorScore = 0;
      anchorDecision = 'UNAVAILABLE';
      anchorBlockApplied = true;
      blockers.push('BTC_ANCHOR_UNAVAILABLE');
    } else if (!ethFresh) {
      anchorScore = 0;
      anchorDecision = 'UNAVAILABLE';
      anchorBlockApplied = true;
      blockers.push('ETH_ANCHOR_UNAVAILABLE');
    } else if (btcDumping && ethDumping) {
      anchorScore = 0;
      anchorDecision = 'BLOCKED';
      anchorBlockApplied = true;
      blockers.push('BTC_ETH_ANCHOR_BLOCKED');
    } else if (btcDumping) {
      anchorScore = 0;
      anchorDecision = 'BLOCKED';
      anchorBlockApplied = true;
      blockers.push('BTC_ANCHOR_BLOCKED');
    } else if (ethDumping) {
      anchorScore = 3;
      anchorDecision = 'BLOCKED';
      anchorBlockApplied = true;
      blockers.push('ETH_ANCHOR_BLOCKED');
    } else if (input.btcTrend === 'BEARISH' && input.ethTrend === 'BEARISH') {
      anchorScore = 4;
      anchorDecision = 'ADVISORY_WARNING';
      reasons.push('BTC_ETH_ANCHOR_WEAK');
    } else if (input.btcTrend === 'BEARISH' || input.ethTrend === 'BEARISH') {
      anchorScore = 6;
      anchorDecision = 'ADVISORY_WARNING';
    } else {
      anchorScore = 10;
      anchorDecision = 'ALIGNED';
      reasons.push('BTC_ETH_ALIGNED');
    }
  } else if (input.isAlt && !settingOn) {
    // Anchor OFF: advisory only, never blocks
    if (dataAvailable && btcFresh && ethFresh) {
      if (btcDumping || ethDumping) {
        anchorScore = 6;
        anchorDecision = 'ADVISORY_WARNING';
        reasons.push('anchor_off_dumping_advisory');
      } else if (input.btcTrend === 'BEARISH' || input.ethTrend === 'BEARISH') {
        anchorScore = 7;
        anchorDecision = 'ADVISORY_WARNING';
      } else {
        anchorScore = 10;
        anchorDecision = 'ALIGNED';
      }
    } else {
      // Data unavailable but setting OFF — no block, just note
      anchorScore = 8;
      anchorDecision = 'ALIGNED';
      reasons.push('anchor_off_no_block');
    }
  } else {
    // BTCUSDT itself — no anchor-based gating
    anchorScore = 10;
    anchorDecision = 'ALIGNED';
  }
  if (input.fallingKnife) { anchorScore = Math.min(anchorScore, 2); }
  breakdown.anchor = anchorScore;
  if (anchorDecision === 'BLOCKED') blockers.push('ANCHOR_DECISION_BLOCKED');
  if (anchorDecision === 'ADVISORY_WARNING') reasons.push('anchor_advisory_warning');

  logger.info(`BTC_ETH_CONTEXT_AUDIT symbol=${input.symbol} anchorSettingEnabled=${settingOn} anchorDataAvailable=${dataAvailable} btcFresh=${btcFresh} ethFresh=${ethFresh} btcAgeMs=n/a ethAgeMs=n/a btcDumping=${btcDumping} ethDumping=${ethDumping} btcTrend=${input.btcTrend ?? 'n/a'} ethTrend=${input.ethTrend ?? 'n/a'} anchorDecision=${anchorDecision} anchorBlockApplied=${anchorBlockApplied}`);

  // 3. Trend multi-timeframe confirmation (0-15)
  let trendScore = 10;
  if (input.momentumConfirmed && input.reboundConfirmed) trendScore = 15;
  else if (input.momentumConfirmed && input.periodTrend === 'BULLISH') trendScore = 13;
  else if (input.reboundConfirmed && input.periodTrend !== 'BEARISH') trendScore = 12;
  else if (input.periodTrend === 'BEARISH') trendScore = 5;
  breakdown.trend = trendScore;
  if (trendScore >= 13) reasons.push('multi_tf_confirmed');
  if (trendScore <= 5) blockers.push('weak_trend_confirm');

  // 4. Momentum quality (0-10)
  let momentumScore = 5;
  const mom = input.periodMomentum ?? 0;
  if (input.momentumConfirmed && mom > 0.5) momentumScore = 10;
  else if (input.momentumConfirmed && mom > 0.2) momentumScore = 8;
  else if (mom > 0) momentumScore = 5;
  else if (mom < -0.2) { momentumScore = 2; blockers.push('weak_momentum'); }
  breakdown.momentum = momentumScore;

  // 5. Dip/rebound quality (0-10)
  let dipReboundScore = 5;
  const dip = Math.abs(input.dipPercent ?? 0);
  const rebound = input.reboundPercent ?? 0;
  if (input.reboundConfirmed && rebound > 0 && dip > 0.5) dipReboundScore = 10;
  else if (input.reboundConfirmed && rebound > 0) dipReboundScore = 8;
  else if (rebound > 5 && !input.reboundConfirmed) dipReboundScore = 3; // suspicious large move
  breakdown.dipRebound = dipReboundScore;
  if (dipReboundScore >= 8) reasons.push('quality_dip_rebound');

  // 6. Volume quality (0-10)
  let volumeScore = 5;
  const vol = input.volumeRel ?? 0;
  if (vol >= 1.5) volumeScore = 10;
  else if (vol >= 0.8) volumeScore = 8;
  else if (vol >= 0.5) volumeScore = 6;
  else { volumeScore = 3; blockers.push('low_volume'); }
  breakdown.volume = volumeScore;

  // 7. Spread/slippage safety (0-10)
  let spreadScore = 10;
  const spread = input.spreadPct ?? 0;
  if (spread <= 0.1) spreadScore = 10;
  else if (spread <= 0.2) spreadScore = 8;
  else if (spread <= 0.35) spreadScore = 6;
  else if (spread <= 0.5) spreadScore = 4;
  else { spreadScore = 0; blockers.push('high_spread'); }
  breakdown.spread = spreadScore;

  // 8. TP room (0-5)
  const tpScore = input.tpRoomOk ? 5 : 0;
  breakdown.tpRoom = tpScore;
  if (!input.tpRoomOk) blockers.push('no_tp_room');

  // 9. Candle exhaustion penalty (0 to -10)
  let candlePenalty = 0;
  if (input.candleExhaustion) { candlePenalty = -10; blockers.push('candle_exhaustion'); }
  breakdown.candleExhaustion = candlePenalty;

  // 10. Overextended penalty (0 to -8)
  let overextendedPenalty = 0;
  if (input.overextended) { overextendedPenalty = -8; blockers.push('overextended'); }
  breakdown.overextendedPenalty = overextendedPenalty;

  // 11. Volatility risk (0 to -5)
  let volatilityPenalty = 0;
  const vola = input.periodVolatility ?? 0;
  if (vola > 5) volatilityPenalty = -5;
  else if (vola > 3) volatilityPenalty = -3;
  else if (vola > 2) volatilityPenalty = -1;
  breakdown.volatility = volatilityPenalty;

  // 12. Price/book freshness (0 or -10)
  let freshnessPenalty = 0;
  if (!input.priceFresh) { freshnessPenalty = -5; blockers.push('stale_price'); }
  if (!input.bookFresh) { freshnessPenalty -= 5; blockers.push('stale_book'); }
  breakdown.freshness = freshnessPenalty;

  // 13. Risk group penalty
  let riskGroupPenalty = 0;
  if (input.riskGroup === 'very_high_risk') riskGroupPenalty = -15;
  else if (input.riskGroup === 'high_risk') riskGroupPenalty = -8;
  breakdown.riskGroup = riskGroupPenalty;

  // 14. Block reason penalty
  let blockPenalty = -(input.blockReasons.length * 3);
  breakdown.blockPenalty = blockPenalty;

  // 15. Duplicate / status check
  if (input.status === 'AVOID') { blockers.push('status_avoid'); }
  if (input.status === 'BLOCK') { blockers.push('status_block'); }

  // Compute total (clamped 0-100)
  const raw = regimeScore + anchorScore + trendScore + momentumScore + dipReboundScore
    + volumeScore + spreadScore + tpScore + candlePenalty + overextendedPenalty
    + volatilityPenalty + freshnessPenalty + riskGroupPenalty + blockPenalty;
  const score = Math.max(0, Math.min(100, raw));

  let verdict: ProfessionalVerdict;
  if (score >= STRONG_BUY_THRESHOLD && blockers.length === 0) verdict = 'STRONG_BUY';
  else if (score >= WAIT_THRESHOLD) verdict = 'WAIT';
  else verdict = 'AVOID';

  let riskLabel: RiskLabel;
  if (score >= 85) riskLabel = 'LOW';
  else if (score >= 65) riskLabel = 'MEDIUM';
  else if (score >= 40) riskLabel = 'HIGH';
  else riskLabel = 'EXTREME';

  if (blockers.length > 0) riskLabel = riskLabel === 'LOW' ? 'MEDIUM' : riskLabel;

  logger.info(`PROFESSIONAL_ANALYSIS_COIN_AUDIT symbol=${input.symbol} score=${score} verdict=${verdict} risk=${riskLabel} reasons=${reasons.join('|') || 'none'} blockers=${blockers.join('|') || 'none'} breakdown=${JSON.stringify(breakdown)}`);

  return {
    symbol: input.symbol,
    professionalScore: score,
    professionalVerdict: verdict,
    professionalReasons: reasons,
    professionalBlockers: blockers,
    riskLabel,
    confidenceSource: `professional_analysis_v1_${verdict}`,
    scoreBreakdown: breakdown,
    anchorSettingEnabled: settingOn,
    anchorDataAvailable: dataAvailable,
    btcFresh,
    ethFresh,
    anchorDecision,
    anchorBlockApplied,
  };
}
