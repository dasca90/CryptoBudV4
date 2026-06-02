import type { TradeV4CandidateView } from '../../components/trade-v4/types';
import { logger } from '../../utils/logger';

// Verdict spam protection
let _lastOverallVerdictKey = '';
let _lastOverallConfidence = -1;
let _lastOverallSampleSize = 0;
const _lastGroupVerdictByGroup = new Map<string, string>();
const _suppressedGroupVerdictCountByGroup = new Map<string, number>();

// ── V3-style types ──
export type MarketTrendState = 'bullish' | 'bearish' | 'neutral';
export type MarketPrimaryState = 'bullish' | 'mixed' | 'bearish' | 'near_resistance' | 'near_support' | 'breakout_not_confirmed' | 'pullback_in_trend';
export type MarketLtfConfirmation = 'confirmed' | 'mixed' | 'weak' | 'not_confirmed';
export type MarketBias = 'bullish' | 'bullish_with_caution' | 'neutral' | 'bearish' | 'bearish_oversold';
export type StrategyConfidenceLabel = 'high' | 'good' | 'cautious' | 'low';
export type MarketAction = 'long_bias' | 'selective_entries' | 'wait_for_confirmation' | 'no_trade' | 'risk_off';
export type MarketReadiness = 'high' | 'medium' | 'low';
export type V3ScanPeriod = '1h' | '4h' | '1d' | '1w';

export interface RegimeVerdict {
  htfState: MarketTrendState;
  primaryState: MarketPrimaryState;
  ltfConfirmation: MarketLtfConfirmation;
  bias: MarketBias;
  confidenceLabel: StrategyConfidenceLabel;
  confidenceScore: number;
  action: MarketAction;
  bestFitStrategy: 'momentum' | 'dip_and_rebound' | 'conservative' | 'balanced';
  marketReadiness: MarketReadiness;
  explanation: string;
}

export interface GroupRegimeVerdict extends RegimeVerdict {
  group: string;
  groupLabel: string;
  readyStatus: MarketReadiness;
}

export interface DipperMarketAnalysis {
  generatedAt: number;
  scanPeriod: V3ScanPeriod;
  sampleSize: number;
  overall: RegimeVerdict;
  groups: GroupRegimeVerdict[];
}

// ── Timeframe mappings ──
const TIMEFRAME_MAP: Record<V3ScanPeriod, { htf: V3ScanPeriod; primary: V3ScanPeriod; ltf: V3ScanPeriod }> = {
  '1h': { htf: '4h', primary: '1h', ltf: '15m' as V3ScanPeriod },
  '4h': { htf: '1d', primary: '4h', ltf: '1h' },
  '1d': { htf: '1w', primary: '1d', ltf: '4h' },
  '1w': { htf: '1w', primary: '1w', ltf: '1d' },
};

const GROUP_LABELS: Record<string, string> = {
  top_caps: 'Top Caps',
  large_caps: 'Large Caps',
  mid_caps: 'Mid Caps',
  high_risk: 'High Risk',
  very_high_risk: 'Very High Risk',
};

// ── Core sampler: aggregate candidate metrics ──
interface GroupSnapshot {
  avgChange: number;
  posRate: number;
  avgMomentum: number;
  avgConfidence: number;
  avgScore: number;
  avgSpread: number;
  avgDip: number;
  avgRebound: number;
  buyCount: number;
  waitCount: number;
  blockCount: number;
  avgVolatility: number;
}

function snapshotGroup(candidates: TradeV4CandidateView[]): GroupSnapshot {
  const n = candidates.length || 1;
  let sumChange = 0, sumMom = 0, sumConf = 0, sumScore = 0, sumSpread = 0;
  let sumDip = 0, sumReb = 0, buy = 0, wait = 0, block = 0, pos = 0;
  for (const c of candidates) {
    sumChange += c.periodChangePct ?? 0;
    sumMom += c.momentum ?? 0;
    sumConf += c.confidence;
    sumScore += c.score ?? 0;
    sumSpread += c.spreadPct ?? 0;
    sumDip += c.dipPct ?? 0;
    sumReb += c.reboundPct ?? 0;
    if ((c.periodChangePct ?? 0) > 0) pos++;
    if (c.status === 'BUY') buy++;
    if (c.status === 'WAIT') wait++;
    if (c.status === 'BLOCK') block++;
  }
  return {
    avgChange: sumChange / n, posRate: pos / n, avgMomentum: sumMom / n,
    avgConfidence: sumConf / n, avgScore: sumScore / n, avgSpread: sumSpread / n,
    avgDip: sumDip / n, avgRebound: sumReb / n, buyCount: buy, waitCount: wait, blockCount: block,
    avgVolatility: candidates.reduce((s, c) => s + (c.periodVolatility ?? 0), 0) / n,
  };
}

