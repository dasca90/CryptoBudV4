import { logger } from '../../utils/logger';
import {
  BinancePublicClient,
  forceBinancePublicHalfOpen,
  getBinancePublicCircuitSnapshot,
  type BinanceEndpointFailure,
  type BinancePublicCircuitSnapshot,
} from './BinancePublicClient';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { getMarketDataCache } from '../market/MarketDataCache';

export interface PublicMarketDataStatus {
  publicApiOnline: boolean;
  exchangeInfoLoaded: boolean;
  tickerProbeOk: boolean;
  bookTickerProbeOk: boolean;
  bulkBookTickerOk: boolean;
  ticker24hrCacheStatus: 'fresh' | 'stale' | 'missing';
  bookTickerCacheStatus: 'fresh' | 'stale' | 'missing';
  scannerUniverseCacheStatus: 'fresh' | 'stale' | 'missing';
  requestBudgetStatus: 'OK' | 'EXHAUSTED';
  lastMarketDataUpdate: number;
  lastSuccessfulEndpoint: string | null;
  lastFailureEndpoint: string | null;
  lastFailureBaseUrl: string | null;
  lastFailureReason: string | null;
  lastErrorMessage: string | null;
  baseUrl: string | null;
  openPositionFreshCount: number;
  openPositionStaleCount: number;
  circuitBreakerState: BinancePublicCircuitSnapshot['circuitBreakerState'];
  retryActive: boolean;
  nextRetryAt: number;
  nextRetryInMs: number;
  requestFanoutBlocked: boolean;
  requestStormBlocked: boolean;
  requestBudgetRemaining: number;
  requestBudgetMax: number;
  budgetResetAt: number;
  budgetExhausted: boolean;
  budgetExhaustedReason: string | null;
  bulkTickerCacheFresh: boolean;
  singleSymbolFallbackAllowed: boolean;
}

export interface PublicMarketDataRefreshResult extends PublicMarketDataStatus {
  reason: string;
  requestId: string;
  deduped: boolean;
  cancelledPrevious: boolean;
  bootstrapStep: string;
  exchangeInfoAttempted: boolean;
  tickerProbeAttempted: boolean;
  bookTickerProbeAttempted: boolean;
  bulkBookTickerAttempted: boolean;
  openPositionPriceRefreshAttempted: boolean;
  failures: BinanceEndpointFailure[];
}

const status: PublicMarketDataStatus = {
  publicApiOnline: false,
  exchangeInfoLoaded: false,
  tickerProbeOk: false,
  bookTickerProbeOk: false,
  bulkBookTickerOk: false,
  ticker24hrCacheStatus: 'missing',
  bookTickerCacheStatus: 'missing',
  scannerUniverseCacheStatus: 'missing',
  requestBudgetStatus: 'OK',
  lastMarketDataUpdate: 0,
  lastSuccessfulEndpoint: null,
  lastFailureEndpoint: null,
  lastFailureBaseUrl: null,
  lastFailureReason: null,
  lastErrorMessage: null,
  baseUrl: null,
  openPositionFreshCount: 0,
  openPositionStaleCount: 0,
  circuitBreakerState: 'CLOSED',
  retryActive: false,
  nextRetryAt: 0,
  nextRetryInMs: 0,
  requestFanoutBlocked: false,
  requestStormBlocked: false,
  requestBudgetRemaining: 0,
  requestBudgetMax: 0,
  budgetResetAt: 0,
  budgetExhausted: false,
  budgetExhaustedReason: null,
  bulkTickerCacheFresh: false,
  singleSymbolFallbackAllowed: true,
};

let refreshSeq = 0;
let inFlightRefresh: Promise<PublicMarketDataRefreshResult> | null = null;

export function getPublicMarketDataStatus(): PublicMarketDataStatus {
  syncCircuitStatus();
  return { ...status };
}

function requestId(): string {
  refreshSeq += 1;
  return `public_market_refresh_${Date.now()}_${refreshSeq}`;
}

function normalize(value: string | null | undefined): string {
  return (value ?? 'none').replace(/\s+/g, '_');
}

