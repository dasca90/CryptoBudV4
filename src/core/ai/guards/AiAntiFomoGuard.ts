import type { AiDecisionInput } from '../AiTakeoverTypes';

export interface AiGuardResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  blockedReason: string | null;
  reason: string;
}

export interface AiAntiFomoSettings {
  enabled: boolean;
  maxPump15mPct: number;
  maxPump1hPct: number;
  maxPump24hPct: number;
  requirePullbackAfterPump: boolean;
  requireReboundAfterPullback: boolean;
  avoidLateEntriesNearResistance: boolean;
  avoidCandleExhaustion: boolean;
  minCleanUpsidePct: number;
}

export const DEFAULT_AI_ANTI_FOMO_SETTINGS: AiAntiFomoSettings = {
  enabled: true,
  maxPump15mPct: 6,
  maxPump1hPct: 10,
  maxPump24hPct: 30,
  requirePullbackAfterPump: true,
  requireReboundAfterPullback: true,
  avoidLateEntriesNearResistance: true,
  avoidCandleExhaustion: true,
  minCleanUpsidePct: 3,
};

export function runAiAntiFomoGuard(input: AiDecisionInput, settings = DEFAULT_AI_ANTI_FOMO_SETTINGS): AiGuardResult {
  if (!settings.enabled) return { status: 'PASS', blockedReason: null, reason: 'Anti-FOMO disabled.' };
  const retrospective = input.retrospective;
  if (!retrospective) return { status: 'FAIL', blockedReason: 'RETROSPECTIVE_ANALYSIS_MISSING', reason: 'Anti-FOMO requires retrospective data.' };
  if (input.change15m > settings.maxPump15mPct || input.change1h > settings.maxPump1hPct || input.change24h > settings.maxPump24hPct) {
    return { status: 'FAIL', blockedReason: 'FOMO_RISK_TOO_HIGH', reason: `coin pumped ${input.change1h.toFixed(2)}% in 1h and is ${retrospective.resistanceDistancePct.toFixed(2)}% below resistance` };
  }
  if (settings.avoidLateEntriesNearResistance && retrospective.cleanUpsidePct < settings.minCleanUpsidePct) {
    return { status: 'FAIL', blockedReason: 'CLEAN_UPSIDE_TOO_SMALL', reason: `clean upside ${retrospective.cleanUpsidePct.toFixed(2)}% is below ${settings.minCleanUpsidePct}%` };
  }
  if (settings.avoidCandleExhaustion && retrospective.candleExhaustion) {
    return { status: 'FAIL', blockedReason: 'CANDLE_EXHAUSTION', reason: 'Candle exhaustion detected.' };
  }
  if (retrospective.overextended) {
    return { status: 'FAIL', blockedReason: 'LATE_ENTRY_AFTER_PUMP', reason: 'Coin is overextended after pump.' };
  }
  return { status: 'PASS', blockedReason: null, reason: 'Anti-FOMO checks passed.' };
}
