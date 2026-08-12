import type { TimedValue } from './types';
import { percentReturn } from './MarketEdgeMath';

export type OpenInterestContext = 'NEW_POSITION_EXPANSION' | 'SHORT_COVERING_OR_POSITION_CLOSING' | 'NEW_SHORT_PRESSURE' | 'POSITION_FLUSH' | 'NEUTRAL' | 'UNAVAILABLE';

export function classifyPriceAndOpenInterest(priceReturnPct: number | null, oiChangePct: number | null, epsilon = 0.02): OpenInterestContext {
  if (priceReturnPct == null || oiChangePct == null) return 'UNAVAILABLE';
  if (Math.abs(priceReturnPct) < epsilon || Math.abs(oiChangePct) < epsilon) return 'NEUTRAL';
  if (priceReturnPct > 0 && oiChangePct > 0) return 'NEW_POSITION_EXPANSION';
  if (priceReturnPct > 0 && oiChangePct < 0) return 'SHORT_COVERING_OR_POSITION_CLOSING';
  if (priceReturnPct < 0 && oiChangePct > 0) return 'NEW_SHORT_PRESSURE';
  return 'POSITION_FLUSH';
}

export function openInterestChange(points: readonly TimedValue[], horizonMs: number, now: number): number | null {
  return percentReturn(points, horizonMs, now);
}
