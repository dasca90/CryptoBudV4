import assert from 'node:assert';
import type { AiDecisionInput } from '../core/ai/AiTakeoverTypes';
import type { AiTakeoverTrader } from '../core/ai/AiTakeoverTrader';
import type { AiMission } from '../core/ai/command/AiCommandCenterTypes';
import { runAiMission } from '../core/ai/command/AiMissionRunner';
import { requestMarketDataSnapshot } from '../core/market/MarketDataSnapshotService';
import { getMarketDataCache } from '../core/market/MarketDataCache';
import { forceBinancePublicRequestBudgetForTests, markBinanceExchangeInfoLoaded, resetBinancePublicCircuitForTests } from '../core/market-data/BinancePublicClient';
import { MarketDataFeed } from '../utils/MarketDataFeed';

const originalFetch = globalThis.fetch;

function candidate(symbol: string, upside: number): AiDecisionInput {
  return {
    symbol,
    price: 1,
    bidPrice: 0.99,
    askPrice: 1.01,
    spreadPct: 0.2,
    volume24h: 1_000_000,
    change5m: 0.2,
    change15m: 0.5,
    change1h: 1.2,
    change24h: 4,
    high24h: 1.2,
    low24h: 0.9,
    marketRegime: 'bullish',
    btcRegime: 'aligned',
    ethRegime: 'aligned',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    confidence: 0.7,
    priceFresh: true,
    bookFresh: true,
    retrospective: {
      range1hPct: 2,
      range4hPct: 4,
      range24hPct: 8,
      range3dPct: 14,
      range7dPct: 20,
      range21dPct: 40,
      recentHighDistancePct: 5,
      recentLowDistancePct: 2,
      supportDistancePct: 1.5,
      resistanceDistancePct: upside,
      cleanUpsidePct: upside,
      downsideRiskPct: 1.5,
      volatilityPct: 4,
      averageReboundAfterDipPct: 3,
      pumpRiskPct: 10,
      candleExhaustion: false,
      overextended: false,
      liquidityDepthStatus: 'PASS',
      spreadStabilityStatus: 'PASS',
      volumeStabilityStatus: 'PASS',
    },
  };
}

const mission: AiMission = {
  missionType: 'FIND_COINS_WITH_UPSIDE',
  maxResults: 3,
  minCleanUpsidePct: 3,
  requireRetrospectiveAnalysis: true,
  antiFomo: false,
  antiRugpull: false,
  antiManipulation: false,
  newListingGuard: false,
  allowBuyIntent: true,
};

const trader = {
  getConfig: () => ({ mode: 'ON', provider: 'OpenCode Go', model: 'deepseek-v4-flash', timeoutMs: 12000, maxCandidatesPerScan: 3, maxResultsPerMission: 3, minCleanUpsidePct: 3, minConfidence: 0.7, minTp1Pct: 1.2, maxTp1Pct: 5 }),
  evaluate: async () => {
    throw new Error('AI mission must use batch gateway, not per-candidate evaluate');
  },
} as unknown as AiTakeoverTrader;

function seedSecondRunStaleBook(candidates: AiDecisionInput[]): void {
  const cache = getMarketDataCache();
  const staleAt = Date.now() - 131_000;
  const freshAt = Date.now();
  cache.setExchangeInfo({
    symbols: candidates.map((c) => ({
      symbol: c.symbol,
      status: 'TRADING',
      isSpotTradingAllowed: true,
      filters: [],
    })),
  }, freshAt);
  cache.setTicker24hr(candidates.map((c) => ({
    symbol: c.symbol,
    lastPrice: String(c.price),
    priceChangePercent: String(c.change24h),
    quoteVolume: String(c.volume24h),
  })), freshAt);
  cache.setBookTickers(candidates.map((c) => ({
    symbol: c.symbol,
    bidPrice: String(c.bidPrice),
    askPrice: String(c.askPrice),
  })), staleAt);
  cache.setScannerUniverse(candidates as any, freshAt);
  markBinanceExchangeInfoLoaded(true);
}

