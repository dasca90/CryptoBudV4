import type { AiDecisionInput } from '../AiTakeoverTypes';
import type { AiGuardResult } from './AiAntiFomoGuard';

export function runAiManipulationGuard(input: AiDecisionInput): AiGuardResult {
  const retrospective = input.retrospective;
  if (!retrospective) return { status: 'FAIL', blockedReason: 'RETROSPECTIVE_ANALYSIS_MISSING', reason: 'Manipulation guard requires retrospective data.' };
  if (input.bookFresh === false) return { status: 'FAIL', blockedReason: 'stale_book', reason: 'Order book is stale.' };
  if (input.spreadPct > 0.35) return { status: 'FAIL', blockedReason: 'spread_too_high', reason: `Spread ${input.spreadPct.toFixed(2)}% is too high.` };
  if (retrospective.liquidityDepthStatus === 'FAIL') return { status: 'FAIL', blockedReason: 'liquidity_depth_insufficient', reason: 'Liquidity depth is insufficient.' };
  if (retrospective.volumeStabilityStatus === 'FAIL') return { status: 'FAIL', blockedReason: 'volume_collapse', reason: 'Volume stability failed.' };
  if (retrospective.pumpRiskPct > 20) return { status: 'FAIL', blockedReason: 'repeated_pump_dump_pattern', reason: 'Pump risk is elevated.' };
  if (retrospective.volatilityPct > 20) return { status: 'WARN', blockedReason: null, reason: 'High volatility spike detected.' };
  return { status: 'PASS', blockedReason: null, reason: 'Manipulation checks passed.' };
}