function syncCircuitStatus(): void {
  const circuit = getBinancePublicCircuitSnapshot();
  const cacheStatus = getMarketDataCache().getStatus();
  status.circuitBreakerState = circuit.circuitBreakerState;
  status.retryActive = circuit.retryActive;
  status.nextRetryAt = circuit.nextRetryAt;
  status.nextRetryInMs = circuit.nextRetryInMs;
  status.requestFanoutBlocked = circuit.requestFanoutBlocked;
  status.requestStormBlocked = circuit.requestFanoutBlocked || circuit.circuitBreakerState === 'OPEN';
  status.requestBudgetRemaining = circuit.requestBudgetRemaining;
  status.requestBudgetMax = circuit.requestBudgetMax;
  status.budgetResetAt = circuit.budgetResetAt;
  status.budgetExhausted = circuit.budgetExhausted;
  status.budgetExhaustedReason = circuit.budgetExhaustedReason;
  status.requestBudgetStatus = circuit.budgetExhausted ? 'EXHAUSTED' : 'OK';
  status.bulkTickerCacheFresh = circuit.bulkTickerCacheFresh;
  status.ticker24hrCacheStatus = cacheStatus.ticker24hrStatus;
  status.bookTickerCacheStatus = cacheStatus.bookTickerStatus === 'missing'
    ? status.bookTickerCacheStatus
    : cacheStatus.bookTickerStatus;
  status.scannerUniverseCacheStatus = cacheStatus.scannerUniverseStatus;
  status.singleSymbolFallbackAllowed = circuit.singleSymbolFallbackAllowed;
  status.lastFailureEndpoint = circuit.lastFailureEndpoint ?? status.lastFailureEndpoint;
  status.lastFailureBaseUrl = circuit.lastFailureBaseUrl ?? status.lastFailureBaseUrl;
  status.lastFailureReason = circuit.lastFailureReason ?? status.lastFailureReason;
  status.lastErrorMessage = circuit.lastErrorMessage ?? status.lastErrorMessage;
  status.baseUrl = circuit.lastSuccessfulBaseUrl ?? status.baseUrl;
  status.lastSuccessfulEndpoint = circuit.lastSuccessfulEndpoint ?? status.lastSuccessfulEndpoint;
}

function applyFailure(failure: BinanceEndpointFailure | null): void {
  if (!failure) {
    syncCircuitStatus();
    return;
  }
  status.lastFailureEndpoint = failure.endpoint;
  status.lastFailureBaseUrl = failure.baseUrl;
  status.lastFailureReason = failure.failureReason || failure.errorMessage || failure.errorName;
  status.lastErrorMessage = failure.errorMessage;
  status.baseUrl = failure.baseUrl;
}

function emitStatusAudit(refreshRequestId: string): void {
  syncCircuitStatus();
  logger.info(`PUBLIC_MARKET_DATA_STATUS_AUDIT: requestId=${refreshRequestId} publicApiOnline=${String(status.publicApiOnline)} exchangeInfoLoaded=${String(status.exchangeInfoLoaded)} bookTickerCacheStatus=${status.bookTickerCacheStatus} lastMarketDataUpdate=${status.lastMarketDataUpdate || 'n/a'} lastSuccessfulEndpoint=${status.lastSuccessfulEndpoint ?? 'none'} lastFailureEndpoint=${status.lastFailureEndpoint ?? 'none'} lastFailureBaseUrl=${status.lastFailureBaseUrl ?? 'none'} lastFailureReason=${normalize(status.lastFailureReason)} lastErrorMessage=${normalize(status.lastErrorMessage)} baseUrl=${status.baseUrl ?? 'none'} circuitBreakerState=${status.circuitBreakerState} retryActive=${String(status.retryActive)} nextRetryInMs=${status.nextRetryInMs} requestStormBlocked=${String(status.requestStormBlocked)} requestFanoutBlocked=${String(status.requestFanoutBlocked)} requestBudgetRemaining=${status.requestBudgetRemaining} requestBudgetMax=${status.requestBudgetMax} budgetResetAt=${status.budgetResetAt} budgetExhausted=${String(status.budgetExhausted)} budgetExhaustedReason=${normalize(status.budgetExhaustedReason)} bulkTickerCacheFresh=${String(status.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(status.singleSymbolFallbackAllowed)} invariantOk=true failureReason=${normalize(status.lastFailureReason)}`);
  logger.info(`BINANCE_PUBLIC_CACHE_STATUS_AUDIT: requestId=${refreshRequestId} publicApiOnline=${String(status.publicApiOnline)} exchangeInfoLoaded=${String(status.exchangeInfoLoaded)} requestBudgetRemaining=${status.requestBudgetRemaining} requestBudgetMax=${status.requestBudgetMax} budgetResetAt=${status.budgetResetAt} budgetExhausted=${String(status.budgetExhausted)} budgetExhaustedReason=${normalize(status.budgetExhaustedReason)} circuitBreakerState=${status.circuitBreakerState} retryActive=${String(status.retryActive)} nextRetryInMs=${status.nextRetryInMs} requestFanoutBlocked=${String(status.requestFanoutBlocked)} bulkTickerCacheFresh=${String(status.bulkTickerCacheFresh)} ticker24hrCacheStatus=${status.ticker24hrCacheStatus} bookTickerCacheStatus=${status.bookTickerCacheStatus} scannerUniverseCacheStatus=${status.scannerUniverseCacheStatus} singleSymbolFallbackAllowed=${String(status.singleSymbolFallbackAllowed)} invariantOk=true failureReason=none`);
}

