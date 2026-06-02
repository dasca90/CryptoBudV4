import type { SymbolFilters } from '../types';
import { parseSymbolFilters } from '../market-data/symbol-filters';
import { isSymbolBannedForTrading } from '../trading/banned-symbols';

export type ScannerBanReason =
  | 'STABLECOIN_PAIR'
  | 'FIAT_PAIR'
  | 'METAL_PAIR'
  | 'WRAPPED_BTC_PAIR'
  | 'WRAPPED_ETH_PAIR'
  | 'SYNTHETIC_OR_PEGGED_ASSET'
  | 'NON_USDT_QUOTE'
  | 'NOT_SPOT_TRADABLE'
  | 'SYMBOL_STATUS_NOT_TRADING'
  | 'MISSING_SYMBOL_FILTERS'
  | 'MANUAL_BANLIST'
  | 'INVALID_SYMBOL_FORMAT';

export interface ScannerBanResult {
  banned: boolean;
  reason: ScannerBanReason | null;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  warnings: string[];
}

export interface ScannerBanFilterOptions {
  manualScannerBanlist?: string[];
}

export interface FilteredUniverseResult {
  symbols: string[];
  beforeCount: number;
  afterCount: number;
  bannedCount: number;
  banned: ScannerBanResult[];
  topBanReasons: Array<{ reason: string; count: number }>;
  reasonCounts: Record<ScannerBanReason, number>;
}

const STABLECOIN_ASSETS = new Set([
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDD', 'USD1', 'USDE',
  'PYUSD', 'USTC', 'USDS', 'EURC', 'AEUR', 'RLUSD', 'XUSD',
  'GUSD', 'LUSD', 'FRAX', 'SUSD', 'USN', 'USDJ', 'USDX', 'USDY',
]);

const FIAT_ASSETS = new Set([
  'USD', 'EUR', 'GBP', 'TRY', 'BRL', 'AUD', 'PLN', 'RON', 'NGN', 'ZAR', 'RUB', 'UAH', 'JPY', 'CHF',
]);

const METAL_ASSETS = new Set(['PAXG', 'XAUT', 'GOLD', 'SILVER', 'XAG', 'XAU']);

const WRAPPED_BTC_ASSETS = new Set(['WBTC', 'BTCB', 'BBTC', 'RENBTC', 'TBTC', 'SBTC']);
const WRAPPED_ETH_ASSETS = new Set(['WETH', 'STETH', 'WBETH', 'WSTETH', 'RETH', 'CBETH', 'BETH']);

function normalize(s: string): string {
  return s.toUpperCase().trim();
}

