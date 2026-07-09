import type { AiDecisionInput } from '../AiTakeoverTypes';
import type { AiGuardResult } from './AiAntiFomoGuard';

export interface AiNewListingContext {
  symbolAgeMinutes?: number;
  stabilizationMinutes?: number;
  maxListingPumpPct?: number;
}

export function runAiNewListingGuard(input: AiDecisionInput, context: AiNewListingContext = {}): AiGuardResult {
  const age = context.symbolAgeMinutes;
  const stabilization = context.stabilizationMinutes ?? 30;
  const maxPump = context.maxListingPumpPct ?? 20;
  if (age === undefined) return { status: 'WARN', blockedReason: null, reason: 'Symbol age unavailable; existing CEX metadata did not provide listing age.' };
  if (age < stabilization) return { status: 'FAIL', blockedReason: 'NEW_LISTING_TOO_EARLY', reason: `Symbol age ${age}m is below stabilization ${stabilization}m.` };
  if (input.change24h > maxPump) return { status: 'FAIL', blockedReason: 'NEW_LISTING_ALREADY_PUMPED', reason: `New listing already pumped ${input.change24h.toFixed(2)}%.` };
  if (input.bookFresh === false) return { status: 'FAIL', blockedReason: 'NEW_LISTING_THIN_BOOK', reason: 'New listing book is not fresh.' };
  if (input.spreadPct > 0.35) return { status: 'FAIL', blockedReason: 'NEW_LISTING_SPREAD_UNSTABLE', reason: 'New listing spread is unstable.' };
  return { status: 'PASS', blockedReason: null, reason: 'New listing checks passed.' };
}
