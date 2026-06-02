import type { AutobotsInput, AutobotsOutput, DetectedSetup, ConfidenceTier } from '../types';

export function evaluateAutobots(input: AutobotsInput): AutobotsOutput {
  const hardBlocks: string[] = [];
  const warnings: string[] = [];
  const snapshot: Record<string, unknown> = {};

  if (input.marketRiskOff) hardBlocks.push('market_risk_off');
  if (!input.hasFreshPrice) hardBlocks.push('stale_price');
  if (!input.tpRoomOk) hardBlocks.push('no_tp_room');
  if (input.mlBlocked) hardBlocks.push('ml_blocked');
  if (!input.groupEnabled) hardBlocks.push('group_disabled');
  if (input.fallingKnife) hardBlocks.push('falling_knife');
  if (input.overextended) hardBlocks.push('overextended');
  if (input.candleExhaustion) hardBlocks.push('candle_exhaustion');
  if (input.spreadPct > 0.5) hardBlocks.push('spread_slippage_too_high');

  if (input.quality < 3) warnings.push('trade_quality_poor');

  let detectedSetup: DetectedSetup = 'NONE';
  let reason = '';
  let selectedStrategy = '';
  let effectiveReferenceMode = '';
  let confidenceTier: ConfidenceTier = 'LOW';

  if (hardBlocks.length > 0) {
    return {
      selectedStrategy: 'wait', effectiveReferenceMode: 'none', confidenceTier: 'LOW',
      detectedSetup: 'NONE', reason: `Hard blocks: ${hardBlocks.join(', ')}`,
      hardBlocks, warnings, ready: false, snapshot,
    };
  }

  if (input.isUptrend && input.momentumScore > 5 && !input.overextended) {
    detectedSetup = 'MOMENTUM_SAFE';
    selectedStrategy = 'momentum';
    effectiveReferenceMode = 'momentum_uptrend';
    confidenceTier = input.calibratedConfidence > 0.7 ? 'HIGH' : 'MEDIUM';
    reason = 'Uptrend with momentum';
  } else if (input.dipPercent < -2 && input.reboundPercent > 1) {
    detectedSetup = 'DIP_AND_REBOUND';
    selectedStrategy = 'dip_and_rebound';
    effectiveReferenceMode = 'dip_rebound';
    confidenceTier = 'MEDIUM';
    reason = 'Dip with confirmed rebound';
  } else if (input.dipPercent < -1.5 && input.isUptrend) {
    detectedSetup = 'VWAP_PULLBACK';
    selectedStrategy = 'balanced';
    effectiveReferenceMode = 'vwap_pullback';
    confidenceTier = 'MEDIUM';
    reason = 'VWAP pullback in uptrend';
  } else if (input.breakoutPercent > 2 && input.volumeRel > 1.5) {
    detectedSetup = 'BREAKOUT_RETEST';
    selectedStrategy = 'momentum';
    effectiveReferenceMode = 'breakout_retest';
    confidenceTier = 'HIGH';
    reason = 'Breakout with volume';
  } else if (input.dipPercent < -1 && input.reboundPercent > 0.5) {
    detectedSetup = 'BOLLINGER_RECLAIM';
    selectedStrategy = 'balanced';
    effectiveReferenceMode = 'bollinger_reclaim';
    confidenceTier = 'MEDIUM';
    reason = 'Bollinger band reclaim';
  } else if (input.isUptrend || input.isSideways) {
    detectedSetup = 'CONSERVATIVE';
    selectedStrategy = 'conservative';
    effectiveReferenceMode = 'conservative';
    confidenceTier = 'LOW';
    reason = 'Conservative setup';
  }

  if (detectedSetup === 'NONE') {
    selectedStrategy = 'wait';
    effectiveReferenceMode = 'none';
    reason = 'No setup detected';
  }

  if (!input.autoBotsRuntimeEnabled && selectedStrategy !== 'wait') {
    warnings.push('autobots_runtime_disabled');
  }

  snapshot.detectedSetup = detectedSetup;
  snapshot.selectedStrategy = selectedStrategy;
  snapshot.hardBlocks = [...hardBlocks];

  return {
    selectedStrategy,
    effectiveReferenceMode,
    confidenceTier,
    detectedSetup,
    reason,
    hardBlocks,
    warnings,
    ready: hardBlocks.length === 0 && detectedSetup !== 'NONE',
    snapshot,
  };
}
