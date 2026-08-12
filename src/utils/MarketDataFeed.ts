import type { MarketPrice, SymbolFilters, MarketDataQualityLevel } from '../core/types';
import { parseSymbolFilters, isSymbolTradable } from '../core/market-data/symbol-filters';
import { evaluateMarketDataQuality, getStalePriceAgeMs, getStaleBookAgeMs } from '../core/market-data/market-data-quality';
import { logger } from './logger';

type PriceCallback = (price: MarketPrice) => void;

export class MarketDataFeed {
  private static instance: MarketDataFeed;
  private prices: Map<string, MarketPrice> = new Map();
  private listeners: Map<string, Set<PriceCallback>> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private exchangeInfo: Record<string, unknown> | null = null;
  private exchangeInfoFetchedAt = 0;
  private symbolFiltersCache: Map<string, SymbolFilters> = new Map();
  private inFlightExchangeInfo: Promise<void> | null = null;

  static getInstance(): MarketDataFeed {
    if (!MarketDataFeed.instance) {
      MarketDataFeed.instance = new MarketDataFeed();
    }
    return MarketDataFeed.instance;
  }

  private constructor() {}

  async getPrice(coin: string): Promise<MarketPrice> {
    const cached = this.prices.get(coin);
    if (cached && Date.now() - cached.timestamp < 2000) return cached;

    const price = await this.fetchPrice(coin);
    if (this.isValidBookTicker(price)) this.prices.set(coin, price);
    return price;
  }

  private isValidBookTicker(price: MarketPrice): boolean {
    return Number.isFinite(price.last) && price.last > 0
      && Number.isFinite(price.bid) && price.bid > 0
      && Number.isFinite(price.ask) && price.ask > 0
      && price.ask >= price.bid;
  }

  getLastPrice(coin: string): number {
    return this.prices.get(coin)?.last ?? 0;
  }

  getCachedPrice(coin: string): MarketPrice | null {
    return this.prices.get(coin) ?? null;
  }

  getPriceAgeMs(coin: string): number {
    const p = this.prices.get(coin);
    return p ? Date.now() - p.timestamp : 999999;
  }

  getBookAgeMs(coin: string): number {
    const p = this.prices.get(coin);
    return p ? Date.now() - p.timestamp : 999999;
  }

  getSpreadPct(coin: string): number {
    const p = this.prices.get(coin);
    if (!p || p.ask <= 0) return 999;
    return ((p.ask - p.bid) / p.ask) * 100;
  }

