import assert from 'node:assert';
import type { AiDecisionInput } from '../core/ai/AiTakeoverTypes';
import type { AiTakeoverTrader } from '../core/ai/AiTakeoverTrader';
import type { AiMission } from '../core/ai/command/AiCommandCenterTypes';
import { runAiMission } from '../core/ai/command/AiMissionRunner';
import { requestMarketDataSnapshot } from '../core/market/MarketDataSnapshotService';
import { getMarketDataCache } from '../core/market/MarketDataCache';
import { forceBinancePublicRequestBudgetForTests, resetBinancePublicCircuitForTests } from '../core/market-data/BinancePublicClient';
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

try {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('AI mission must not call Binance fetch');
  }) as typeof fetch;

  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  forceBinancePublicRequestBudgetForTests(1000);

  const exhaustedSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: ['BTCUSDT'],
    scannerUniverse: [],
    allowBulkRefresh: false,
  });
  let providerCalls = 0;
  const blockedTrader = {
    getConfig: () => ({ mode: 'ON', provider: 'OpenCode Go', model: 'deepseek-v4-flash', timeoutMs: 12000, maxCandidatesPerScan: 3, maxResultsPerMission: 3, minCleanUpsidePct: 3, minConfidence: 0.7, minTp1Pct: 1.2, maxTp1Pct: 5 }),
    evaluate: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called when market-data snapshot is blocked');
    },
  } as unknown as AiTakeoverTrader;
  const blocked = await runAiMission('find max 3 coins above 3%', [], blockedTrader, mission, {
    marketDataSnapshot: exhaustedSnapshot,
    providerTopK: 3,
  });
  assert.strictEqual(blocked.cards.length, 0, 'blocked market-data snapshot returns no cards');
  assert.strictEqual(blocked.blockedReason, 'MARKET_DATA_BUDGET_EXHAUSTED', 'AI mission reports exact market-data budget blocker');
  assert.strictEqual(blocked.providerCallCount, 0, 'AI provider is not called when budget blocks snapshot');
  assert.strictEqual(providerCalls, 0, 'trader.evaluate is not called when budget blocks snapshot');
  assert.strictEqual(fetchCalls, 0, 'AI mission does not perform Binance fetch when budget is exhausted');

  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    ...candidate(`T${index}USDT`, 10 - index),
    retrospective: null,
  }));
  getMarketDataCache().setExchangeInfo({
    symbols: candidates.map((c) => ({
      symbol: c.symbol,
      status: 'TRADING',
      isSpotTradingAllowed: true,
      filters: [],
    })),
  });
  getMarketDataCache().setTicker24hr(candidates.map((c) => ({
    symbol: c.symbol,
    lastPrice: String(c.price),
    priceChangePercent: String(c.change24h),
    quoteVolume: String(c.volume24h),
  })));
  getMarketDataCache().setBookTickers(candidates.map((c) => ({
    symbol: c.symbol,
    bidPrice: String(c.bidPrice),
    askPrice: String(c.askPrice),
  })));
  getMarketDataCache().setScannerUniverse(candidates as any);

  const freshSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: candidates.map((c) => c.symbol),
    scannerUniverse: candidates as any,
    allowBulkRefresh: false,
  });
  assert.strictEqual(freshSnapshot.usableForAiMission, true, 'fresh scanner cache is usable for AI mission');
  assert.strictEqual(freshSnapshot.readinessState, 'READY', 'fresh scanner cache reports READY');
  providerCalls = 0;
  let gatewayCalls = 0;
  let promptBody = '';
  const trader = {
    getConfig: () => ({ mode: 'ON', provider: 'OpenCode Go', model: 'deepseek-v4-flash', timeoutMs: 12000, maxCandidatesPerScan: 3, maxResultsPerMission: 3, minCleanUpsidePct: 3, minConfidence: 0.7, minTp1Pct: 1.2, maxTp1Pct: 5 }),
    evaluate: async () => {
      providerCalls += 1;
      throw new Error('mission must use batch gateway instead of per-candidate trader.evaluate');
    },
  } as unknown as AiTakeoverTrader;
  const result = await runAiMission('find max 3 coins above 3%', candidates, trader, mission, {
    marketDataSnapshot: freshSnapshot,
    providerTopK: 3,
    providerGateway: async (request) => {
      gatewayCalls += 1;
      promptBody = request.messages.map((message) => message.content).join('\n');
      assert.strictEqual(request.requestKind, 'mission', 'AI mission uses gateway requestKind=mission');
      assert.strictEqual(request.topK, 3, 'gateway receives topK');
      const user = JSON.parse(String(request.messages[1].content));
      assert.strictEqual(user.candidates.length, 3, 'gateway prompt contains only topK candidates');
      assert.strictEqual(JSON.stringify(user).includes('range21dPct'), false, 'compact mission prompt excludes bulky retrospective fields');
      return {
        ok: true,
        rawText: '{}',
        parsedJson: {
          missionId: 'test',
          decisions: user.candidates.map((c: { symbol: string; expectedUpsidePct: number; expectedDownsidePct: number; riskRewardRatio: number }) => ({
            symbol: c.symbol,
            decision: 'WAIT',
            confidence: 0.82,
            professionalVerdict: 'WAIT',
            expectedUpsidePct: c.expectedUpsidePct,
            expectedDownsidePct: c.expectedDownsidePct,
            riskRewardRatio: c.riskRewardRatio,
            tpPlan: { tp1Pct: 3, tp1Reason: 'test', tp2Pct: 0 },
            riskPlan: { slPct: 1.5 },
            reason: 'test response',
            rejectIf: [],
          })),
        },
        failureReason: null,
        httpStatus: 200,
        durationMs: 42,
        retryCount: 0,
        responseParsed: true,
        schemaValid: true,
        responseShape: 'openai_chat_completion',
        contentSource: 'choices[0].message.content',
        contentPreviewSafe: '{}',
        providerHealth: 'OK',
        apiUrlHost: 'opencode.ai',
        apiUrlPath: '/zen/go/v1/chat/completions',
        transport: 'injected_fetch',
      };
    },
  });
  assert.strictEqual(result.cards.length, 3, 'AI mission returns max requested cards');
  assert.strictEqual(result.providerCallCount, 1, 'AI provider is called once as a batch');
  assert.strictEqual(providerCalls, 0, 'AI mission does not call per-candidate trader.evaluate');
  assert.strictEqual(gatewayCalls, 1, 'AI mission uses one provider gateway call');
  assert.ok(promptBody.length < 12000, 'compact prompt stays under size budget');
  assert.strictEqual(fetchCalls, 0, 'fresh cache AI mission does not perform Binance fetch');
} finally {
  globalThis.fetch = originalFetch;
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  resetBinancePublicCircuitForTests();
}

console.log('AI market-data fanout regression tests PASSED.');
