import type { ClosePriceResolution, ClosePriceSource, ClosePriceStatus } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';

export async function resolveClosePrice(coin: string, side: 'BUY' | 'SELL'): Promise<ClosePriceResolution> {
  const feed = MarketDataFeed.getInstance();
  const attemptedSources: string[] = [];
  const errors: string[] = [];
  const capturedAt = Date.now();

  async function tryBookTicker(): Promise<ClosePriceResolution | null> {
    attemptedSources.push('book_ticker');
    try {
      const price = await feed.getPrice(coin);
      if (price.bid > 0 && price.ask > 0 && Date.now() - price.timestamp < 15000) {
        const usePrice = side === 'SELL' ? price.bid : price.ask;
        return {
          symbol: coin, price: usePrice, bidPrice: price.bid, askPrice: price.ask, lastPrice: price.last,
          source: 'book_ticker', status: 'fresh_book_ticker', capturedAt, ageMs: Date.now() - price.timestamp,
          isFresh: true, isRealMarketPrice: true, attemptedSources, errors: [],
        };
      }
      if (price.bid === 0 && price.ask === 0) errors.push('book_ticker_zero_prices');
      return null;
    } catch (e) {
      errors.push(`book_ticker_error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async function tryRestTicker(): Promise<ClosePriceResolution | null> {
    attemptedSources.push('rest_ticker');
    try {
      const symbol = coin.replace('USDT', '') + 'USDT';
      const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      const data = await resp.json() as { symbol?: string; price?: string };
      if (data.price) {
        const p = parseFloat(data.price);
        if (p > 0) {
          return {
            symbol: coin, price: p, bidPrice: p, askPrice: p, lastPrice: p,
            source: 'rest_ticker', status: 'fresh_rest_ticker', capturedAt, ageMs: 0,
            isFresh: true, isRealMarketPrice: true, attemptedSources, errors: [],
          };
        }
      }
      errors.push('rest_ticker_invalid_response');
      return null;
    } catch (e) {
      errors.push(`rest_ticker_error: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  function tryLiveCache(): ClosePriceResolution | null {
    attemptedSources.push('live_ticker_cache');
    const cached = feed.getLastPrice(coin);
    if (cached > 0) {
      return {
        symbol: coin, price: cached, bidPrice: cached, askPrice: cached, lastPrice: cached,
        source: 'live_ticker_cache', status: 'cached_live_price', capturedAt, ageMs: 0,
        isFresh: false, isRealMarketPrice: true, attemptedSources, errors: [],
      };
    }
    errors.push('live_cache_empty');
    return null;
  }

  function triggerFallback(): ClosePriceResolution {
    attemptedSources.push('trigger_fallback');
    const cached = feed.getLastPrice(coin);
    return {
      symbol: coin, price: cached, bidPrice: cached, askPrice: cached, lastPrice: cached,
      source: 'trigger_fallback', status: 'trigger_fallback', capturedAt, ageMs: 0,
      isFresh: false, isRealMarketPrice: false, attemptedSources, errors,
    };
  }

  function unavailable(): ClosePriceResolution {
    attemptedSources.push('unavailable');
    return {
      symbol: coin, price: 0, bidPrice: 0, askPrice: 0, lastPrice: 0,
      source: 'unavailable', status: 'unavailable', capturedAt, ageMs: 0,
      isFresh: false, isRealMarketPrice: false, attemptedSources, errors,
    };
  }

  const bookResult = await tryBookTicker();
  if (bookResult) return bookResult;

  const restResult = await tryRestTicker();
  if (restResult) return restResult;

  const cacheResult = tryLiveCache();
  if (cacheResult) return cacheResult;

  const fallbackResult = triggerFallback();
  if (fallbackResult.price > 0) return fallbackResult;

  return unavailable();
}
