import type {
  ScalperComponentScores, ScalperComponentPass, ScalperSignal, CandidateStatus,
} from '../types';

export interface ScalperScoreInput {
  priceFresh: boolean;
  bookFresh: boolean;
  spreadPct: number;
  volumeSurgePct: number;
  momentumScore: number;
  pullbackPct: number;
  confirmationCount: number;
  priceAgeMs: number;
  riskGroup: string | null;
  btcDumping: boolean;
  tpRoomOk: boolean;
  isLive: boolean;
  isVeryHighRisk: boolean;
}

export interface ScalperScoreConfig {
  minVolumeSurgePct: number;
  spreadMaxPct: number;
  momentumThreshold: number;
  pullbackEntryPct: number;
  confirmationCandles: number;
  scalpScoreThreshold: number;
  tp1Pct: number;
  tp2Pct: number;
  stopLossPct: number;
  maxHoldSec: number;
  trailTriggerPct: number;
  trailPullbackPct: number;
}

export const DEFAULT_SCALPER_CONFIG: ScalperScoreConfig = {
  minVolumeSurgePct: 150,
  spreadMaxPct: 0.10,
  momentumThreshold: 35,
  pullbackEntryPct: 0.20,
  confirmationCandles: 2,
  scalpScoreThreshold: 55,
  tp1Pct: 0.80,
  tp2Pct: 0,
  stopLossPct: 0.40,
  maxHoldSec: 120,
  trailTriggerPct: 0.60,
  trailPullbackPct: 0.25,
};

export interface ScalperScoreOutput {
  scalpScore: number;
  componentScores: ScalperComponentScores;
  componentPass: ScalperComponentPass;
  signal: ScalperSignal;
  statusSuggestion: CandidateStatus;
  blockReasons: string[];
  reasons: string[];
  warnings: string[];
}

export function calculateScalpScore(
  input: ScalperScoreInput,
  config: ScalperScoreConfig = DEFAULT_SCALPER_CONFIG,
): ScalperScoreOutput {
  const blockReasons: string[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ── Hard blocks ──
  if (!input.priceFresh) {
    blockReasons.push('BLOCK_PRICE_STALE');
  }

  if (!input.bookFresh) {
    blockReasons.push('BLOCK_BOOK_STALE');
  }

  if (input.btcDumping) {
    blockReasons.push('BLOCK_BTC_DUMP');
  }

  if (!input.tpRoomOk) {
    blockReasons.push('BLOCK_NO_TP_ROOM');
  }

  if (input.isLive && input.isVeryHighRisk) {
    blockReasons.push('BLOCK_VERY_HIGH_RISK_LIVE');
  }

  if (input.isLive) {
    blockReasons.push('BLOCK_SCALPER_LIVE_DISABLED');
  }

  // ── Component scores ──
  const volumeSurgeRaw = Math.min(input.volumeSurgePct / config.minVolumeSurgePct, 2);
  const volumeSurge = Math.round(volumeSurgeRaw * 25);
  const volumePass = input.volumeSurgePct >= config.minVolumeSurgePct;
  if (!volumePass) {
    blockReasons.push('BLOCK_VOLUME_TOO_LOW');
  }

  const momentumRaw = Math.min(input.momentumScore / config.momentumThreshold, 2);
  const momentum = Math.round(momentumRaw * 20);
  const momentumPass = input.momentumScore >= config.momentumThreshold;
  if (!momentumPass) {
    blockReasons.push('BLOCK_MOMENTUM_NOT_CONFIRMED');
  }

  const spreadRaw = Math.max(0, 1 - input.spreadPct / config.spreadMaxPct);
  const spread = Math.round(spreadRaw * 20);
  const spreadPass = input.spreadPct <= config.spreadMaxPct;
  if (!spreadPass) {
    blockReasons.push('BLOCK_SPREAD_TOO_HIGH');
  }

  const pullbackRaw = Math.min(input.pullbackPct / config.pullbackEntryPct, 1.5);
  const pullback = Math.round(pullbackRaw * 15);
  const pullbackPass = input.pullbackPct >= config.pullbackEntryPct;

  const confirmationRaw = Math.min(input.confirmationCount / config.confirmationCandles, 1.5);
  const confirmation = Math.round(confirmationRaw * 10);
  const confirmationPass = input.confirmationCount >= config.confirmationCandles;

  const ageFactor = Math.max(0, 1 - input.priceAgeMs / 60000);
  const priceFreshness = Math.round(ageFactor * 10);
  const priceFreshnessPass = input.priceAgeMs < 30000;

  if (input.priceAgeMs >= 60000) {
    blockReasons.push('BLOCK_PRICE_STALE');
  }

  // ── Signal detection ──
  let signal: ScalperSignal = 'NONE';
  if (momentumPass && volumePass && spreadPass) {
    signal = 'MOMENTUM_SCALP';
    reasons.push('momentum scalp setup detected');
  } else if (pullbackPass && spreadPass && momentumPass) {
    signal = 'PULLBACK_SCALP';
    reasons.push('pullback scalp setup detected');
  } else if (momentumPass && volumePass) {
    signal = 'BREAKOUT_SCALP';
    reasons.push('breakout scalp setup detected');
  }

  // ── Total scalp score ──
  const scalpScore = volumeSurge + momentum + spread + pullback + confirmation + priceFreshness;

  // ── Status suggestion ──
  let statusSuggestion: CandidateStatus;
  if (blockReasons.length > 0) {
    const hardBlock = blockReasons.some(r =>
      ['BLOCK_PRICE_STALE', 'BLOCK_BOOK_STALE', 'BLOCK_BTC_DUMP',
       'BLOCK_NO_TP_ROOM', 'BLOCK_VERY_HIGH_RISK_LIVE',
       'BLOCK_SCALPER_LIVE_DISABLED'].includes(r)
    );
    if (hardBlock) {
      statusSuggestion = 'BLOCK';
    } else {
      statusSuggestion = 'WAIT';
    }
  } else if (scalpScore < config.scalpScoreThreshold) {
    statusSuggestion = 'WAIT';
    blockReasons.push('BLOCK_SCORE_BELOW_THRESHOLD');
  } else {
    statusSuggestion = 'BUY';
    reasons.push(`scalp score ${scalpScore} >= threshold ${config.scalpScoreThreshold}`);
  }

  const componentScores: ScalperComponentScores = {
    volumeSurge, momentum, spread, pullback, confirmation, priceFreshness,
  };

  const componentPass: ScalperComponentPass = {
    volumeSurge: volumePass, momentum: momentumPass, spread: spreadPass,
    pullback: pullbackPass, confirmation: confirmationPass, priceFreshness: priceFreshnessPass,
  };

  return {
    scalpScore,
    componentScores,
    componentPass,
    signal,
    statusSuggestion,
    blockReasons,
    reasons,
    warnings,
  };
}
