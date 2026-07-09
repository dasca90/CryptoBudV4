import assert from 'node:assert';
import { refreshPublicMarketData } from '../core/market-data/PublicMarketDataStatus';
import {
  BinancePublicClient,
  forceBinancePublicRequestBudgetForTests,
  getBinancePublicCircuitSnapshot,
  getBinanceRequestHealthSnapshot,
  resetBinancePublicCircuitForTests,
} from '../core/market-data/BinancePublicClient';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { resolveClosePrice } from '../core/market-data/close-price-resolver';
import { logger } from '../utils/logger';
import { parseAiMission } from '../core/ai/command/AiMissionParser';
import { AI_TAKEOVER_DEFAULT_CONFIG } from '../core/ai/AiTakeoverTypes';
import { getMarketDataCache } from '../core/market/MarketDataCache';

const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function exchangeSymbol(symbol: string, baseAsset: string) {
  return {
    symbol,
    baseAsset,
    quoteAsset: 'USDT',
    status: 'TRADING',
    isSpotTradingAllowed: true,
    filters: [
      { filterType: 'PRICE_FILTER', tickSize: '0.01', minPrice: '0.01', maxPrice: '10000000' },
      { filterType: 'LOT_SIZE', minQty: '0.0001', maxQty: '1000000', stepSize: '0.0001' },
      { filterType: 'MIN_NOTIONAL', minNotional: '10' },
    ],
  };
}