  private async fetchPrice(coin: string): Promise<MarketPrice> {
    try {
      const symbol = coin.replace('USDT', '') + 'USDT';
      const resp = await fetch(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
      const data = await resp.json();

      if (data.code === -1121) throw new Error(`Unknown symbol: ${symbol}`);

      return {
        coin,
        bid: parseFloat(data.bidPrice),
        ask: parseFloat(data.askPrice),
        last: (parseFloat(data.bidPrice) + parseFloat(data.askPrice)) / 2,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.warn(`MarketDataFeed: Failed to fetch ${coin}, using fallback.`, err);
      return {
        coin,
        bid: 0, ask: 0, last: 0, timestamp: Date.now(),
      };
    }
  }

  subscribe(coin: string, callback: PriceCallback): () => void {
    if (!this.listeners.has(coin)) this.listeners.set(coin, new Set());
    this.listeners.get(coin)!.add(callback);

    if (!this.intervals.has(coin)) {
      this.intervals.set(coin, setInterval(async () => {
        try {
          const price = await this.fetchPrice(coin);
          // A failed/invalid attempt must not make a millisecond-old zero quote
          // look like the last valid market event.
          if (this.isValidBookTicker(price)) {
            this.prices.set(coin, price);
            for (const cb of this.listeners.get(coin) || []) cb(price);
          }
        } catch { /* retry next cycle */ }
      }, 3000));
    }

    return () => {
      this.listeners.get(coin)?.delete(callback);
      if (this.listeners.get(coin)?.size === 0) {
        clearInterval(this.intervals.get(coin));
        this.intervals.delete(coin);
      }
    };
  }

  getActiveSubscriptionCount(): number {
    let count = 0;
    for (const callbacks of this.listeners.values()) count += callbacks.size;
    return count;
  }

  getActiveIntervalCount(): number {
    return this.intervals.size;
  }

  getListenerCount(coin: string): number {
    return this.listeners.get(coin)?.size ?? 0;
  }

  setManualPrice(coin: string, price: number, timestamp = Date.now()) {
    this.prices.set(coin, {
      coin, bid: price * 0.999, ask: price * 1.001, last: price, timestamp,
    });
  }

  setSymbolFilters(symbol: string, filters: import('../core/types').SymbolFilters) {
    this.symbolFiltersCache.set(symbol, filters);
  }

  // ── ExchangeInfo / Symbol Filters ──────────────

  async fetchExchangeInfo(force = false): Promise<void> {
    if (this.inFlightExchangeInfo) return this.inFlightExchangeInfo;
    if (!force && this.exchangeInfo && Date.now() - this.exchangeInfoFetchedAt < 300000) return;

    this.inFlightExchangeInfo = this.doFetchExchangeInfo();
    try {
      await this.inFlightExchangeInfo;
    } finally {
      this.inFlightExchangeInfo = null;
    }
  }

  private async doFetchExchangeInfo(): Promise<void> {
    try {
      const resp = await fetch('https://api.binance.com/api/v3/exchangeInfo');
      this.exchangeInfo = await resp.json() as Record<string, unknown>;
      this.exchangeInfoFetchedAt = Date.now();
      this.symbolFiltersCache.clear();

      const symbols = Array.isArray(this.exchangeInfo.symbols)
        ? this.exchangeInfo.symbols as Record<string, unknown>[]
        : [];
      if (symbols.length === 0) {
        logger.warn('EXCHANGE_INFO_SYMBOLS_UNAVAILABLE: exchangeInfo response missing symbols array; symbol filters remain cached/empty');
      }
      for (const sym of symbols) {
        const symbolName = sym.symbol as string;
        const filters = parseSymbolFilters(symbolName, this.exchangeInfo);
        if (filters) this.symbolFiltersCache.set(symbolName, filters);
      }
    } catch (err) {
      console.warn('MarketDataFeed: Failed to fetch exchangeInfo', err);
    }
  }

  getExchangeInfo(): Record<string, unknown> | null {
    return this.exchangeInfo;
  }

  getExchangeInfoFetchedAt(): number {
    return this.exchangeInfoFetchedAt;
  }

  getSymbolFilters(symbol: string): SymbolFilters | null {
    return this.symbolFiltersCache.get(symbol) ?? null;
  }

  isSymbolTradable(symbol: string): boolean {
    const filters = this.getSymbolFilters(symbol);
    return isSymbolTradable(filters);
  }

  getMarketDataQuality(symbol: string): { quality: MarketDataQualityLevel; priceFresh: boolean; bookFresh: boolean; spreadOk: boolean; filtersOk: boolean } {
    const current = this.getCanonicalSymbolMarketData(symbol);
    return {
      quality: current.quality,
      priceFresh: current.priceFresh,
      bookFresh: current.bookFresh,
      spreadOk: current.spreadOk,
      filtersOk: current.filtersOk,
    };
  }

  getCanonicalSymbolMarketData(symbol: string, now = Date.now()): import('../core/market-data/canonical-market-freshness').CanonicalSymbolMarketData {
    const p = this.prices.get(symbol);
    const price = p?.last ?? 0;
    const bid = p?.bid ?? 0;
    const ask = p?.ask ?? 0;
    const priceAgeMs = p ? Math.max(0, now - p.timestamp) : 999999;
    const bookAgeMs = p ? Math.max(0, now - p.timestamp) : 999999;
    const spreadPct = !p || ask <= 0 ? 999 : ((ask - bid) / ask) * 100;
    const filters = this.getSymbolFilters(symbol);

    const result = evaluateMarketDataQuality({
      price, priceAgeMs, bidPrice: bid, askPrice: ask, bookAgeMs, spreadPct,
      volumeRel: 1, ticker24hAvailable: false, klineAvailable: false,
      exchangeInfoAvailable: this.exchangeInfo !== null, filters,
    });

    const current = {
      symbol,
      price,
      bid,
      ask,
      priceTimestamp: p?.timestamp ?? null,
      bookTimestamp: p?.timestamp ?? null,
      priceAgeMs,
      bookAgeMs,
      priceValid: Number.isFinite(price) && price > 0,
      bookValid: Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0 && ask >= bid,
      quality: result.quality,
      priceFresh: result.priceFresh,
      bookFresh: result.bookFresh,
      spreadOk: result.spreadOk,
      filtersOk: result.filtersOk,
      source: 'MarketDataFeed.shared_bookTicker_cache' as const,
      currentFreshnessBlocker: !result.priceFresh && !result.bookFresh
        ? 'PRICE_NOT_FRESH / BOOK_STALE' as const
        : !result.priceFresh
          ? 'PRICE_NOT_FRESH' as const
          : !result.bookFresh
            ? 'BOOK_STALE' as const
            : null,
    };
    logger.throttled('INFO', `BOOK_TICKER_FRESHNESS_THRESHOLD_AUDIT: symbol=${symbol} priceAgeMs=${priceAgeMs} bookAgeMs=${bookAgeMs} stalePriceMs=${getStalePriceAgeMs()} staleBookMs=${getStaleBookAgeMs()} sameTimestamp=${priceAgeMs === bookAgeMs ? 'true' : 'false'} priceFresh=${String(result.priceFresh)} bookFresh=${String(result.bookFresh)} blockBookStale=${String(!result.bookFresh)}`, `book_freshness_${symbol}`, 30000);
    return current;
  }

  destroy() {
    for (const [, id] of this.intervals) clearInterval(id);
    this.intervals.clear();
    this.listeners.clear();
    this.prices.clear();
    this.symbolFiltersCache.clear();
    this.exchangeInfo = null;
    this.exchangeInfoFetchedAt = 0;
  }
}