// ── HTF: higher timeframe trend from period change ──
function computeHtf(snap: GroupSnapshot, _tf: { htf: V3ScanPeriod }): MarketTrendState {
  const score = snap.avgChange * 7 + (snap.posRate - 0.5) * 70 + snap.avgMomentum * 10 - snap.avgVolatility * 2;
  if (score >= 8) return 'bullish';
  if (score <= -8) return 'bearish';
  return 'neutral';
}

// ── Primary: granular state ──
function computePrimary(snap: GroupSnapshot, htf: MarketTrendState): MarketPrimaryState {
  if (htf === 'bullish' && snap.avgMomentum > 0.3 && snap.posRate > 0.55 && snap.avgRebound > 0) return 'bullish';
  if (htf === 'bullish' && snap.avgDip < -1 && snap.avgRebound > 0.3) return 'pullback_in_trend';
  if (htf === 'bullish' && snap.posRate > 0.45 && snap.avgMomentum > 0) return 'breakout_not_confirmed';
  if (htf === 'bullish') return 'near_resistance';
  if (htf === 'bearish' && snap.avgRebound > 0.5 && snap.avgDip < -2) return 'near_support';
  if (htf === 'bearish') return 'bearish';
  if (snap.avgMomentum > 0 && snap.posRate > 0.5) return 'mixed';
  return 'mixed';
}

// ── LTF: confirmation from momentum ──
function computeLtf(snap: GroupSnapshot): MarketLtfConfirmation {
  if (snap.avgMomentum > 0.5 && snap.posRate > 0.6) return 'confirmed';
  if (snap.avgMomentum > 0.2 && snap.posRate > 0.4) return 'mixed';
  if (snap.avgMomentum < -0.3) return 'weak';
  return 'not_confirmed';
}

// ── Bias ──
function computeBias(htf: MarketTrendState, primary: MarketPrimaryState, ltf: MarketLtfConfirmation, snap: GroupSnapshot): MarketBias {
  if (htf === 'bullish') {
    if (primary === 'bullish' && ltf === 'confirmed') return 'bullish';
    return 'bullish_with_caution';
  }
  if (htf === 'bearish') {
    if (primary === 'near_support' && snap.avgRebound > 0.5) return 'bearish_oversold';
    return 'bearish';
  }
  if (primary === 'bullish' && ltf === 'confirmed') return 'bullish_with_caution';
  return 'neutral';
}