try {
  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  forceBinancePublicRequestBudgetForTests(0);

  const candidates = [candidate('AAAUSDT', 9), candidate('BBBUSDT', 8), candidate('CCCUSDT', 7), candidate('DDDUSDT', 6)];
  seedSecondRunStaleBook(candidates);

  const staleSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: candidates.map((c) => c.symbol),
    scannerUniverse: candidates as any,
    allowBulkRefresh: true,
  });
  assert.strictEqual(staleSnapshot.usableForAiMission, false, 'second-run stale book snapshot is not used directly');
  assert.strictEqual(staleSnapshot.readinessState, 'REFRESHING_BOOKTICKER', 'stale book snapshot enters explicit refresh state');
  assert.ok(staleSnapshot.staleFields.includes('bookTicker'), 'snapshot identifies bookTicker as stale');

  const urls: string[] = [];
  let gatewayCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/api/v3/ticker/bookTicker')) {
      return new Response(JSON.stringify(candidates.map((c) => ({
        symbol: c.symbol,
        bidPrice: String(c.bidPrice),
        askPrice: String(c.askPrice),
      }))), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected Binance request: ${url}`);
  }) as typeof fetch;

  const result = await runAiMission('find max 3 coins above 3%', candidates, trader, mission, {
    marketDataSnapshot: staleSnapshot,
    providerTopK: 3,
    providerGateway: async (request) => {
      gatewayCalls += 1;
      const user = JSON.parse(String(request.messages[1].content));
      assert.strictEqual(user.candidates.length, 3, 'provider receives only topK after snapshot refresh');
      return {
        ok: true,
        rawText: '{}',
        parsedJson: {
          missionId: request.missionId,
          decisions: user.candidates.map((c: { symbol: string; expectedUpsidePct: number; expectedDownsidePct: number; riskRewardRatio: number }) => ({
            symbol: c.symbol,
            decision: 'WAIT',
            confidence: 0.8,
            professionalVerdict: 'WAIT',
            expectedUpsidePct: c.expectedUpsidePct,
            expectedDownsidePct: c.expectedDownsidePct,
            riskRewardRatio: c.riskRewardRatio,
            tpPlan: { tp1Pct: 3, tp1Reason: 'test', tp2Pct: 0 },
            riskPlan: { slPct: 1.5 },
            reason: 'test',
            rejectIf: [],
          })),
        },
        failureReason: null,
        httpStatus: 200,
        durationMs: 40,
        retryCount: 0,
        responseParsed: true,
        schemaValid: true,
        responseShape: 'openai_chat_completion',
        contentSource: 'choices[0].message.content',
        contentPreviewSafe: '{}',
        providerHealth: 'OK',
        apiUrlHost: 'opencode.ai',
        apiUrlPath: '/zen/go/v1/chat/completions',
        transport: 'test',
      };
    },
  });
  assert.strictEqual(urls.filter((url) => url.includes('/api/v3/ticker/bookTicker')).length, 1, 'second run triggers one bulk bookTicker refresh');
  assert.strictEqual(urls.some((url) => url.includes('/api/v3/klines')), false, 'bookTicker preflight does not start klines hydration');
  assert.strictEqual(gatewayCalls, 1, 'AI provider is called after refreshed snapshot is usable');
  assert.strictEqual(result.providerCallCount, 1, 'mission performs one provider batch call');
  assert.strictEqual(result.diagnostics?.refreshAttempted, true, 'diagnostics records refresh attempt');
  assert.strictEqual(result.diagnostics?.refreshSuccess, true, 'diagnostics records refresh success');
  assert.strictEqual(result.diagnostics?.marketSnapshotStatus, 'READY', 'diagnostics use rebuilt ready snapshot');
  assert.strictEqual(result.diagnostics?.bookTickerFresh, true, 'rebuilt snapshot has fresh bookTicker');
  assert.strictEqual(result.blockedReason, null, 'mission is not blocked by stale book after successful refresh');

  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  forceBinancePublicRequestBudgetForTests(0);
  seedSecondRunStaleBook(candidates);
  const failingSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: candidates.map((c) => c.symbol),
    scannerUniverse: candidates as any,
    allowBulkRefresh: true,
  });
  urls.length = 0;
  gatewayCalls = 0;
  globalThis.fetch = (async () => {
    urls.push('/api/v3/ticker/bookTicker');
    throw new Error('network_down');
  }) as typeof fetch;
  const blocked = await runAiMission('find max 3 coins above 3%', candidates, trader, mission, {
    marketDataSnapshot: failingSnapshot,
    providerTopK: 3,
    providerGateway: async () => {
      gatewayCalls += 1;
      throw new Error('provider must not be called after failed bookTicker refresh');
    },
  });
  assert.strictEqual(blocked.providerCallCount, 0, 'provider is not called when bookTicker refresh fails');
  assert.strictEqual(gatewayCalls, 0, 'gateway is not called when bookTicker refresh fails');
  assert.strictEqual(blocked.blockedReason, 'BOOKTICKER_REFRESH_FAILED', 'failed refresh reports exact blocker');
  assert.strictEqual(blocked.diagnostics?.refreshAttempted, true, 'blocked diagnostics records refresh attempt');
  assert.strictEqual(blocked.diagnostics?.refreshSuccess, false, 'blocked diagnostics records refresh failure');
} finally {
  globalThis.fetch = originalFetch;
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  resetBinancePublicCircuitForTests();
}

console.log('AI mission second-run bookTicker refresh regression tests PASSED.');
