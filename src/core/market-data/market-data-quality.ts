import type { MarketDataQuality, MarketDataQualityLevel, SymbolFilters } from '../types';

const STALE_PRICE_MS = 30000;
const STALE_BOOK_MS = 30000;
const MAX_SPREAD_PCT = 1;

export interface MarketDataQualityInput {
  price: number;
  priceAgeMs: number;
  bidPrice: number;
  askPrice: number;
  bookAgeMs: number;
  spreadPct: number;
  volumeRel: number;
  ticker24hAvailable: boolean;
  klineAvailable: boolean;
  exchangeInfoAvailable: boolean;
  filters: SymbolFilters | null;
}

export function evaluateMarketDataQuality(input: MarketDataQualityInput): MarketDataQuality {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const priceFresh = input.price > 0 && input.priceAgeMs < STALE_PRICE_MS;
  const bookFresh = input.bidPrice > 0 && input.askPrice > 0 && input.bookAgeMs < STALE_BOOK_MS;
  const spreadOk = input.spreadPct >= 0 && input.spreadPct <= MAX_SPREAD_PCT;
  const filtersOk = input.exchangeInfoAvailable && input.filters !== null && input.filters.isSpotTradingAllowed;

  // Determine quality level
  let quality: MarketDataQualityLevel;

  const hasNoData = input.price <= 0 && input.bidPrice <= 0 && input.askPrice <= 0;
  const hasInvalidPrice = input.price <= 0 || isNaN(input.price);

  if (hasNoData) {
    quality = 'OFFLINE';
    reasons.push('No market data available');
  } else if (hasInvalidPrice) {
    quality = 'BAD';
    reasons.push('Invalid price data');
  } else if (input.spreadPct < 0 || input.spreadPct > 20) {
    quality = 'BAD';
    reasons.push(`Spread ${input.spreadPct.toFixed(2)}% out of range`);
  } else if (!priceFresh && !bookFresh) {
    quality = 'OFFLINE';
    reasons.push('Price and book both stale');
  } else if (!priceFresh) {
    quality = 'STALE';
    reasons.push(`Price age ${(input.priceAgeMs / 1000).toFixed(0)}s exceeds ${STALE_PRICE_MS / 1000}s`);
  } else if (!bookFresh) {
    quality = 'STALE';
    reasons.push(`Book age ${(input.bookAgeMs / 1000).toFixed(0)}s exceeds ${STALE_BOOK_MS / 1000}s`);
  } else if (!spreadOk) {
    quality = 'PARTIAL';
    reasons.push(`Spread ${input.spreadPct.toFixed(3)}% above ${MAX_SPREAD_PCT}%`);
  } else if (!filtersOk) {
    quality = 'PARTIAL';
    reasons.push('Symbol filters not available or symbol not tradable');
  } else if (!input.ticker24hAvailable || !input.klineAvailable) {
    quality = 'PARTIAL';
    reasons.push('Some market data features unavailable');
    if (!input.ticker24hAvailable) warnings.push('24h ticker not available');
    if (!input.klineAvailable) warnings.push('Kline data not available');
  } else {
    quality = 'GOOD';
    reasons.push('All market data fresh and valid');
  }

  const usableForTrading = quality === 'GOOD' || quality === 'PARTIAL';
  const usableForML = quality !== 'BAD' && quality !== 'OFFLINE';

  return {
    quality,
    reasons,
    warnings,
    priceFresh,
    bookFresh,
    spreadOk,
    filtersOk,
    usableForTrading,
    usableForML,
  };
}

export function getMaxSpreadPct(): number {
  return MAX_SPREAD_PCT;
}

export function getStalePriceAgeMs(): number {
  return STALE_PRICE_MS;
}

export function getStaleBookAgeMs(): number {
  return STALE_BOOK_MS;
}