// ── Confidence score 0-100 ──
function computeConfidence(htf: MarketTrendState, primary: MarketPrimaryState, ltf: MarketLtfConfirmation, snap: GroupSnapshot, bias: MarketBias): number {
  let score = 50;
  if (htf !== 'neutral') score += (htf === 'bullish' ? 10 : -8);
  if (ltf === 'confirmed') score += 12;
  if (ltf === 'weak') score -= 5;
  if (ltf === 'not_confirmed') score -= 10;
  if (snap.posRate > 0.55) score += 6;
  if (snap.posRate < 0.4) score -= 5;
  if (snap.avgMomentum > 0.4) score += 7;
  if (snap.avgSpread < 0.3) score += 4;
  if (snap.avgSpread > 0.6) score -= 6;
  if (snap.avgVolatility > 5) score -= 6;
  if (snap.buyCount > 0) score += 8;
  if (snap.blockCount > snap.buyCount * 2) score -= 6;
  if (bias === 'bullish') score += 4;
  if (bias === 'bearish') score -= 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceToLabel(score: number): StrategyConfidenceLabel {
  if (score >= 75) return 'high';
  if (score >= 55) return 'good';
  if (score >= 35) return 'cautious';
  return 'low';
}

// ── Action ──
function computeAction(bias: MarketBias, ltf: MarketLtfConfirmation, snap: GroupSnapshot): MarketAction {
  if (bias === 'bullish' && ltf === 'confirmed') return 'selective_entries';
  if (bias === 'bullish_with_caution') return 'selective_entries';
  if (bias === 'bearish' || bias === 'bearish_oversold') return 'risk_off';
  if (ltf === 'weak' || ltf === 'not_confirmed') return 'wait_for_confirmation';
  if (snap.avgMomentum > 0.3 && snap.posRate > 0.5) return 'selective_entries';
  return 'wait_for_confirmation';
}

// ── Best fit strategy — matches V3's determineBestFitStrategy ──
function computeBestFit(bias: MarketBias, primary: MarketPrimaryState, snap: GroupSnapshot): 'momentum' | 'dip_and_rebound' | 'conservative' | 'balanced' {
  // V3: bias Bullish + primary Bullish + breakout quality >= 0.55 → momentum
  const breakoutQuality = snap.avgMomentum > 0 ? (snap.posRate * 0.5 + Math.min(1, snap.avgMomentum / 5) * 0.5) : 0;
  if (bias === 'bullish' && primary === 'bullish' && breakoutQuality >= 0.55) {
    return 'momentum';
  }
  // V3: pullback/near_support or bullish_with_caution + recovery >= 0.55 → dip_and_rebound
  const recoveryRate = snap.avgRebound > 0 ? Math.min(1, snap.avgRebound / 3) : (snap.posRate > 0.5 ? 0.5 : 0);
  if (primary === 'pullback_in_trend' || primary === 'near_support' || (bias === 'bullish_with_caution' && recoveryRate >= 0.55)) {
    return 'dip_and_rebound';
  }
  // V3: bearish → conservative
  if (bias === 'bearish' || bias === 'bearish_oversold') {
    return 'conservative';
  }
  // V3: volatile or weak breakout → balanced
  if (snap.avgVolatility > 5 || breakoutQuality < 0.45) {
    return 'balanced';
  }
  // V3 default: recovery >= 0.52 → dip_and_rebound, else → momentum
  return recoveryRate >= 0.52 ? 'dip_and_rebound' : 'momentum';
}

// ── Build explanation ──
function buildExplanation(verdict: RegimeVerdict, scanPeriod: string, sampleSize: number): string {
  const htfLabel = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' }[verdict.htfState];
  const primaryLabel = verdict.primaryState.replace(/_/g, ' ');
  return `Scan ${scanPeriod} — HTF is ${htfLabel}, Primary is ${primaryLabel}, LTF ${verdict.ltfConfirmation.replace(/_/g, ' ')}. Confidence: ${verdict.confidenceLabel} (${verdict.confidenceScore}%). Action: ${verdict.action}. Strategy: ${verdict.bestFitStrategy}. Sample: ${sampleSize} coins.`;
}

// ── Evaluate regime for a set of candidates ──
function evaluateRegime(candidates: TradeV4CandidateView[], scanPeriod: V3ScanPeriod): RegimeVerdict {
  const tf = TIMEFRAME_MAP[scanPeriod] || TIMEFRAME_MAP['1h'];
  const snap = snapshotGroup(candidates);
  const htf = computeHtf(snap, tf);
  const primary = computePrimary(snap, htf);
  const ltf = computeLtf(snap);
  const bias = computeBias(htf, primary, ltf, snap);
  const confidenceScore = computeConfidence(htf, primary, ltf, snap, bias);
  const confidenceLabel = confidenceToLabel(confidenceScore);
  const action = computeAction(bias, ltf, snap);
  const bestFit = computeBestFit(bias, primary, snap);

  return {
    htfState: htf,
    primaryState: primary,
    ltfConfirmation: ltf,
    bias,
    confidenceLabel,
    confidenceScore,
    action,
    bestFitStrategy: bestFit,
    marketReadiness: action === 'selective_entries' ? 'high' : action === 'wait_for_confirmation' ? 'medium' : 'low',
    explanation: buildExplanation({ htfState: htf, primaryState: primary, ltfConfirmation: ltf, bias, confidenceLabel, confidenceScore, action, bestFitStrategy: bestFit, marketReadiness: 'medium', explanation: '' }, scanPeriod, candidates.length),
  };
}

// ── PUBLIC: Get full Dipper Market Analysis ──
export function getDipperMarketAnalysisV3(
  candidates: TradeV4CandidateView[],
  scanPeriod: V3ScanPeriod,
): DipperMarketAnalysis | null {
  if (candidates.length === 0) return null;

  const overall = evaluateRegime(candidates, scanPeriod);
  const groups: GroupRegimeVerdict[] = [];
  const GROUP_ORDER = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];

  for (const g of GROUP_ORDER) {
    const gc = candidates.filter(c => c.riskGroup === g);
    const groupVerdict = gc.length > 0 ? evaluateRegime(gc, scanPeriod) : overall;
    groups.push({
      ...groupVerdict,
      group: g,
      groupLabel: GROUP_LABELS[g] || g,
      readyStatus: gc.length > 0 ? (gc.some(c => c.status === 'BUY') ? 'high' : gc.some(c => c.status === 'WAIT') ? 'medium' : 'low') : 'low',
    });
  }

  // Log verdicts with spam protection: only log when verdict changes, scan period changes,
  // confidence changes meaningfully (>=10), or sampleSize changes meaningfully (>=20%)
  const verdictKey = `scanPeriod=${scanPeriod} htf=${overall.htfState} primary=${overall.primaryState} ltf=${overall.ltfConfirmation} bias=${overall.bias} action=${overall.action} bestFit=${overall.bestFitStrategy}`;
  const prevKey = _lastOverallVerdictKey;
  const prevScore = _lastOverallConfidence;
  const prevSample = _lastOverallSampleSize;
  const confChanged = Math.abs(overall.confidenceScore - prevScore) >= 10;
  const sampleChanged = prevSample > 0 && Math.abs(candidates.length - prevSample) / prevSample >= 0.2;
  const shouldLog = verdictKey !== prevKey || confChanged || sampleChanged;
  logger.info(`MARKET_ANALYZER_LOG_DEDUPE_AUDIT: verdictHash=${verdictKey} emitted=${String(shouldLog)} suppressedCount=0 reason=${shouldLog ? (verdictKey !== prevKey ? 'verdict_changed' : confChanged ? 'confidence_changed_materially' : sampleChanged ? 'sample_changed_materially' : 'new_scan') : 'identical_overall_verdict'}`);
  if (shouldLog) {
    logger.info(`MARKET_ANALYZER_VERDICT: scanPeriod=${scanPeriod} sampleSize=${candidates.length} htf=${overall.htfState} primary=${overall.primaryState} ltf=${overall.ltfConfirmation} bias=${overall.bias} confidence=${overall.confidenceLabel}(${overall.confidenceScore}) action=${overall.action} bestFit=${overall.bestFitStrategy} explanation=${overall.explanation}`);
    _lastOverallVerdictKey = verdictKey;
    _lastOverallConfidence = overall.confidenceScore;
    _lastOverallSampleSize = candidates.length;
  }

  for (const g of groups) {
    const groupVerdictHash = `${scanPeriod}|${g.group}|${g.htfState}|${g.primaryState}|${g.ltfConfirmation}|${g.bias}|${g.confidenceScore}|${g.bestFitStrategy}|${g.readyStatus}`;
    const prevGroupHash = _lastGroupVerdictByGroup.get(g.group);
    const changed = prevGroupHash !== groupVerdictHash;
    const suppressedCount = _suppressedGroupVerdictCountByGroup.get(g.group) ?? 0;
    if (changed) {
      logger.info(`GROUP_MARKET_VERDICT: group=${g.group} name=${g.groupLabel} htf=${g.htfState} primary=${g.primaryState} ltf=${g.ltfConfirmation} bias=${g.bias} confidence=${g.confidenceLabel}(${g.confidenceScore}) recommendation=${g.bestFitStrategy} ready=${g.readyStatus}`);
      logger.info(`MARKET_ANALYZER_LOG_DEDUPE_AUDIT: verdictHash=${groupVerdictHash} emitted=true suppressedCount=${suppressedCount} reason=${prevGroupHash ? 'group_verdict_changed' : 'first_group_verdict'}`);
      _suppressedGroupVerdictCountByGroup.set(g.group, 0);
      _lastGroupVerdictByGroup.set(g.group, groupVerdictHash);
    } else {
      _suppressedGroupVerdictCountByGroup.set(g.group, suppressedCount + 1);
      logger.info(`MARKET_ANALYZER_LOG_DEDUPE_AUDIT: verdictHash=${groupVerdictHash} emitted=false suppressedCount=${suppressedCount + 1} reason=identical_group_verdict`);
    }
  }

  return { generatedAt: Date.now(), scanPeriod, sampleSize: candidates.length, overall, groups };
}
