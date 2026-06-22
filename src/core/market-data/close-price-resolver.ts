import type { ClosePriceResolution, ClosePriceSourceDiagnostic } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { getStalePriceAgeMs } from './market-data-quality';

export interface ResolveClosePriceOptions {
  lastKnownPrice?: number;
  lastKnownPriceAt?: number;
  entrySnapshotPrice?: number;
  staleThresholdMs?: number;
}

function finitePositive(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function ageFrom(timestamp: number | undefined, now: number): number | null {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? Math.max(0, now - timestamp)
    : null;
}

function diagnostic(
  source: ClosePriceSourceDiagnostic['source'],
  price: number,
  ageMs: number | null,
  staleThresholdMs: number,
  error?: string,
): ClosePriceSourceDiagnostic {
  const available = price > 0;
  return {
    source,
    available,
    price,
    ageMs,
    fresh: available && ageMs !== null && ageMs <= staleThresholdMs,
    ...(error ? { error } : {}),
  };
}

function withDiagnostics(
  result: Omit<ClosePriceResolution, 'sourceDiagnostics' | 'staleThresholdMs' | 'unavailableReason'>,
  sourceDiagnostics: ClosePriceSourceDiagnostic[],
  staleThresholdMs: number,
  unavailableReason?: string,
): ClosePriceResolution {
  return {
    ...result,
    sourceDiagnostics: [...sourceDiagnostics],
    staleThresholdMs,
    unavailableReason,
  };
}

export function formatClosePriceUnavailableAudit(input: {
  resolution: ClosePriceResolution;
  symbol: string;
  positionId?: string | null;
  executionMode?: string | null;
  exitTickSkipped: boolean;
}): string {
  const res = input.resolution;
  const bySource = new Map((res.sourceDiagnostics ?? []).map((d) => [d.source, d]));
  const fmt = (source: ClosePriceSourceDiagnostic['source']) => {
    const d = bySource.get(source);
    if (!d) return `${source}=not_attempted`;
    return `${source}=available:${String(d.available)},fresh:${String(d.fresh)},price:${d.price},ageMs:${d.ageMs ?? 'n/a'}${d.error ? `,error:${d.error.replace(/\s+/g, '_')}` : ''}`;
  };
  const attempted = [
    fmt('book_ticker'),
    fmt('rest_ticker'),
    fmt('live_ticker_cache'),
    fmt('position.lastKnownPrice'),
    fmt('entrySnapshot fallback'),
  ].join('|');
  const ages = (res.sourceDiagnostics ?? [])
    .map((d) => `${d.source}:${d.ageMs ?? 'n/a'}`)
    .join('|') || 'none';
  return `CLOSE_PRICE_UNAVAILABLE_AUDIT: symbol=${input.symbol} positionId=${input.positionId ?? 'none'} executionMode=${input.executionMode ?? 'unknown'} attemptedSources=${attempted} sourceAvailability=${attempted} priceAgesMs=${ages} staleThreshold=${res.staleThresholdMs ?? 'n/a'} selectedSource=${res.source} reason=${res.unavailableReason ?? 'no_fresh_close_price'} exitTickSkipped=${String(input.exitTickSkipped)}`;
}

export async function resolveClosePrice(coin: string, side: 'BUY' | 'SELL', options: ResolveClosePriceOptions = {}): Promise<ClosePriceResolution> {
  const feed = MarketDataFeed.getInstance();
  const attemptedSources: string[] = [];
  const errors: string[] = [];
  const sourceDiagnostics: ClosePriceSourceDiagnostic[] = [];
  const capturedAt = Date.now();
  const staleThresholdMs = options.staleThresholdMs ?? getStalePriceAgeMs();

  async function tryBookTicker(): Promise<ClosePriceResolution | null> {
    attemptedSources.push('book_ticker');
    try {
      const price = await feed.getPrice(coin);
      const ageMs = ageFrom(price.timestamp, Date.now());
      const usePrice = side === 'SELL' ? finitePositive(price.bid) : finitePositive(price.ask);
      const lastPrice = finitePositive(price.last);
      const diag = diagnostic('book_ticker', usePrice || lastPrice, ageMs, staleThresholdMs);
      sourceDiagnostics.push(diag);
      if (price.bid > 0 && price.ask > 0 && diag.fresh) {
        return withDiagnostics({
          symbol: coin, price: usePrice, bidPrice: price.bid, askPrice: price.ask, lastPrice: price.last,
          source: 'book_ticker', status: 'fresh_book_ticker', capturedAt, ageMs: ageMs ?? 0,
          isFresh: true, isRealMarketPrice: true, attemptedSources: [...attemptedSources], errors: [],
        }, sourceDiagnostics, staleThresholdMs);
      }
      if (price.bid <= 0 || price.ask <= 0) errors.push('book_ticker_zero_prices');
      if (diag.available && !diag.fresh) errors.push('book_ticker_stale');
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`book_ticker_error: ${message}`);
      sourceDiagnostics.push(diagnostic('book_ticker', 0, null, staleThresholdMs, message));
      return null;
    }
  }

  async function tryRestTicker(): Promise<ClosePriceResolution | null> {
    attemptedSources.push('rest_ticker');
    try {
      const symbol = coin.replace('USDT', '') + 'USDT';
      const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      const data = await resp.json() as { symbol?: string; price?: string };
      const p = Number.parseFloat(String(data.price ?? '0'));
      const valid = Number.isFinite(p) && p > 0;
      sourceDiagnostics.push(diagnostic('rest_ticker', valid ? p : 0, 0, staleThresholdMs));
      if (valid) {
        return withDiagnostics({
          symbol: coin, price: p, bidPrice: p, askPrice: p, lastPrice: p,
          source: 'rest_ticker', status: 'fresh_rest_ticker', capturedAt, ageMs: 0,
          isFresh: true, isRealMarketPrice: true, attemptedSources: [...attemptedSources], errors: [],
        }, sourceDiagnostics, staleThresholdMs);
      }
      errors.push('rest_ticker_invalid_response');
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`rest_ticker_error: ${message}`);
      sourceDiagnostics.push(diagnostic('rest_ticker', 0, null, staleThresholdMs, message));
      return null;
    }
  }

  function tryLiveCache(): ClosePriceResolution | null {
    attemptedSources.push('live_ticker_cache');
    const cached = feed.getCachedPrice(coin);
    const ageMs = ageFrom(cached?.timestamp, Date.now());
    const p = finitePositive(side === 'SELL' ? (cached?.bid ?? cached?.last) : (cached?.ask ?? cached?.last));
    const last = finitePositive(cached?.last);
    const diag = diagnostic('live_ticker_cache', p || last, ageMs, staleThresholdMs);
    sourceDiagnostics.push(diag);
    if (diag.fresh && p > 0) {
      return withDiagnostics({
        symbol: coin, price: p, bidPrice: finitePositive(cached?.bid) || p, askPrice: finitePositive(cached?.ask) || p, lastPrice: last || p,
        source: 'live_ticker_cache', status: 'cached_live_price', capturedAt, ageMs: ageMs ?? 0,
        isFresh: true, isRealMarketPrice: true, attemptedSources: [...attemptedSources], errors: [],
      }, sourceDiagnostics, staleThresholdMs);
    }
    errors.push(diag.available ? 'live_ticker_cache_stale' : 'live_cache_empty');
    return null;
  }

  function tryPositionLastKnown(): ClosePriceResolution | null {
    attemptedSources.push('position.lastKnownPrice');
    const p = finitePositive(options.lastKnownPrice);
    const ageMs = ageFrom(options.lastKnownPriceAt, Date.now());
    const diag = diagnostic('position.lastKnownPrice', p, ageMs, staleThresholdMs);
    sourceDiagnostics.push(diag);
    if (diag.fresh && p > 0) {
      return withDiagnostics({
        symbol: coin, price: p, bidPrice: p, askPrice: p, lastPrice: p,
        source: 'position_last_known', status: 'fresh_position_last_known', capturedAt, ageMs: ageMs ?? 0,
        isFresh: true, isRealMarketPrice: true, attemptedSources: [...attemptedSources], errors: [],
      }, sourceDiagnostics, staleThresholdMs);
    }
    errors.push(diag.available ? 'position_last_known_stale' : 'position_last_known_empty');
    return null;
  }

  function recordEntrySnapshotFallback(): void {
    attemptedSources.push('entrySnapshot fallback');
    const p = finitePositive(options.entrySnapshotPrice);
    sourceDiagnostics.push(diagnostic('entrySnapshot fallback', p, null, staleThresholdMs, p > 0 ? 'entry_snapshot_not_allowed_for_real_exit' : undefined));
    if (p > 0) errors.push('entry_snapshot_not_allowed_for_real_exit');
  }

  function unavailable(): ClosePriceResolution {
    attemptedSources.push('unavailable');
    const reason = errors.find((e) => e.includes('error'))
      ?? (sourceDiagnostics.some((d) => d.available && !d.fresh) ? 'all_available_sources_stale' : 'no_source_returned_price');
    return withDiagnostics({
      symbol: coin, price: 0, bidPrice: 0, askPrice: 0, lastPrice: 0,
      source: 'unavailable', status: 'unavailable', capturedAt, ageMs: 0,
      isFresh: false, isRealMarketPrice: false, attemptedSources: [...attemptedSources], errors,
    }, sourceDiagnostics, staleThresholdMs, reason);
  }

  const bookResult = await tryBookTicker();
  if (bookResult) return bookResult;

  const restResult = await tryRestTicker();
  if (restResult) return restResult;

  const cacheResult = tryLiveCache();
  if (cacheResult) return cacheResult;

  const positionResult = tryPositionLastKnown();
  if (positionResult) return positionResult;

  recordEntrySnapshotFallback();
  return unavailable();
}