function installHealthyFetch(calls: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/v3/exchangeInfo')) {
      return jsonResponse({ symbols: [exchangeSymbol('BTCUSDT', 'BTC'), exchangeSymbol('ETHUSDT', 'ETH')] });
    }
    if (url.includes('/api/v3/ticker/24hr')) {
      return jsonResponse([
        { symbol: 'BTCUSDT', lastPrice: '50000', priceChangePercent: '1.2', quoteVolume: '1000000000' },
        { symbol: 'ETHUSDT', lastPrice: '3000', priceChangePercent: '0.8', quoteVolume: '900000000' },
      ]);
    }
    if (url.includes('/api/v3/ticker/bookTicker')) {
      if (url.includes('symbol=BTCUSDT')) return jsonResponse({ symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' });
      return jsonResponse([
        { symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' },
        { symbol: 'ETHUSDT', bidPrice: '2999', askPrice: '3001' },
      ]);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

try {
  MarketDataFeed.getInstance().destroy();
  getMarketDataCache().clear();
  resetBinancePublicCircuitForTests();

  const successCalls: string[] = [];
  installHealthyFetch(successCalls);

  const ok = await refreshPublicMarketData('test_success', ['BTCUSDT', 'ETHUSDT']);
  assert.strictEqual(ok.publicApiOnline, true, 'Public bootstrap succeeds');
  assert.strictEqual(ok.exchangeInfoLoaded, true, 'exchangeInfoLoaded=true after success');
  assert.strictEqual(ok.tickerProbeOk, true, 'ticker probe succeeds');
  assert.strictEqual(ok.bookTickerProbeOk, true, 'bookTicker probe succeeds');
  assert.strictEqual(ok.bulkBookTickerOk, true, 'bulk bookTicker cache succeeds');
  assert.strictEqual(ok.ticker24hrCacheStatus, 'fresh', 'ticker24hr cache is fresh');
  assert.strictEqual(ok.bookTickerCacheStatus, 'fresh', 'bookTicker cache is fresh');
  assert.strictEqual(ok.scannerUniverseCacheStatus, 'fresh', 'scanner universe cache is fresh after public bootstrap');
  assert.strictEqual(getMarketDataCache().getScannerUniverse().length, 2, 'public bootstrap builds scanner universe from bulk caches');
  assert.strictEqual(MarketDataFeed.getInstance().getCachedPrice('ETHUSDT')?.last, 3000, 'bulk cache populates scanner/open-position prices');
  assert.strictEqual(getMarketDataCache().getTicker24hr('ETHUSDT')?.lastPrice, '3000', 'bulk ticker24hr cache is available by symbol');
  assert.strictEqual(successCalls.filter((u) => u.includes('/api/v3/ticker/24hr')).length, 1, 'success path uses one bulk 24hr request');
  assert.strictEqual(successCalls.filter((u) => u.includes('/api/v3/ticker/bookTicker')).length, 1, 'success path uses one bulk bookTicker request');
  assert.strictEqual(successCalls.filter((u) => u.includes('/api/v3/ticker/price')).length, 0, 'success path does not use ticker/price probe');
  const callsBeforeCacheRead = successCalls.length;
  const scannerCachedPrice = await MarketDataFeed.getInstance().getPrice('ETHUSDT');
  assert.strictEqual(scannerCachedPrice.last, 3000, 'scanner price reads from bulk bookTicker cache');
  assert.strictEqual(successCalls.length, callsBeforeCacheRead, 'scanner cache read does not perform single-symbol bookTicker fanout');
  const closeFromCache = await resolveClosePrice('ETHUSDT', 'SELL');
  assert.strictEqual(closeFromCache.source, 'book_ticker', 'exit engine reads fresh bookTicker cache first');
  assert.strictEqual(successCalls.length, callsBeforeCacheRead, 'exit cache read does not perform single-symbol fetch');

  logger.clear();
  const callsBeforeBudget = successCalls.length;
  forceBinancePublicRequestBudgetForTests(1000);
  const budgetSnap = getBinancePublicCircuitSnapshot();
  assert.strictEqual(budgetSnap.requestBudgetRemaining, 0, 'request budget can be exhausted in test');
  assert.strictEqual(budgetSnap.circuitBreakerState, 'RATE_LIMITED', 'budget exhausted sets RATE_LIMITED, not CLOSED');
  assert.strictEqual(budgetSnap.retryActive, true, 'budget exhausted enables retryActive');
  assert.ok(budgetSnap.nextRetryInMs > 0, 'budget exhausted schedules next retry');
  assert.strictEqual(budgetSnap.exchangeInfoLoaded, true, 'budget exhausted does not clear exchangeInfoLoaded');

  const budgetResult = await refreshPublicMarketData('budget_exhausted', ['ETHUSDT']);
  assert.strictEqual(budgetResult.publicApiOnline, true, 'local budget exhaustion does not mark public API offline');
  assert.strictEqual(budgetResult.requestBudgetStatus, 'EXHAUSTED', 'UI/status can display budget exhausted separately');
  assert.strictEqual(budgetResult.circuitBreakerState, 'RATE_LIMITED', 'refresh preserves RATE_LIMITED state while budget is exhausted');
  assert.strictEqual(budgetResult.retryActive, true, 'refresh keeps retry active while budget is exhausted');
  assert.ok(budgetResult.nextRetryInMs > 0, 'refresh exposes next retry for budget exhaustion');
  assert.strictEqual(successCalls.length, callsBeforeBudget, 'budget exhausted blocks network fanout before fetch');

  const budgetClient = new BinancePublicClient();
  await Promise.allSettled([
    budgetClient.getBookTicker('ETHUSDT'),
    budgetClient.getBookTicker('SOLUSDT'),
    budgetClient.getBookTicker('XRPUSDT'),
  ]);
  const budgetSummaryLogs = logger.getInternalAuditLogs().filter((entry) => entry.message.includes('BINANCE_REQUEST_BUDGET_SUMMARY_AUDIT'));
  assert.strictEqual(budgetSummaryLogs.length, 1, 'budget exhaustion emits one aggregated summary warning');
  const rateLimitStateLogs = logger.getInternalAuditLogs().filter((entry) => entry.message.includes('BINANCE_PUBLIC_RATE_LIMIT_STATE_AUDIT'));
  assert.strictEqual(rateLimitStateLogs.length, 1, 'rate-limit state audit is aggregated instead of emitted per blocked symbol');
  const fanoutBudgetLogs = logger.getInternalAuditLogs().filter((entry) => entry.message.includes('BINANCE_PUBLIC_REQUEST_FANOUT_BLOCKED_AUDIT') && entry.message.includes('skipped_request_budget_exceeded'));
  assert.strictEqual(fanoutBudgetLogs.length, 0, 'budget exhaustion does not spam one fanout warn per symbol');

  resetBinancePublicCircuitForTests();
  logger.clear();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  const fallbackCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fallbackCalls.push(url);
    if (url === 'https://api.binance.com/api/v3/exchangeInfo') throw new TypeError('Failed to fetch');
    if (url.includes('/api/v3/exchangeInfo')) {
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', isSpotTradingAllowed: true, filters: [] }] });
    }
    if (url.includes('/api/v3/ticker/24hr')) return jsonResponse([{ symbol: 'BTCUSDT', lastPrice: '50000', priceChangePercent: '1.2' }]);
    if (url.includes('/api/v3/ticker/bookTicker')) {
      if (url.includes('symbol=BTCUSDT')) return jsonResponse({ symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' });
      return jsonResponse([{ symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' }]);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
  const fallbackOk = await refreshPublicMarketData('exchange_info_base_url_fallback', []);
  assert.strictEqual(fallbackOk.publicApiOnline, true, 'Bootstrap succeeds when api.binance.com fails but fallback host works');
  assert.strictEqual(getBinancePublicCircuitSnapshot().circuitBreakerState, 'CLOSED', 'Fallback success keeps circuit closed');
  assert.ok(fallbackCalls.includes('https://api1.binance.com/api/v3/exchangeInfo'), 'exchangeInfo tries fallback host before opening circuit');

  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  const failedExchangeCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    failedExchangeCalls.push(url);
    if (url.includes('/api/v3/exchangeInfo')) throw new TypeError('Failed to fetch');
    throw new Error(`Unexpected fanout after exchangeInfo failure: ${url}`);
  }) as typeof fetch;

  const exchangeFailed = await refreshPublicMarketData('exchange_info_failure', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  assert.strictEqual(exchangeFailed.publicApiOnline, false, 'exchangeInfo failure sets Public API OFFLINE');
  assert.strictEqual(exchangeFailed.exchangeInfoLoaded, false, 'exchangeInfo remains unloaded after failure');
  assert.strictEqual(exchangeFailed.circuitBreakerState, 'OPEN', 'exchangeInfo failure opens circuit breaker');
  assert.strictEqual(exchangeFailed.retryActive, true, 'retryActive=true when circuit is OPEN');
  assert.strictEqual(exchangeFailed.requestStormBlocked, true, 'request storm is marked blocked');
  assert.ok(exchangeFailed.nextRetryInMs > 0, 'next retry is scheduled');
  assert.ok(exchangeFailed.lastFailureReason?.includes('FETCH_FAILED') || exchangeFailed.lastFailureReason?.includes('Failed'), 'Failure keeps exact reason');
  assert.strictEqual(failedExchangeCalls.filter((u) => u.includes('/api/v3/ticker/bookTicker')).length, 0, 'exchangeInfo failure prevents per-symbol bookTicker fanout');
  assert.strictEqual(failedExchangeCalls.filter((u) => u.includes('/api/v3/ticker/price')).length, 0, 'exchangeInfo failure prevents ticker probe fanout');

  const healthAfterFail = getBinanceRequestHealthSnapshot();
  assert.ok(healthAfterFail.requestCount <= 5, `offline bootstrap tries bounded base URL fallback only (count=${healthAfterFail.requestCount})`);

  const blocked = await MarketDataFeed.getInstance().getPrice('BTCUSDT');
  assert.strictEqual(blocked.last, 0, 'MarketDataFeed skips network price when circuit is open');
  assert.strictEqual(getBinanceRequestHealthSnapshot().requestCount, healthAfterFail.requestCount, 'blocked MarketDataFeed price read does not increment requestCount');

  const client = new BinancePublicClient();
  await assert.rejects(
    () => client.getBookTicker('ETHUSDT'),
    /skipped_public_api_offline|aborted_by_circuit_breaker|skipped_exchange_info_missing/,
    'Circuit OPEN blocks single-symbol bookTicker fanout',
  );

  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  let slowExchangeInfoCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v3/exchangeInfo')) {
      slowExchangeInfoCount++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', isSpotTradingAllowed: true, filters: [] }] });
    }
    if (url.includes('/api/v3/ticker/24hr')) return jsonResponse([{ symbol: 'BTCUSDT', lastPrice: '50000', priceChangePercent: '1.2' }]);
    if (url.includes('/api/v3/ticker/bookTicker')) {
      if (url.includes('symbol=BTCUSDT')) return jsonResponse({ symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' });
      return jsonResponse([{ symbol: 'BTCUSDT', bidPrice: '49999', askPrice: '50001' }]);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
  const [r1, r2] = await Promise.all([
    refreshPublicMarketData('dedupe_a', []),
    refreshPublicMarketData('dedupe_b', []),
  ]);
  assert.strictEqual(r1.publicApiOnline, true, 'First concurrent refresh succeeds');
  assert.strictEqual(r2.deduped, true, 'Second concurrent refresh is deduped');
  assert.strictEqual(slowExchangeInfoCount, 1, 'Concurrent refresh performs one exchangeInfo request');

  MarketDataFeed.getInstance().destroy();
  getMarketDataCache().clear();
  resetBinancePublicCircuitForTests();
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  await refreshPublicMarketData('exit_offline_bootstrap', []);
  const close = await resolveClosePrice('BTCUSDT', 'SELL', { entrySnapshotPrice: 50000 });
  assert.strictEqual(close.source, 'unavailable', 'Exit engine skips when all price sources unavailable');
  assert.strictEqual(close.isRealMarketPrice, false, 'Entry snapshot is not used as real exit price');
  assert.ok(close.errors.includes('entry_snapshot_not_allowed_for_real_exit'), 'Entry snapshot fallback remains blocked for real exit');

  const mission = parseAiMission('find max 3 unicorns above 3%') as unknown as Record<string, unknown>;
  assert.strictEqual('allowPaperExecution' in mission, false, 'AI mission parser has no allowPaperExecution');
  assert.strictEqual('allowLiveExecution' in mission, false, 'AI mission parser has no allowLiveExecution');
  assert.strictEqual(AI_TAKEOVER_DEFAULT_CONFIG.mode, 'OFF', 'AI Takeover OFF does not affect public data defaults');
  assert.strictEqual(getBinancePublicCircuitSnapshot().circuitBreakerState, 'OPEN', 'AI defaults do not close or alter public circuit state');
} finally {
  globalThis.fetch = originalFetch;
  MarketDataFeed.getInstance().destroy();
  getMarketDataCache().clear();
  resetBinancePublicCircuitForTests();
}

console.log('Public market data bootstrap regression tests PASSED.');
