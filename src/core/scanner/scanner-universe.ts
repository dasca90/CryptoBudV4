import type { UniverseMode } from '../types';
import { BinancePublicClient } from '../market-data/BinancePublicClient';
import { filterScannerUniverse, type FilteredUniverseResult, type ScannerBanFilterOptions } from './scanner-ban-filter';

const TOP_20_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
  'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'SHIBUSDT', 'LTCUSDT', 'ATOMUSDT',
  'ETCUSDT', 'XLMUSDT', 'FILUSDT', 'TRXUSDT', 'NEARUSDT',
];

const TOP_50_SYMBOLS = [
  ...TOP_20_SYMBOLS,
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'INJUSDT',
  'AAVEUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'RUNEUSDT', 'FTMUSDT',
  'ALGOUSDT', 'EGLDUSDT', 'THETAUSDT', 'SANDUSDT', 'MANAUSDT',
  'AXSUSDT', 'CRVUSDT', 'GRTUSDT', 'CHZUSDT', 'ENJUSDT',
  'BATUSDT', 'ZILUSDT', 'IOSTUSDT', 'HOTUSDT', 'ONEUSDT',
  'ANKRUSDT', 'CELOUSDT', 'SKLUSDT', 'RAYUSDT', 'MINAUSDT',
];

const HIGH_RISK_SYMBOLS = [
  'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT',
  'WIFUSDT', 'ORDIUSDT', 'SATSUSDT', 'PEOPLEUSDT', 'BABYDOGEUSDT',
];

const VERY_HIGH_RISK_SYMBOLS = [
  'MEMEUSDT', 'MYROUSDT', 'TURBOUSDT', 'COQUSDT', 'SHIDO',
  'BENDOGUSDT', 'RFDUSDT', 'BOBOUSDT', 'WOLFUSDT', 'PONKEUSDT',
];

export interface UniverseBuildResult {
  symbols: string[];
  beforeFilterCount: number;
  afterFilterCount: number;
  bannedCount: number;
  topBanReasons: Array<{ reason: string; count: number }>;
  reasonCounts: FilteredUniverseResult['reasonCounts'];
  excludedByGroupCount?: number;
  excludedByGroupBreakdown?: Record<string, number>;
}

const EMPTY_REASON_COUNTS: FilteredUniverseResult['reasonCounts'] = {
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

export function getUniverseSymbols(mode: UniverseMode, watchlist: string[]): string[] {
  switch (mode) {
    case 'WATCHLIST':
      return watchlist;
    case 'TOP_20':
      return TOP_20_SYMBOLS;
    case 'TOP_50':
      return TOP_50_SYMBOLS;
    case 'HIGH_RISK':
      return HIGH_RISK_SYMBOLS;
    case 'VERY_HIGH_RISK':
      return VERY_HIGH_RISK_SYMBOLS;
    case 'CUSTOM':
      return watchlist;
    case 'BINANCE_TOP_250':
      return [];
  }
}

export async function buildScannerUniverse(
  mode: UniverseMode,
  watchlist: string[],
  options?: ScannerBanFilterOptions & {
    enabledRiskGroups?: {
      top_caps: boolean;
      large_caps: boolean;
      mid_caps: boolean;
      high_risk: boolean;
      very_high_risk: boolean;
    };
  },
): Promise<UniverseBuildResult> {
  const enabledGroups = options?.enabledRiskGroups ?? {
    top_caps: true,
    large_caps: true,
    mid_caps: true,
    high_risk: true,
    very_high_risk: true,
  };
  const includeGroup = (group: string | null): boolean => {
    if (group === 'top_caps') return enabledGroups.top_caps;
    if (group === 'large_caps') return enabledGroups.large_caps;
    if (group === 'mid_caps') return enabledGroups.mid_caps;
    if (group === 'high_risk') return enabledGroups.high_risk;
    if (group === 'very_high_risk') return enabledGroups.very_high_risk;
    return true;
  };
  const groupBreakdown: Record<string, number> = {
    top_caps: 0,
    large_caps: 0,
    mid_caps: 0,
    high_risk: 0,
    very_high_risk: 0,
  };
  if (mode !== 'BINANCE_TOP_250') {
    const symbols = getUniverseSymbols(mode, watchlist).filter((symbol) => /^[A-Z0-9]+USDT$/.test(symbol));
    const filteredSymbols = symbols.filter((symbol) => {
      const group = getRiskGroup(symbol);
      const allowed = includeGroup(group);
      if (!allowed && group) groupBreakdown[group] = (groupBreakdown[group] ?? 0) + 1;
      return allowed;
    });
    const excludedByGroupCount = symbols.length - filteredSymbols.length;
    return {
      symbols: filteredSymbols,
      beforeFilterCount: symbols.length,
      afterFilterCount: filteredSymbols.length,
      bannedCount: excludedByGroupCount,
      topBanReasons: [],
      reasonCounts: { ...EMPTY_REASON_COUNTS },
      excludedByGroupCount,
      excludedByGroupBreakdown: groupBreakdown,
    };
  }

  const client = new BinancePublicClient();
  const exchangeInfo = await client.getExchangeInfo();
  const tickers = await client.get24hTickers();

  const usdtTickers = tickers
    .filter(t => typeof t.symbol === 'string' && (t.symbol as string).endsWith('USDT'))
    .sort((a, b) => Number(b.quoteVolume ?? 0) - Number(a.quoteVolume ?? 0));

  const sortedSymbols = usdtTickers.map(t => String(t.symbol));
  const filtered = filterScannerUniverse(sortedSymbols, exchangeInfo, tickers, options);

  const validSymbols = filtered.symbols.filter((symbol) => /^[A-Z0-9]+USDT$/.test(symbol));
  const groupFilteredSymbols = validSymbols.filter((symbol) => {
    const group = getRiskGroup(symbol);
    const allowed = includeGroup(group);
    if (!allowed && group) groupBreakdown[group] = (groupBreakdown[group] ?? 0) + 1;
    return allowed;
  });
  const excludedByGroupCount = validSymbols.length - groupFilteredSymbols.length;
  return {
    symbols: groupFilteredSymbols.slice(0, 250),
    beforeFilterCount: filtered.beforeCount,
    afterFilterCount: groupFilteredSymbols.length,
    bannedCount: filtered.bannedCount + excludedByGroupCount,
    topBanReasons: filtered.topBanReasons,
    reasonCounts: filtered.reasonCounts,
    excludedByGroupCount,
    excludedByGroupBreakdown: groupBreakdown,
  };
}

export function getRiskGroup(symbol: string): string | null {
  if (VERY_HIGH_RISK_SYMBOLS.includes(symbol)) return 'very_high_risk';
  if (HIGH_RISK_SYMBOLS.includes(symbol)) return 'high_risk';
  if (TOP_20_SYMBOLS.includes(symbol)) return 'top_caps';
  if (TOP_50_SYMBOLS.includes(symbol)) return 'large_caps';
  return 'mid_caps';
}

export function isVeryHighRisk(symbol: string): boolean {
  return VERY_HIGH_RISK_SYMBOLS.includes(symbol);
}
