import type { ScannerCandidate } from '../types';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { buildScannerUniverseFromCachedBulkData } from './ScannerUniverseCacheBuilder';

export type MarketDataCacheStatus = 'fresh' | 'stale' | 'missing';

const DEFAULT_TTL_MS = 30000;

function statusFromTimestamp(timestamp: number, ttlMs = DEFAULT_TTL_MS): MarketDataCacheStatus {
  if (!timestamp) return 'missing';
  return Date.now() - timestamp <= ttlMs ? 'fresh' : 'stale';
}

export class MarketDataCache {
  private static instance: MarketDataCache | null = null;
  private exchangeInfo: Record<string, unknown> | null = null;
  private exchangeInfoAt = 0;
  private ticker24hr = new Map<string, Record<string, unknown>>();
  private ticker24hrAt = 0;
  private bookTickers = new Map<string, Record<string, string>>();
  private bookTickersAt = 0;
  private scannerUniverse: ScannerCandidate[] = [];
  private scannerUniverseAt = 0;

  static getInstance(): MarketDataCache {
    if (!MarketDataCache.instance) MarketDataCache.instance = new MarketDataCache();
    return MarketDataCache.instance;
  }

  setExchangeInfo(exchangeInfo: Record<string, unknown>, timestamp = Date.now()): void {
    this.exchangeInfo = exchangeInfo;
    this.exchangeInfoAt = timestamp;
  }

  setTicker24hr(rows: Array<Record<string, unknown>>, timestamp = Date.now()): void {
    this.ticker24hr.clear();
    for (const row of rows) {
      const symbol = String(row.symbol ?? '').toUpperCase();
      if (symbol) this.ticker24hr.set(symbol, row);
    }
    this.ticker24hrAt = timestamp;
  }

  setBookTickers(rows: Array<Record<string, string>>, timestamp = Date.now()): void {
    this.bookTickers.clear();
    for (const row of rows) {
      const symbol = String(row.symbol ?? '').toUpperCase();
      if (symbol) this.bookTickers.set(symbol, row);
    }
    this.bookTickersAt = timestamp;
    MarketDataFeed.getInstance().setBulkBookTickers(rows, timestamp);
  }

  rebuildScannerUniverseFromBulkData(timestamp = Date.now()): { count: number; failureReason: string } {
    const built = buildScannerUniverseFromCachedBulkData({
      exchangeInfo: this.exchangeInfo,
      tickers: [...this.ticker24hr.values()],
      bookTickers: [...this.bookTickers.values()],
      timestamp,
    });
    if (built.candidates.length === 0) return { count: 0, failureReason: built.failureReason };
    this.setScannerUniverse(built.candidates, timestamp);
    return { count: built.candidates.length, failureReason: 'none' };
  }

  setScannerUniverse(candidates: ScannerCandidate[], timestamp = Date.now()): void {
    this.scannerUniverse = [...candidates];
    this.scannerUniverseAt = timestamp;
  }

  getTicker24hr(symbol: string): Record<string, unknown> | null {
    return this.ticker24hr.get(symbol.toUpperCase()) ?? null;
  }

  getBookTicker(symbol: string): Record<string, string> | null {
    return this.bookTickers.get(symbol.toUpperCase()) ?? null;
  }

  getScannerUniverse(): ScannerCandidate[] {
    return [...this.scannerUniverse];
  }

  getStatus(): {
    exchangeInfoStatus: MarketDataCacheStatus;
    ticker24hrStatus: MarketDataCacheStatus;
    bookTickerStatus: MarketDataCacheStatus;
    scannerUniverseStatus: MarketDataCacheStatus;
    ticker24hrCount: number;
    bookTickerCount: number;
    scannerUniverseCount: number;
    lastBulkRefreshAt: number;
    lastBulkBookTickerSuccessAt: number;
    lastTicker24hrSuccessAt: number;
    lastPriceCacheUpdateAt: number;
    lastScannerCandidateBuildAt: number;
    lastRetrospectiveHydrationAt: number;
    bookTickerCacheAgeMs: number;
    ticker24hrCacheAgeMs: number;
    priceCacheAgeMs: number;
    scannerUniverseAgeMs: number;
    retrospectiveCacheAgeMs: number;
    thresholdMs: number;
  } {
    const now = Date.now();
    const priceCacheAt = Math.max(this.ticker24hrAt, this.bookTickersAt);
    const age = (timestamp: number): number => timestamp > 0 ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
    return {
      exchangeInfoStatus: statusFromTimestamp(this.exchangeInfoAt, 300000),
      ticker24hrStatus: this.ticker24hr.size > 0 ? statusFromTimestamp(this.ticker24hrAt) : 'missing',
      bookTickerStatus: this.bookTickers.size > 0 ? statusFromTimestamp(this.bookTickersAt) : 'missing',
      scannerUniverseStatus: this.scannerUniverse.length > 0 ? statusFromTimestamp(this.scannerUniverseAt) : 'missing',
      ticker24hrCount: this.ticker24hr.size,
      bookTickerCount: this.bookTickers.size,
      scannerUniverseCount: this.scannerUniverse.length,
      lastBulkRefreshAt: Math.max(this.exchangeInfoAt, this.ticker24hrAt, this.bookTickersAt, this.scannerUniverseAt),
      lastBulkBookTickerSuccessAt: this.bookTickersAt,
      lastTicker24hrSuccessAt: this.ticker24hrAt,
      lastPriceCacheUpdateAt: priceCacheAt,
      lastScannerCandidateBuildAt: this.scannerUniverseAt,
      lastRetrospectiveHydrationAt: this.scannerUniverseAt,
      bookTickerCacheAgeMs: age(this.bookTickersAt),
      ticker24hrCacheAgeMs: age(this.ticker24hrAt),
      priceCacheAgeMs: age(priceCacheAt),
      scannerUniverseAgeMs: age(this.scannerUniverseAt),
      retrospectiveCacheAgeMs: age(this.scannerUniverseAt),
      thresholdMs: DEFAULT_TTL_MS,
    };
  }

  clear(): void {
    this.exchangeInfo = null;
    this.exchangeInfoAt = 0;
    this.ticker24hr.clear();
    this.ticker24hrAt = 0;
    this.bookTickers.clear();
    this.bookTickersAt = 0;
    this.scannerUniverse = [];
    this.scannerUniverseAt = 0;
  }
}

export function getMarketDataCache(): MarketDataCache {
  return MarketDataCache.getInstance();
}
