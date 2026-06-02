const EXPLANATIONS: Record<string, string> = {
  REBOUND_NOT_CONFIRMED: 'Price has not bounced enough after dip. Waiting for rebound confirmation.',
  SPREAD_TOO_HIGH: 'Spread/slippage is too high compared with Max Spread setting.',
  NO_TP_ROOM: 'Not enough room to target profit after fees/spread.',
  PRICE_STALE: 'Price data is too old. Waiting for fresh market data.',
  VOLUME_TOO_LOW: 'Volume is below required confirmation threshold.',
  MOMENTUM_TOO_LOW: 'Momentum is too weak for selected strategy.',
  ANTI_FOMO_BLOCK: 'Move is too extended. Waiting for safer pullback.',
  WAITING_FOR_SAFE_PULLBACK: 'Coin pumped too fast. Waiting for pullback before entry.',
  OVEREXTENDED_PRICE: 'Price is overextended. Anti-FOMO guard active.',
  BOLLINGER_UPPER_OVEREXTENSION: 'Price above/near Bollinger upper band. Overextended.',
  MAX_POSITIONS_REACHED: 'AutoTrader already reached max open positions.',
  CAPITAL_BLOCKED: 'Not enough available capital for new position.',
  GROUP_DISABLED: 'This risk group is disabled in Dipper settings.',
  GROUP_BEARISH: 'Group trend is bearish — waiting for safer conditions.',
  FALLING_KNIFE: 'Falling knife detected — waiting for stabilization.',
  HARD_BLOCK_ACTIVE: 'Hard safety block active — candidate cannot execute.',
  DUPLICATE_OPEN_POSITION: 'Already have an open position for this coin.',
  DUPLICATE_PENDING_LOCK: 'A pending order lock already exists for this coin.',
  ENTRYGATE_BLOCK: 'EntryGate rejected this candidate.',
  RISKENGINE_BLOCK: 'RiskEngine rejected this candidate.',
  MAX_ENTRIES_PER_COIN_REACHED: 'Max entries per coin limit reached.',
  MAX_ENTRIES_PER_CYCLE_REACHED: 'Max entries per scan cycle reached.',
  POST_LOSS_REENTRY_BLOCKED: 'Recent loss blocks re-entry. Cooldown active.',
  MOMENTUM_EXHAUSTION: 'Momentum is exhausting. Likely reversal incoming.',
  RETEST_REQUIRED: 'Price must retest breakout level before entry.',
  MAX_CHASE_EXCEEDED: 'Price moved too far from entry zone.',
  LIVE_DISABLED: 'Live trading is locked in this build.',
  SCANNER_NOT_RUNNING: 'Scanner is not running.',
  PAPER_AUTO_DISABLED: 'Demo execution is disabled.',
  DEMO_AUTO_DISABLED: 'Demo execution is disabled.',
  WRONG_PLANNED_ACTION: 'Planned action mismatch — not BUY.',
  STATUS_NOT_BUY: 'Candidate status is not BUY.',
};

export function getBlockerExplanation(reason: string | null | undefined): string {
  if (!reason) return '';
  const upper = reason.toUpperCase().replace(/\s+/g, '_');
  if (EXPLANATIONS[upper]) return EXPLANATIONS[upper];

  for (const [key, explanation] of Object.entries(EXPLANATIONS)) {
    if (upper.includes(key)) return explanation;
  }

  if (reason.length > 80) return reason;
  return '';
}