function countFreshOpenSymbols(openSymbols: string[]): { fresh: number; stale: number } {
  const feed = MarketDataFeed.getInstance();
  let fresh = 0;
  let stale = 0;
  for (const symbol of [...new Set(openSymbols.map((s) => s.toUpperCase()).filter(Boolean))]) {
    const cached = feed.getCachedPrice(symbol);
    if (cached && cached.last > 0 && Date.now() - cached.timestamp <= 30000) fresh++;
    else stale++;
  }
  return { fresh, stale };
}

export async function refreshPublicMarketData(reason: string, openSymbols: string[] = []): Promise<PublicMarketDataRefreshResult> {
  if (inFlightRefresh) {
    const dedupeId = requestId();
    const circuit = getBinancePublicCircuitSnapshot();
    logger.info(`PUBLIC_MARKET_DATA_REFRESH_AUDIT: reason=${reason} requestId=${dedupeId} deduped=true cancelledPrevious=false bootstrapStep=inflight exchangeInfoOk=${String(status.exchangeInfoLoaded)} tickerProbeOk=${String(status.tickerProbeOk)} bookTickerProbeOk=${String(status.bookTickerProbeOk)} bulkBookTickerOk=${String(status.bulkBookTickerOk)} publicApiOnline=${String(status.publicApiOnline)} circuitBreakerState=${circuit.circuitBreakerState} nextRetryInMs=${circuit.nextRetryInMs} failureEndpoint=${status.lastFailureEndpoint ?? 'none'} failureReason=${normalize(status.lastFailureReason)} invariantOk=true`);
    const result = await inFlightRefresh;
    return { ...result, requestId: dedupeId, deduped: true };
  }

  const refreshRequestId = requestId();
  const client = new BinancePublicClient();
  const failures: BinanceEndpointFailure[] = [];
  const uniqueOpenSymbols = [...new Set(openSymbols.map((s) => s.toUpperCase()).filter(Boolean))];
  let bootstrapStep = 'start';
  let exchangeInfoOk = false;
  let tickerProbeOk = false;
  let bookTickerProbeOk = false;
  let bulkBookTickerOk = false;
  let bulkBookTickerAttempted = false;

  inFlightRefresh = (async () => {
    forceBinancePublicHalfOpen(reason);

    try {
      bootstrapStep = 'exchangeInfo';
      logger.info(`BINANCE_PUBLIC_BOOTSTRAP_AUDIT: reason=${reason} requestId=${refreshRequestId} bootstrapStep=${bootstrapStep} endpoint=/api/v3/exchangeInfo baseUrl=auto attempted=true finalState=pending success=pending circuitBreakerState=${client.getCircuitSnapshot().circuitBreakerState} invariantOk=true`);
      const ex = await client.getExchangeInfo();
      MarketDataFeed.getInstance().setExchangeInfo(ex);
      getMarketDataCache().setExchangeInfo(ex);
      exchangeInfoOk = Array.isArray(ex.symbols);
      status.exchangeInfoLoaded = exchangeInfoOk;
      status.lastSuccessfulEndpoint = '/api/v3/exchangeInfo';
      status.baseUrl = client.getLastBaseUrl();
      if (!exchangeInfoOk) throw new Error('EXCHANGE_INFO_SYMBOLS_MISSING');
    } catch (err) {
      const failure = client.getLastFailure();
      if (failure) failures.push(failure);
      applyFailure(failure);
      const budgetOnlyFailure = failure?.finalState === 'skipped_request_budget_exceeded'
        || failure?.failureReason === 'REQUEST_BUDGET_EXCEEDED';
      if (!budgetOnlyFailure) status.exchangeInfoLoaded = false;
      status.tickerProbeOk = false;
      status.bookTickerProbeOk = false;
      status.bulkBookTickerOk = false;
      status.ticker24hrCacheStatus = getMarketDataCache().getStatus().ticker24hrStatus;
      status.bookTickerCacheStatus = budgetOnlyFailure
        ? MarketDataFeed.getInstance().getBookTickerCacheStatus()
        : 'missing';
      status.publicApiOnline = budgetOnlyFailure && status.exchangeInfoLoaded ? status.publicApiOnline : false;
      syncCircuitStatus();
      logger.warn(`BINANCE_PUBLIC_BOOTSTRAP_AUDIT: reason=${reason} requestId=${refreshRequestId} bootstrapStep=${bootstrapStep} endpoint=/api/v3/exchangeInfo baseUrl=${status.lastFailureBaseUrl ?? 'none'} attempted=true finalState=success_false success=false publicApiOnline=${String(status.publicApiOnline)} exchangeInfoLoaded=${String(status.exchangeInfoLoaded)} circuitBreakerState=${status.circuitBreakerState} retryActive=${String(status.retryActive)} nextRetryInMs=${status.nextRetryInMs} requestFanoutBlocked=true requestBudgetRemaining=${status.requestBudgetRemaining} requestBudgetMax=${status.requestBudgetMax} budgetResetAt=${status.budgetResetAt} budgetExhausted=${String(status.budgetExhausted)} budgetExhaustedReason=${normalize(status.budgetExhaustedReason)} bulkTickerCacheFresh=${String(status.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(status.singleSymbolFallbackAllowed)} invariantOk=true failureReason=${normalize(status.lastFailureReason ?? (err instanceof Error ? err.message : String(err)))}`);
      return finalize();
    }

    try {
      bootstrapStep = 'ticker_probe';
      const tickerRows = await client.get24hTickers();
      getMarketDataCache().setTicker24hr(tickerRows);
      const btcTicker = tickerRows.find((row) => String(row.symbol ?? '').toUpperCase() === 'BTCUSDT');
      tickerProbeOk = tickerRows.length > 0 && (!btcTicker || Number(btcTicker.lastPrice ?? btcTicker.weightedAvgPrice ?? 0) > 0);
      if (tickerProbeOk) {
        status.lastSuccessfulEndpoint = '/api/v3/ticker/24hr';
        status.baseUrl = client.getLastBaseUrl();
        status.ticker24hrCacheStatus = 'fresh';
      }
    } catch {
      const failure = client.getLastFailure();
      if (failure) failures.push(failure);
      applyFailure(failure);
    }

    if (exchangeInfoOk && tickerProbeOk) {
      try {
        bootstrapStep = 'bulk_book_ticker';
        bulkBookTickerAttempted = true;
        const rows = await client.getBookTickers();
        bulkBookTickerOk = rows.length > 0;
        if (bulkBookTickerOk) {
          getMarketDataCache().setBookTickers(rows);
          MarketDataFeed.getInstance().setBulkBookTickers(rows);
          const scannerUniverse = getMarketDataCache().rebuildScannerUniverseFromBulkData();
          const btc = rows.find((row) => String(row.symbol ?? '').toUpperCase() === 'BTCUSDT');
          const bid = Number(btc?.bidPrice);
          const ask = Number(btc?.askPrice);
          bookTickerProbeOk = bid > 0 && ask > 0;
          status.bookTickerCacheStatus = 'fresh';
          status.lastSuccessfulEndpoint = '/api/v3/ticker/bookTicker';
          status.baseUrl = client.getLastBaseUrl();
          logger.info(`BINANCE_PUBLIC_BULK_BOOK_TICKER_AUDIT: reason=${reason} requestId=${refreshRequestId} endpoint=/api/v3/ticker/bookTicker baseUrl=${status.baseUrl ?? 'none'} attempted=true finalState=success success=true rows=${rows.length} circuitBreakerState=${client.getCircuitSnapshot().circuitBreakerState} invariantOk=true`);
          logger.info(`SCANNER_UNIVERSE_BOOTSTRAP_AUDIT: reason=${reason} requestId=${refreshRequestId} source=public_market_data_bulk_cache ticker24hrCacheStatus=${getMarketDataCache().getStatus().ticker24hrStatus} bookTickerCacheStatus=${getMarketDataCache().getStatus().bookTickerStatus} scannerUniverseCount=${scannerUniverse.count} scannerUniverseCacheStatus=${getMarketDataCache().getStatus().scannerUniverseStatus} buyIntentCreated=false submitAttempted=false positionMutated=false journalMutated=false invariantOk=${String(scannerUniverse.count > 0)} failureReason=${scannerUniverse.failureReason}`);
        }
      } catch {
        const failure = client.getLastFailure();
        if (failure) failures.push(failure);
        applyFailure(failure);
        status.bookTickerCacheStatus = status.lastMarketDataUpdate > 0 ? 'stale' : 'missing';
      }
    } else {
      status.bookTickerCacheStatus = status.lastMarketDataUpdate > 0 ? 'stale' : 'missing';
      const circuit = client.getCircuitSnapshot();
      logger.warn(`BINANCE_PUBLIC_REQUEST_FANOUT_BLOCKED_AUDIT: requestId=${refreshRequestId} endpoint=/api/v3/ticker/bookTicker baseUrl=none attempted=false finalState=skipped_exchange_info_missing success=false statusCode=n/a errorName=BootstrapNotHealthy errorMessage=bulk_book_ticker_skipped durationMs=0 timeoutMs=0 circuitBreakerState=${circuit.circuitBreakerState} retryActive=${String(circuit.retryActive)} nextRetryInMs=${circuit.nextRetryInMs} publicApiOnline=${String(exchangeInfoOk)} exchangeInfoLoaded=${String(exchangeInfoOk)} requestFanoutBlocked=true inflightDeduped=false requestBudgetRemaining=${circuit.requestBudgetRemaining} requestBudgetMax=${circuit.requestBudgetMax} budgetResetAt=${circuit.budgetResetAt} budgetExhausted=${String(circuit.budgetExhausted)} budgetExhaustedReason=${normalize(circuit.budgetExhaustedReason)} bulkTickerCacheFresh=${String(circuit.bulkTickerCacheFresh)} singleSymbolFallbackAllowed=${String(circuit.singleSymbolFallbackAllowed)} invariantOk=true failureReason=BOOTSTRAP_NOT_HEALTHY`);
    }

    return finalize();
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }

  function finalize(): PublicMarketDataRefreshResult {
    const freshCounts = countFreshOpenSymbols(uniqueOpenSymbols);
    status.tickerProbeOk = tickerProbeOk;
    status.bookTickerProbeOk = bookTickerProbeOk;
    status.bulkBookTickerOk = bulkBookTickerOk;
    status.ticker24hrCacheStatus = getMarketDataCache().getStatus().ticker24hrStatus;
    status.openPositionFreshCount = freshCounts.fresh;
    status.openPositionStaleCount = freshCounts.stale;
    syncCircuitStatus();
    const budgetOnlyBlock = status.budgetExhausted && status.exchangeInfoLoaded && (exchangeInfoOk || status.publicApiOnline);
    status.publicApiOnline = (exchangeInfoOk && tickerProbeOk) || budgetOnlyBlock;
    if (status.publicApiOnline) {
      if (bulkBookTickerOk) {
        status.lastMarketDataUpdate = Date.now();
        status.lastFailureEndpoint = null;
        status.lastFailureBaseUrl = null;
        status.lastFailureReason = null;
        status.lastErrorMessage = null;
        status.bookTickerCacheStatus = 'fresh';
      } else if (status.lastMarketDataUpdate > 0 && Date.now() - status.lastMarketDataUpdate > 30000) {
        status.bookTickerCacheStatus = 'stale';
      }
    } else if (status.lastMarketDataUpdate > 0 && Date.now() - status.lastMarketDataUpdate > 30000) {
      status.bookTickerCacheStatus = 'stale';
    }
    syncCircuitStatus();

    const result: PublicMarketDataRefreshResult = {
      ...status,
      reason,
      requestId: refreshRequestId,
      deduped: false,
      cancelledPrevious: false,
      bootstrapStep,
      exchangeInfoAttempted: true,
      tickerProbeAttempted: exchangeInfoOk,
      bookTickerProbeAttempted: exchangeInfoOk && tickerProbeOk,
      bulkBookTickerAttempted,
      openPositionPriceRefreshAttempted: false,
      failures,
    };

    logger.info(`PUBLIC_MARKET_DATA_REFRESH_AUDIT: reason=${reason} requestId=${refreshRequestId} deduped=false cancelledPrevious=false bootstrapStep=${bootstrapStep} exchangeInfoOk=${String(exchangeInfoOk)} tickerProbeOk=${String(tickerProbeOk)} bookTickerProbeOk=${String(bookTickerProbeOk)} bulkBookTickerOk=${String(bulkBookTickerOk)} publicApiOnline=${String(status.publicApiOnline)} circuitBreakerState=${status.circuitBreakerState} nextRetryInMs=${status.nextRetryInMs} failureEndpoint=${status.lastFailureEndpoint ?? 'none'} failureReason=${normalize(status.lastFailureReason)} requestStormBlocked=${String(status.requestStormBlocked)} invariantOk=${String(status.publicApiOnline || Boolean(status.lastFailureReason) || status.requestStormBlocked)}`);
    emitStatusAudit(refreshRequestId);
    return result;
  }
}
