export type SemanticTone = 'good' | 'warn' | 'bad' | 'info' | 'ai' | 'muted';

export function getSemanticClass(value: string | null | undefined, type: 'status' | 'market' | 'data' | 'pnl'): string {
  if (!value || value === 'n/a' || value === 'unknown') return 'text-muted';
  const v = value.toUpperCase().trim();

  if (type === 'status') {
    if (['RUNNING', 'ONLINE', 'BUY', 'OK', 'PASS', 'APPROVED', 'CONFIRMED', 'READY', 'PAPER_READY', 'ENABLED'].includes(v))
      return 'text-good';
    if (['WAIT', 'WAITING', 'DEMO', 'PAPER', 'PARTIAL', 'LOADING', 'SCANNING', 'IDLE', 'PENDING', 'STALE', 'DEMO_ONLY', 'PAPER_ONLY'].includes(v))
      return 'text-warn';
    if (['BLOCK', 'BLOCKED', 'ERROR', 'OFFLINE', 'STOP', 'LOSS', 'EMERGENCY', 'REJECTED', 'AVOID', 'FAIL', 'DISABLED', 'LIVE_LOCKED'].includes(v))
      return 'text-bad';
    return 'text-info';
  }

  if (type === 'market') {
    if (['BULLISH', 'UP_TREND', 'STRONG_BULLISH', 'UP', 'GREEN'].includes(v))
      return 'text-good';
    if (['SIDEWAYS', 'CHOPPY', 'WAITING_FOR_REBOUND', 'CAUTION', 'NEUTRAL', 'WAIT'].includes(v))
      return 'text-warn';
    if (['BEARISH', 'DOWN_TREND', 'STRONG_BEARISH', 'BEARISH_OR_UNSAFE', 'DOWN', 'RED'].includes(v))
      return 'text-bad';
    return 'text-info';
  }

  if (type === 'data') {
    if (['GOOD', 'FRESH', 'PASS', 'OK'].includes(v))
      return 'text-good';
    if (['MEDIUM', 'PARTIAL', 'STALE'].includes(v))
      return 'text-warn';
    if (['BAD', 'ERROR', 'MISSING', 'N/A'].includes(v))
      return 'text-muted';
    return 'text-info';
  }

  if (type === 'pnl') {
    const num = parseFloat(v);
    if (!isNaN(num)) {
      if (num > 0) return 'text-good';
      if (num < 0) return 'text-bad';
    }
    if (v.startsWith('+')) return 'text-good';
    if (v.startsWith('-')) return 'text-bad';
    return 'text-muted';
  }

  return 'text-info';
}

export function getGlowClass(value: string | null | undefined, type: 'status' | 'market' | 'data' | 'pnl'): string {
  const base = getSemanticClass(value, type);
  return base.replace('text-', 'text-glow-');
}
