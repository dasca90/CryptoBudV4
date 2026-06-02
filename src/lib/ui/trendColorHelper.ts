export type TrendTone = 'bullish' | 'bearish' | 'sideways' | 'neutral' | 'unknown';

const TREND_COLORS: Record<TrendTone, string> = {
  bullish: '#22c55e',
  bearish: '#ef4444',
  sideways: '#f59e0b',
  neutral: '#94a3b8',
  unknown: '#64748b',
};

const BULLISH = new Set([
  'bullish', 'up_trend', 'strong_bullish', 'up', 'green', 'positive',
]);

const BEARISH = new Set([
  'bearish', 'down_trend', 'strong_bearish', 'bearish_or_unsafe', 'down', 'red', 'negative',
]);

const SIDEWAYS = new Set([
  'sideways', 'choppy', 'waiting_for_rebound', 'neutral', 'caution', 'wait', 'waiting',
]);

const UNKNOWN = new Set([
  'unknown', 'n/a', '', 'undefined', 'null',
]);

export function getTrendTone(value: string | null | undefined): TrendTone {
  if (!value) return 'unknown';
  const v = value.toLowerCase().trim().replace(/\s+/g, '_');
  if (BULLISH.has(v)) return 'bullish';
  if (BEARISH.has(v)) return 'bearish';
  if (SIDEWAYS.has(v) || v === 'wait') return 'sideways';
  if (UNKNOWN.has(v)) return 'unknown';
  return 'neutral';
}

export function getTrendColor(value: string | null | undefined): string {
  return TREND_COLORS[getTrendTone(value)];
}

export function getTrendClassName(value: string | null | undefined): string {
  return `trend-${getTrendTone(value)}`;
}

export function getTrendGlow(value: string | null | undefined): string {
  const tone = getTrendTone(value);
  if (tone === 'bullish') return 'text-glow-green';
  if (tone === 'bearish') return 'text-glow-red';
  if (tone === 'sideways') return 'text-glow-amber';
  return '';
}
