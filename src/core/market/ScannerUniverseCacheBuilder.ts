import type { ScannerCandidate } from '../types';
import { filterScannerUniverse } from '../scanner/scanner-ban-filter';

interface BuildScannerUniverseFromCachedBulkDataInput {
  exchangeInfo: Record<string, unknown> | null;
  tickers: Array<Record<string, unknown>>;
  bookTickers: Array<Record<string, string>>;
  timestamp: number;
  limit?: number;
}

export function buildScannerUniverseFromCachedBulkData(input: BuildScannerUniverseFromCachedBulkDataInput): {
  candidates: ScannerCandidate[];
  beforeFilterCount: number;
  afterFilterCount: number;
  failureReason: string;
} {
  if (!input.exchangeInfo || !Array.isArray(input.exchangeInfo.symbols)) {
    return { candidates: [], beforeFilterCount: 0, afterFilterCount: 0, failureReason: 'EXCHANGE_INFO_MISSING' };
  }
  if (input.tickers.length === 0) {
    return { candidates: [], beforeFilterCount: 0, afterFilterCount: 0, failureReason: 'TICKER24HR_CACHE_MISSING' };
  }
  if (input.bookTickers.length === 0) {
    return { candidates: [], beforeFilterCount: 0, afterFilterCount: 0, failureReason: 'BOOK_TICKER_CACHE_MISSING' };
  }

  const bookBySymbol = new Map(input.bookTickers.map((row) => [String(row.symbol ?? '').toUpperCase(), row]));
  const sortedTickers = input.tickers
    .filter((row) => String(row.symbol ?? '').toUpperCase().endsWith('USDT'))
    .sort((a, b) => Number(b.quoteVolume ?? 0) - Number(a.quoteVolume ?? 0));
  const sortedSymbols = sortedTickers.map((row) => String(row.symbol ?? '').toUpperCase());
  const filtered = filterScannerUniverse(sortedSymbols, input.exchangeInfo, input.tickers);
  const tickerBySymbol = new Map(input.tickers.map((row) => [String(row.symbol ?? '').toUpperCase(), row]));
  const candidates: ScannerCandidate[] = [];
  const nowIso = new Date(input.timestamp).toISOString();
  const limit = input.limit ?? 250;

  for (const symbol of filtered.symbols) {
    const ticker = tickerBySymbol.get(symbol);
    const book = bookBySymbol.get(symbol);
    const bid = Number(book?.bidPrice ?? 0);
    const ask = Number(book?.askPrice ?? 0);
    const last = Number(ticker?.lastPrice ?? ticker?.weightedAvgPrice ?? 0) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0);
    if (!ticker || bid <= 0 || ask <= 0 || last <= 0) continue;
    candidates.push({
      candidateId: `bootstrap_${symbol}`,
      symbol,
      createdAt: nowIso,
      updatedAt: nowIso,
      mode: 'AUTO',
      riskGroup: getBootstrapRiskGroup(symbol),
      selectedStrategy: 'watch',
      selectedPlaybook: null,
      confidence: 0,
      status: 'WAIT',
      traderBrainDecision: {
        symbol,
        mode: 'AUTO',
        selectedStrategy: 'watch',
        selectedPlaybook: 'wait',
        confidence: 0,
        status: 'WAITING',
        entryPlan: null,
        exitPlan: null,
        reasons: ['bulk_market_data_bootstrap'],
        blockReasons: [],
        warnings: ['BOOTSTRAP_UNIVERSE_ONLY'],
        requiredNextActions: ['WAIT_FOR_SCANNER_ANALYSIS'],
        ruleDecisionTrace: {
          unifiedSignal: null,
          playbookResult: null,
          autobotsResult: null,
        },
      },
      entryGateDecision: null,
      mainReason: 'bulk_market_data_bootstrap',
      requiredNextActions: ['WAIT_FOR_SCANNER_ANALYSIS'],
      blockReasons: [],
      warnings: ['BOOTSTRAP_UNIVERSE_ONLY'],
      price: last,
      priceAgeMs: 0,
      spreadPct: ((ask - bid) / ask) * 100,
      volumeRel: 1,
      tpRoomOk: false,
      reboundConfirmed: false,
      momentumConfirmed: false,
      dipPercent: 0,
      reboundPercent: 0,
      reboundFreshnessStatus: 'unknown',
      m5Change: 0,
      m15Change: 0,
      h1Change: 0,
      change24h: Number(ticker?.priceChangePercent ?? 0),
      mlBadEntryRisk: false,
      mlWinProbability: 0,
      dataQuality: 'PARTIAL',
      priceFresh: true,
      bookFresh: true,
      filtersOk: true,
      isTradable: true,
      finalExecutable: false,
      buyAllowed: false,
      finalNoBuyReason: 'BOOTSTRAP_UNIVERSE_ONLY',
      candidateBirthSource: 'public_market_data_bootstrap',
      candidateStatusSource: 'public_market_data_bootstrap',
      lastTransformSource: 'public_market_data_bootstrap',
    } as ScannerCandidate);
    if (candidates.length >= limit) break;
  }

  return {
    candidates,
    beforeFilterCount: filtered.beforeCount,
    afterFilterCount: candidates.length,
    failureReason: candidates.length > 0 ? 'none' : 'NO_BOOTSTRAP_SCANNER_UNIVERSE_CANDIDATES',
  };
}

function getBootstrapRiskGroup(symbol: string): string {
  if (BOOTSTRAP_TOP_CAPS.has(symbol)) return 'top_caps';
  if (BOOTSTRAP_LARGE_CAPS.has(symbol)) return 'large_caps';
  if (BOOTSTRAP_HIGH_RISK.has(symbol)) return 'high_risk';
  return 'mid_caps';
}

const BOOTSTRAP_TOP_CAPS = new Set([
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
  'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'SHIBUSDT', 'LTCUSDT', 'ATOMUSDT',
  'ETCUSDT', 'XLMUSDT', 'FILUSDT', 'TRXUSDT', 'NEARUSDT',
]);

const BOOTSTRAP_LARGE_CAPS = new Set([
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'INJUSDT',
  'AAVEUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'RUNEUSDT', 'FTMUSDT',
  'ALGOUSDT', 'EGLDUSDT', 'THETAUSDT', 'SANDUSDT', 'MANAUSDT',
  'AXSUSDT', 'CRVUSDT', 'GRTUSDT', 'CHZUSDT', 'ENJUSDT',
  'BATUSDT', 'ZILUSDT', 'IOSTUSDT', 'HOTUSDT', 'ONEUSDT',
  'ANKRUSDT', 'CELOUSDT', 'SKLUSDT', 'RAYUSDT', 'MINAUSDT',
]);

const BOOTSTRAP_HIGH_RISK = new Set([
  'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT',
  'WIFUSDT', 'ORDIUSDT', 'SATSUSDT', 'PEOPLEUSDT', 'BABYDOGEUSDT',
]);
