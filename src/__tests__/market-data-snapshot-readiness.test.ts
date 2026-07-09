import assert from 'node:assert';
import type { ScannerCandidate } from '../core/types';
import { requestMarketDataSnapshot } from '../core/market/MarketDataSnapshotService';
import { getMarketDataCache } from '../core/market/MarketDataCache';
import { forceBinancePublicRequestBudgetForTests, resetBinancePublicCircuitForTests } from '../core/market-data/BinancePublicClient';
import { MarketDataFeed } from '../utils/MarketDataFeed';

function scannerCandidate(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  return {
    candidateId: 'cand_BTCUSDT',
    symbol: 'BTCUSDT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'top_caps',
    selectedStrategy: 'balanced',
    selectedPlaybook: null,
    confidence: 80,
    status: 'WAIT',
    traderBrainDecision: {
      symbol: 'BTCUSDT',
      mode: 'DEMO',
      selectedStrategy: 'balanced',
      selectedPlaybook: null,
      confidence: 80,
      status: 'WAIT',
      entryPlan: null,
      exitPlan: null,
      reasons: ['test'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: {
        unifiedSignal: null,
        playbookResult: null,
        autobotsResult: null,
      },
    } as any,
    entryGateDecision: null,
    riskDecision: null,
    mainReason: 'test',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 50000,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 1.2,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -1,
    reboundPercent: 1.5,
    reboundFreshnessStatus: 'valid',
    m5Change: 0.5,
    m15Change: 1.1,
    h1Change: 2,
    change24h: 4,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    ...overrides,
  };
}

function seedBulkCaches(candidate: ScannerCandidate): void {
  const cache = getMarketDataCache();
  cache.setExchangeInfo({
    symbols: [{
      symbol: candidate.symbol,
      status: 'TRADING',
      isSpotTradingAllowed: true,
      filters: [],
    }],
  });
  cache.setTicker24hr([{
    symbol: candidate.symbol,
    lastPrice: String(candidate.price),
    priceChangePercent: String(candidate.change24h),
    quoteVolume: '1000000',
  }]);
  cache.setBookTickers([{
    symbol: candidate.symbol,
    bidPrice: String(candidate.price * 0.999),
    askPrice: String(candidate.price * 1.001),
  }]);
}

try {
  resetBinancePublicCircuitForTests();
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();

  const fresh = scannerCandidate();
  seedBulkCaches(fresh);
  const ready = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: [fresh.symbol],
    scannerUniverse: [fresh],
    allowBulkRefresh: false,
  });
  assert.strictEqual(ready.usableForAiMission, true, 'fresh scanner candidate is usable for AI mission');
  assert.strictEqual(ready.readinessState, 'READY', 'fresh caches report READY');
  assert.strictEqual(ready.blockedReason, null, 'fresh snapshot is not blocked');
  assert.strictEqual(ready.candidateCount, 1, 'snapshot preserves scanner candidate count');

  const staleCandidateWithFreshBulk = scannerCandidate({ priceFresh: false, priceAgeMs: 60000, blockReasons: ['price_stale'] });
  seedBulkCaches(staleCandidateWithFreshBulk);
  const freshBulkSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: [staleCandidateWithFreshBulk.symbol],
    scannerUniverse: [staleCandidateWithFreshBulk],
    allowBulkRefresh: false,
  });
  assert.strictEqual(freshBulkSnapshot.usableForAiMission, true, 'fresh bulk cache overrides stale candidate metadata for AI mission snapshot');
  assert.notStrictEqual(freshBulkSnapshot.blockedReason, 'MARKET_DATA_SNAPSHOT_STALE_PRICE', 'fresh bulk cache is not mislabeled as stale price');
  assert.strictEqual(freshBulkSnapshot.priceCacheFresh, true, 'canonical price cache is fresh');

  const missingRetrospective = scannerCandidate({
    h1Change: undefined as any,
    m15Change: undefined as any,
    change24h: undefined as any,
    reboundFreshnessStatus: 'valid',
  });
  seedBulkCaches({ ...missingRetrospective, change24h: 0 });
  const partialSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: [missingRetrospective.symbol],
    scannerUniverse: [missingRetrospective],
    allowBulkRefresh: false,
  });
  assert.strictEqual(partialSnapshot.usableForAiMission, true, 'missing retrospective remains usable for AI pre-rank when price/book cache is fresh');
  assert.strictEqual(partialSnapshot.readinessState, 'PARTIAL_USABLE', 'missing retrospective reports PARTIAL_USABLE');
  assert.notStrictEqual(partialSnapshot.blockedReason, 'MARKET_DATA_SNAPSHOT_STALE_PRICE', 'missing retrospective is not mislabeled as stale price');
  assert.ok(partialSnapshot.missingFields.includes('candidate.retrospective'), 'missing fields include retrospective');
  assert.strictEqual(partialSnapshot.usablePreRankCount, 1, 'candidate can still be pre-ranked');
  assert.strictEqual(partialSnapshot.usableDecisionCount, 0, 'candidate is not decision-ready until retrospective hydration');

  const staleCacheCandidate = scannerCandidate();
  const staleAt = Date.now() - 60000;
  const cache = getMarketDataCache();
  cache.setExchangeInfo({
    symbols: [{
      symbol: staleCacheCandidate.symbol,
      status: 'TRADING',
      isSpotTradingAllowed: true,
      filters: [],
    }],
  }, staleAt);
  cache.setTicker24hr([{
    symbol: staleCacheCandidate.symbol,
    lastPrice: String(staleCacheCandidate.price),
    priceChangePercent: String(staleCacheCandidate.change24h),
    quoteVolume: '1000000',
  }], staleAt);
  cache.setBookTickers([{
    symbol: staleCacheCandidate.symbol,
    bidPrice: String(staleCacheCandidate.price * 0.999),
    askPrice: String(staleCacheCandidate.price * 1.001),
  }], staleAt);
  cache.setScannerUniverse([staleCacheCandidate], Date.now());
  const staleSnapshot = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: [staleCacheCandidate.symbol],
    scannerUniverse: [staleCacheCandidate],
    allowBulkRefresh: false,
  });
  assert.strictEqual(staleSnapshot.usableForAiMission, false, 'canonical stale price cache blocks AI mission');
  assert.strictEqual(staleSnapshot.readinessState, 'BLOCKED_STALE_BOOK', 'stale book is prioritized before stale derived price');
  assert.strictEqual(staleSnapshot.blockedReason, 'MARKET_DATA_SNAPSHOT_STALE_BOOK', 'stale book uses exact blocker');
  assert.ok(staleSnapshot.staleFields.includes('price'), 'stale fields include price');

  getMarketDataCache().clear();
  const missing = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: ['BTCUSDT'],
    scannerUniverse: [],
    allowBulkRefresh: false,
  });
  assert.strictEqual(missing.usableForAiMission, false, 'missing scanner candidates block AI mission');
  assert.strictEqual(missing.blockedReason, 'SCANNER_CANDIDATES_NOT_READY', 'missing scanner candidates use exact blocker');
  assert.ok(missing.missingFields.includes('scannerCandidates'), 'missing fields include scannerCandidates');

  forceBinancePublicRequestBudgetForTests(1000);
  const budget = requestMarketDataSnapshot({
    consumerName: 'AI_Command_Center',
    requestedSymbols: ['BTCUSDT'],
    scannerUniverse: [],
    allowBulkRefresh: false,
  });
  assert.strictEqual(budget.usableForAiMission, false, 'budget exhaustion blocks empty AI snapshot');
  assert.strictEqual(budget.readinessState, 'BLOCKED_BUDGET', 'budget exhaustion reports BLOCKED_BUDGET');
  assert.strictEqual(budget.blockedReason, 'MARKET_DATA_BUDGET_EXHAUSTED', 'budget exhaustion uses exact blocker');
} finally {
  getMarketDataCache().clear();
  MarketDataFeed.getInstance().destroy();
  resetBinancePublicCircuitForTests();
}

console.log('Market-data snapshot readiness regression tests PASSED.');
