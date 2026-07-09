import type { MarketPrice, SymbolFilters, MarketDataQualityLevel } from '../core/types';
import { parseSymbolFilters, isSymbolTradable } from '../core/market-data/symbol-filters';
import { evaluateMarketDataQuality, getStalePriceAgeMs, getStaleBookAgeMs } from '../core/market-data/market-data-quality';
import { logger } from './logger';
import {
  BinancePublicClient,
  getBinancePublicCircuitSnapshot,
  markBinanceBulkTickerCacheFresh,
  markBinanceExchangeInfoLoaded,
} from '../core/market-data/BinancePublicClient';

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
  private singleSymbolFallbacks: Map<string, Promise<MarketPrice>> = new Map();
  private singleSymbolFallbackBlockedUntil = 0;

  static getInstance(): MarketDataFeed {
    if (!MarketDataFeed.instance) {
      MarketDataFeed.instance = new MarketDataFeed();
    }
    return MarketDataFeed.instance;
  }

  private constructor() {}

  async getPrice(coin: string): Promise<MarketPrice> {
    const cached = this.prices.get(coin);
    if (cached && Date.now() - cached.timestamp < 30000) return cached;

    const price = await this.fetchPrice(coin);
    this.prices.set(coin, price);
    return price;
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

  getBookTickerCacheStatus(): 'fresh' | 'stale' | 'missing' {
    let newest = 0;
    for (const price of this.prices.values()) {
      if (price.bid > 0 && price.ask > 0) newest = Math.max(newest, price.timestamp);
    }
    if (newest <= 0) return 'missing';
    return Date.now() - newest <= 30000 ? 'fresh' : 'stale';
  }

  getSpreadPct(coin: string): number {
    const p = this.prices.get(coin);
    if (!p || p.ask <= 0) return 999;
    return ((p.ask - p.bid) / p.ask) * 100;
  }

  private async fetchPrice(coin: string): Promise<MarketPrice> {
    const circuit = getBinancePublicCircuitSnapshot();
    const cached = this.prices.get(coin);
    if (cached && cached.bid > 0 && cached.ask > 0) {
      if (Date.now() - cached.timestamp < 30000) return cached;
    }

    const cacheStatus = this.getBookTickerCacheStatus();
    markBinanceBulkTickerCacheFresh(cacheStatus === 'fresh');
    const budgetBlocked = circuit.budgetExhausted || circuit.circuitBreakerState === 'RATE_LIMITED';
    const hardBlocked = circuit.circuitBreakerState === 'OPEN' || circuit.circuitBreakerState === 'HALF_OPEN' || !circuit.exchangeInfoLoaded || budgetBlocked;
    if (hardBlocked) {
      const finalState = budgetBlocked
        ? 'skipped_request_budget_exceeded'
        : circuit.circuitBreakerState === 'CLOSED'
          ? 'skipped_exchange_info_missing'
          : 'skipped_public_api_offline';
      const failureReason = budgetBlocked
        ? 'REQUEST_BUDGET_EXCEEDED'
        : circuit.circuitBreakerState === 'CLOSED'
          ? 'EXCHANGE_INFO_MISSING'
          : 'PUBLIC_API_OFFLINE';
      logger.throttled('WARN', `BINANCE_PUBLIC_REQUEST_FANOUT_BLOCKED_AUDIT: endpoint=/api/v3/ticker/bookTicker?symbol=${coin} baseUrl=none attempted=false finalState=${finalState} success=false statusCode=n/a errorName=CircuitBreakerOpen errorMessage=${finalState} durationMs=0 timeoutMs=0 circuitBreakerState=${circuit.circuitBreakerState} retryActive=${String(circuit.retryActive)} nextRetryInMs=${circuit.nextRetryInMs} publicApiOnline=${String(circuit.exchangeInfoLoaded && circuit.circuitBreakerState !== 'OPEN')} exchangeInfoLoaded=${String(circuit.exchangeInfoLoaded)} requestFanoutBlocked=true inflightDeduped=false requestBudgetRemaining=${circuit.requestBudgetRemaining} requestBudgetMax=${circuit.requestBudgetMax} budgetResetAt=${circuit.budgetResetAt} budgetExhausted=${String(circuit.budgetExhausted)} budgetExhaustedReason=${circuit.budgetExhaustedReason ?? 'none'} bulkTickerCacheFresh=${String(circuit.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(circuit.singleSymbolFallbackAllowed)} invariantOk=true failureReason=${failureReason}`, 'book_ticker_fanout_blocked_global', 30000);
      if (cached && cached.last > 0) return cached;
      return { coin, bid: 0, ask: 0, last: 0, timestamp: Date.now() };
    }

    if (!circuit.singleSymbolFallbackAllowed || Date.now() < this.singleSymbolFallbackBlockedUntil) {
      if (cached && cached.last > 0) return cached;
      return { coin, bid: 0, ask: 0, last: 0, timestamp: Date.now() };
    }

    const existing = this.singleSymbolFallbacks.get(coin);
    if (existing) return existing;

    const task = this.fetchSingleSymbolFallback(coin);
    this.singleSymbolFallbacks.set(coin, task);
    try {
      return await task;
    } finally {
      this.singleSymbolFallbacks.delete(coin);
    }
  }

  private async fetchSingleSymbolFallback(coin: string): Promise<MarketPrice> {
    this.singleSymbolFallbackBlockedUntil = Date.now() + 10000;
    try {
      const symbol = coin.replace('USDT', '') + 'USDT';
      const data = await new BinancePublicClient().getBookTicker(symbol);
      const bid = parseFloat(data.bidPrice);
      const ask = parseFloat(data.askPrice);
      const price = {
        coin,
        bid,
        ask,
        last: (bid + ask) / 2,
        timestamp: Date.now(),
      };
      this.prices.set(coin, price);
      return price;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.throttled('WARN', `BINANCE_PUBLIC_BOOK_TICKER_PROBE_AUDIT: endpoint=/api/v3/ticker/bookTicker?symbol=${coin} baseUrl=auto attempted=true success=false errorName=${err instanceof Error ? err.name : 'Error'} errorMessage=${message.replace(/\s+/g, '_')} publicApiOnline=true invariantOk=true failureReason=${message.replace(/\s+/g, '_')}`, 'book_ticker_single_symbol_fallback_failed', 30000);
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
          this.prices.set(coin, price);
          for (const cb of this.listeners.get(coin) || []) {
            cb(price);
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

  setManualBookTicker(coin: string, bid: number, ask: number, timestamp = Date.now()) {
    const last = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    this.prices.set(coin, { coin, bid, ask, last, timestamp });
    markBinanceBulkTickerCacheFresh(this.getBookTickerCacheStatus() === 'fresh');
  }

  setBulkBookTickers(rows: Array<Record<string, string>>, timestamp = Date.now()) {
    for (const row of rows) {
      const symbol = String(row.symbol ?? '');
      const bid = Number(row.bidPrice);
      const ask = Number(row.askPrice);
      if (symbol && bid > 0 && ask > 0) {
        this.setManualBookTicker(symbol, bid, ask, timestamp);
      }
    }
    markBinanceBulkTickerCacheFresh(this.getBookTickerCacheStatus() === 'fresh');
  }

  setSymbolFilters(symbol: string, filters: import('../core/types').SymbolFilters) {
    this.symbolFiltersCache.set(symbol, filters);
  }

  setExchangeInfo(exchangeInfo: Record<string, unknown>, fetchedAt = Date.now()) {
    this.exchangeInfo = exchangeInfo;
    this.exchangeInfoFetchedAt = fetchedAt;
    markBinanceExchangeInfoLoaded(Array.isArray(exchangeInfo.symbols));
    this.symbolFiltersCache.clear();
    const symbols = Array.isArray(exchangeInfo.symbols)
      ? exchangeInfo.symbols as Record<string, unknown>[]
      : [];
    for (const sym of symbols) {
      const symbolName = sym.symbol as string;
      const filters = parseSymbolFilters(symbolName, exchangeInfo);
      if (filters) this.symbolFiltersCache.set(symbolName, filters);
    }
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
      const client = new BinancePublicClient();
      const exchangeInfo = await client.getExchangeInfo();
      this.setExchangeInfo(exchangeInfo);
      const symbols = Array.isArray(this.exchangeInfo?.symbols)
        ? this.exchangeInfo.symbols as Record<string, unknown>[]
        : [];
      if (symbols.length === 0) {
        logger.warn('EXCHANGE_INFO_SYMBOLS_UNAVAILABLE: exchangeInfo response missing symbols array; symbol filters remain cached/empty');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`BINANCE_EXCHANGE_INFO_BOOTSTRAP_AUDIT: endpoint=/api/v3/exchangeInfo baseUrl=auto attempted=true success=false errorName=${err instanceof Error ? err.name : 'Error'} errorMessage=${message.replace(/\s+/g, '_')} publicApiOnline=false exchangeInfoLoaded=false invariantOk=true failureReason=${message.replace(/\s+/g, '_')}`);
      throw err;
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
    const p = this.prices.get(symbol);
    const price = p?.last ?? 0;
    const bid = p?.bid ?? 0;
    const ask = p?.ask ?? 0;
    const priceAgeMs = this.getPriceAgeMs(symbol);
    const bookAgeMs = this.getBookAgeMs(symbol);
    const spreadPct = this.getSpreadPct(symbol);
    const filters = this.getSymbolFilters(symbol);

    const result = evaluateMarketDataQuality({
      price, priceAgeMs, bidPrice: bid, askPrice: ask, bookAgeMs, spreadPct,
      volumeRel: 1, ticker24hAvailable: false, klineAvailable: false,
      exchangeInfoAvailable: this.exchangeInfo !== null, filters,
    });

    logger.throttled('INFO', `BOOK_TICKER_FRESHNESS_THRESHOLD_AUDIT: symbol=${symbol} priceAgeMs=${priceAgeMs} bookAgeMs=${bookAgeMs} stalePriceMs=${getStalePriceAgeMs()} staleBookMs=${getStaleBookAgeMs()} sameTimestamp=${priceAgeMs === bookAgeMs ? 'true' : 'false'} priceFresh=${String(result.priceFresh)} bookFresh=${String(result.bookFresh)} blockBookStale=${String(!result.bookFresh)}`, `book_freshness_${symbol}`, 30000);

    return {
      quality: result.quality,
      priceFresh: result.priceFresh,
      bookFresh: result.bookFresh,
      spreadOk: result.spreadOk,
      filtersOk: result.filtersOk,
    };
  }

  destroy() {
    for (const [, id] of this.intervals) clearInterval(id);
    this.intervals.clear();
    this.listeners.clear();
    this.prices.clear();
    this.symbolFiltersCache.clear();
    this.exchangeInfo = null;
    this.exchangeInfoFetchedAt = 0;
    markBinanceExchangeInfoLoaded(false);
    markBinanceBulkTickerCacheFresh(false);
  }
}