export function isScannerBannedSymbol(
  symbol: string,
  filters: SymbolFilters | null,
  options?: ScannerBanFilterOptions,
): ScannerBanResult {
  const manualSet = new Set((options?.manualScannerBanlist ?? []).map(normalize));
  const sym = normalize(symbol);
  const baseAsset = normalize(filters?.baseAsset ?? '');
  const quoteAsset = normalize(filters?.quoteAsset ?? '');
  const warnings: string[] = [];

  if (manualSet.has(sym) || (baseAsset && manualSet.has(baseAsset))) {
    return { banned: true, reason: 'MANUAL_BANLIST', symbol: sym, baseAsset, quoteAsset, warnings };
  }
  const banned = isSymbolBannedForTrading(sym, baseAsset, quoteAsset, [...manualSet]);
  if (banned.banned) {
    return { banned: true, reason: 'MANUAL_BANLIST', symbol: sym, baseAsset, quoteAsset, warnings: [...warnings, banned.reason] };
  }

  if (!filters) {
    return { banned: true, reason: 'MISSING_SYMBOL_FILTERS', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (quoteAsset !== 'USDT') {
    return { banned: true, reason: 'NON_USDT_QUOTE', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (filters.status !== 'TRADING') {
    return { banned: true, reason: 'SYMBOL_STATUS_NOT_TRADING', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (!filters.isSpotTradingAllowed) {
    return { banned: true, reason: 'NOT_SPOT_TRADABLE', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (STABLECOIN_ASSETS.has(baseAsset)) {
    return { banned: true, reason: 'STABLECOIN_PAIR', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (FIAT_ASSETS.has(baseAsset)) {
    return { banned: true, reason: 'FIAT_PAIR', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (METAL_ASSETS.has(baseAsset)) {
    return { banned: true, reason: 'METAL_PAIR', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (WRAPPED_BTC_ASSETS.has(baseAsset)) {
    return { banned: true, reason: 'WRAPPED_BTC_PAIR', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (WRAPPED_ETH_ASSETS.has(baseAsset)) {
    return { banned: true, reason: 'WRAPPED_ETH_PAIR', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (sym.includes('UPUSDT') || sym.includes('DOWNUSDT')) {
    return { banned: true, reason: 'SYNTHETIC_OR_PEGGED_ASSET', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  if (baseAsset.startsWith('W') && (WRAPPED_BTC_ASSETS.has(baseAsset) || WRAPPED_ETH_ASSETS.has(baseAsset))) {
    return { banned: true, reason: 'SYNTHETIC_OR_PEGGED_ASSET', symbol: sym, baseAsset, quoteAsset, warnings };
  }

  return { banned: false, reason: null, symbol: sym, baseAsset, quoteAsset, warnings };
}

export function filterScannerUniverse(
  symbols: string[],
  exchangeInfo: Record<string, unknown>,
  _tickers: Record<string, unknown>[],
  options?: ScannerBanFilterOptions,
): FilteredUniverseResult {
  const exchangeSymbols = (exchangeInfo.symbols as Record<string, unknown>[] | undefined) ?? [];
  const bySymbol = new Map(exchangeSymbols.map(s => [String(s.symbol), s]));
  const allowed: string[] = [];
  const banned: ScannerBanResult[] = [];
  const reasonCounts: Record<ScannerBanReason, number> = {
    STABLECOIN_PAIR: 0,
    FIAT_PAIR: 0,
    METAL_PAIR: 0,
    WRAPPED_BTC_PAIR: 0,
    WRAPPED_ETH_PAIR: 0,
    SYNTHETIC_OR_PEGGED_ASSET: 0,
    NON_USDT_QUOTE: 0,
    NOT_SPOT_TRADABLE: 0,
    SYMBOL_STATUS_NOT_TRADING: 0,
    MISSING_SYMBOL_FILTERS: 0,
    MANUAL_BANLIST: 0,
    INVALID_SYMBOL_FORMAT: 0,
  };

  const validFormat = /^[A-Z0-9]+USDT$/;
  for (const symbol of symbols) {
    if (!validFormat.test(symbol)) {
      const verdict: ScannerBanResult = {
        banned: true,
        reason: 'INVALID_SYMBOL_FORMAT',
        symbol: normalize(symbol),
        baseAsset: '',
        quoteAsset: '',
        warnings: [],
      };
      reasonCounts.INVALID_SYMBOL_FORMAT = (reasonCounts.INVALID_SYMBOL_FORMAT ?? 0) + 1;
      banned.push(verdict);
      continue;
    }
    const exchangeSymbol = bySymbol.get(symbol);
    if (exchangeSymbol && (!Array.isArray(exchangeSymbol.filters) || exchangeSymbol.filters.length === 0)) {
      const verdict: ScannerBanResult = {
        banned: true,
        reason: 'MISSING_SYMBOL_FILTERS',
        symbol: normalize(symbol),
        baseAsset: normalize(String(exchangeSymbol.baseAsset ?? '')),
        quoteAsset: normalize(String(exchangeSymbol.quoteAsset ?? '')),
        warnings: [],
      };
      reasonCounts.MISSING_SYMBOL_FILTERS++;
      banned.push(verdict);
      continue;
    }
    const filters = parseSymbolFilters(symbol, exchangeInfo);
    const verdict = isScannerBannedSymbol(symbol, filters, options);
    if (verdict.banned && verdict.reason) {
      reasonCounts[verdict.reason]++;
      banned.push(verdict);
    } else {
      allowed.push(symbol);
    }
  }

  const topBanReasons = Object.entries(reasonCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    symbols: allowed,
    beforeCount: symbols.length,
    afterCount: allowed.length,
    bannedCount: banned.length,
    banned,
    topBanReasons,
    reasonCounts,
  };
}
