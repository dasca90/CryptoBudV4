import type { DynamicTrailInput, DynamicTrailOutput } from '../types';

export function evaluateDynamicTrailFloor(input: DynamicTrailInput): DynamicTrailOutput {
  const {
    entryPrice, tp1Percent, highestPriceSinceTp,
    trailFromPeakPercent, currentMarketPrice, exitPrice: inputExitPrice,
  } = input;

  const tp1FloorPrice = entryPrice * (1 + tp1Percent / 100);
  const trailFromPeakFraction = trailFromPeakPercent / 100;

  let newHighest = highestPriceSinceTp;
  let trailExitPrice = 0;
  let floorRespected = true;
  let floorBreachReason: string | null = null;

  if (currentMarketPrice > highestPriceSinceTp) {
    newHighest = currentMarketPrice;
  }

  trailExitPrice = newHighest * (1 - trailFromPeakFraction);

  const finalDynamicExitTriggerPrice = Math.max(trailExitPrice, tp1FloorPrice);

  let shouldExit = false;
  let exitReason: 'dynamic_trail_hit' | 'dynamic_trail_floor_exit' | null = null;

  if (currentMarketPrice <= trailExitPrice) {
    if (trailExitPrice >= tp1FloorPrice) {
      shouldExit = true;
      exitReason = 'dynamic_trail_hit';
    } else if (currentMarketPrice <= tp1FloorPrice) {
      shouldExit = true;
      exitReason = 'dynamic_trail_floor_exit';
      floorRespected = false;
      floorBreachReason = 'trail_exit_below_tp1_floor';
    }
  }

  const exitPrice = inputExitPrice ?? currentMarketPrice;
  const realizedPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const retracePercent = newHighest > 0 ? ((newHighest - currentMarketPrice) / newHighest) * 100 : 0;

  return {
    tp1Percent,
    tp1FloorPrice,
    highestPriceSinceTp: newHighest,
    trailFromPeakPercent,
    trailExitPrice,
    finalDynamicExitTriggerPrice,
    currentMarketPrice,
    exitPrice,
    realizedPnlPercent,
    retracePercent,
    shouldExit,
    exitReason,
    floorRespected,
    floorBreachReason,
  };
}
