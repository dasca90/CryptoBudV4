import type { BookObservation, LiquidationObservation, TimedValue, TradeObservation } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function percentReturn(points: readonly TimedValue[], horizonMs: number, now: number): number | null {
  const latest = points[points.length - 1];
  if (!latest || latest.value <= 0) return null;
  const target = now - horizonMs;
  let base: TimedValue | undefined;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].eventTime <= target) { base = points[i]; break; }
  }
  if (!base || base.value <= 0) return null;
  return ((latest.value - base.value) / base.value) * 100;
}

export function orderFlowImbalance(book: BookObservation | null, levels = 10): number | null {
  if (!book) return null;
  const bidDepth = book.bids.slice(0, levels).reduce((sum, level) => sum + Math.max(0, level.price * level.quantity), 0);
  const askDepth = book.asks.slice(0, levels).reduce((sum, level) => sum + Math.max(0, level.price * level.quantity), 0);
  const total = bidDepth + askDepth;
  return total > 0 ? clamp((bidDepth - askDepth) / total, -1, 1) : null;
}

function bookDepth(book: BookObservation, levels: number): { bid: number; ask: number } {
  return {
    bid: book.bids.slice(0, levels).reduce((sum, level) => sum + Math.max(0, level.price * level.quantity), 0),
    ask: book.asks.slice(0, levels).reduce((sum, level) => sum + Math.max(0, level.price * level.quantity), 0),
  };
}

export function orderBookDynamics(books: readonly BookObservation[], now: number, windowMs = 15_000, levels = 10): {
  bidDepthChangePct: number | null; askDepthChangePct: number | null; depthAcceleration: number | null; spreadChangePct: number | null;
  bidReplenishment: boolean; askReplenishment: boolean; liquidityWithdrawal: boolean; unstableBook: boolean;
} {
  const recent = books.filter(book => book.eventTime <= now && book.eventTime >= now - windowMs);
  const latest = recent[recent.length - 1], base = recent[0];
  if (!latest || !base || latest === base) return { bidDepthChangePct: null, askDepthChangePct: null, depthAcceleration: null, spreadChangePct: null, bidReplenishment: false, askReplenishment: false, liquidityWithdrawal: false, unstableBook: false };
  const latestDepth = bookDepth(latest, levels), baseDepth = bookDepth(base, levels);
  const change = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null;
  const bidDepthChangePct = change(latestDepth.bid, baseDepth.bid), askDepthChangePct = change(latestDepth.ask, baseDepth.ask), spreadChangePct = change(latest.spreadPct, base.spreadPct);
  const midpointDepth = bookDepth(recent[Math.floor(recent.length / 2)], levels);
  const firstDelta = (midpointDepth.bid - midpointDepth.ask) - (baseDepth.bid - baseDepth.ask);
  const secondDelta = (latestDepth.bid - latestDepth.ask) - (midpointDepth.bid - midpointDepth.ask);
  const depthAcceleration = (Math.abs(firstDelta) + Math.abs(secondDelta)) > 0 ? secondDelta - firstDelta : 0;
  const ofis = recent.map(book => orderFlowImbalance(book, levels)).filter((value): value is number => value != null);
  const signFlips = ofis.slice(1).reduce((count, value, index) => count + (Math.sign(value) !== Math.sign(ofis[index]) ? 1 : 0), 0);
  return {
    bidDepthChangePct, askDepthChangePct, depthAcceleration, spreadChangePct,
    bidReplenishment: (bidDepthChangePct ?? 0) >= 10,
    askReplenishment: (askDepthChangePct ?? 0) >= 10,
    liquidityWithdrawal: (bidDepthChangePct ?? 0) <= -20 || (askDepthChangePct ?? 0) <= -20,
    unstableBook: ofis.length >= 4 && signFlips / (ofis.length - 1) > 0.6,
  };
}

export function takerFlow(trades: readonly TradeObservation[], windowMs: number, now: number): { ratio: number | null; quoteVolume: number } {
  const cutoff = now - windowMs;
  let buys = 0;
  let sells = 0;
  for (const trade of trades) {
    if (trade.eventTime < cutoff || trade.eventTime > now) continue;
    const quote = Math.max(0, trade.price * trade.quantity);
    if (trade.aggressiveBuyer) buys += quote;
    else sells += quote;
  }
  const total = buys + sells;
  return { ratio: total > 0 ? buys / total : null, quoteVolume: total };
}

export function liquidationTotals(events: readonly LiquidationObservation[], windowMs: number, now: number): { longUsd: number; shortUsd: number } {
  const cutoff = now - windowMs;
  let longUsd = 0;
  let shortUsd = 0;
  for (const event of events) {
    if (event.eventTime < cutoff || event.eventTime > now) continue;
    if (event.side === 'LONG') longUsd += Math.max(0, event.notionalUsd);
    else shortUsd += Math.max(0, event.notionalUsd);
  }
  return { longUsd, shortUsd };
}

export function relativeAcceleration(current: number, baseline: number): number | null {
  return baseline > 0 && Number.isFinite(current) ? current / baseline : null;
}
