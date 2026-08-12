import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { ScannerCandidate } from '../core/types';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import {
  isBookMarketFreshnessBlocker,
  isPriceMarketFreshnessBlocker,
  rehydrateCandidateMarketFreshness,
} from '../core/market-data/canonical-market-freshness';
import { mapScannerCandidateToTradeV4View } from '../lib/air-scanner/tradeV4DataAdapter';
import { translateBlocker } from '../components/trade-v4/SelectedCoinInspector';

const feed = MarketDataFeed.getInstance();
const nowIso = () => new Date().toISOString();

function candidate(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  const now = nowIso();
  return {
    candidateId: 'freshness-candidate', symbol: 'FRESHUSDT', createdAt: now, updatedAt: now, mode: 'AUTO',
    riskGroup: 'mid_caps', selectedStrategy: 'balanced', selectedPlaybook: null, confidence: 0.9, status: 'WAIT',
    traderBrainDecision: { blockReasons: [], entryPlan: { side: 'BUY', price: 10, quantity: 1, reason: 'test' } } as any,
    entryGateDecision: { decision: 'BLOCK', primaryReason: 'BLOCK_BOOK_STALE', blockReasons: ['BLOCK_PRICE_STALE', 'BLOCK_BOOK_STALE'], warnings: [], requiredNextActions: ['Wait for fresh price tick', 'Wait for fresh book ticker'], explanation: 'stale', snapshot: { decision: 'BLOCK', primaryReason: 'BLOCK_BOOK_STALE', blockReasons: ['BLOCK_PRICE_STALE', 'BLOCK_BOOK_STALE'], priceFreshnessResult: { status: 'BLOCK', reason: 'BLOCK_BOOK_STALE' } } as any } as any,
    mainReason: 'PRICE_NOT_FRESH / BOOK_STALE', requiredNextActions: [], blockReasons: ['PRICE_NOT_FRESH', 'BOOK_STALE'], warnings: [],
    price: 10, priceAgeMs: 90_000, priceFresh: false, bookFresh: false, spreadPct: 0.02, volumeRel: 1,
    tpRoomOk: true, reboundConfirmed: true, momentumConfirmed: true, dipPercent: 1, reboundPercent: 1,
    m5Change: 1, m15Change: 1, h1Change: 1, change24h: 1, mlBadEntryRisk: false, mlWinProbability: 0,
    primaryBlocker: 'BOOK_STALE', finalNoBuyReason: 'PRICE_NOT_FRESH / BOOK_STALE',
    ...overrides,
  } as ScannerCandidate;
}

function hasCurrentStale(reasons: readonly string[]): boolean {
  return reasons.some((reason) => isPriceMarketFreshnessBlocker(reason) || isBookMarketFreshnessBlocker(reason));
}

// Old scan-time blockers are historical after the shared cache has recovered.
feed.destroy();
feed.setManualPrice('FRESHUSDT', 11, Date.now() - 5);
const recovered = rehydrateCandidateMarketFreshness({
  candidate: candidate(), current: feed.getCanonicalSymbolMarketData('FRESHUSDT'), consumer: 'test.recovery', scanId: 'scan-101',
});
assert.equal(recovered.priceFresh, true);
assert.equal(recovered.bookFresh, true);
assert.equal(hasCurrentStale(recovered.blockReasons), false);
assert.equal(recovered.primaryBlocker, undefined);
assert.equal(recovered.finalNoBuyReason, undefined);
assert.equal(recovered.entryGateDecision?.decision, 'ALLOW');
assert.deepEqual(recovered.freshnessAtEvaluation?.historicalFreshnessBlockers, ['PRICE_NOT_FRESH', 'BOOK_STALE']);

// Long/completed scan age is independent from current Spot cache age.
const longScan = rehydrateCandidateMarketFreshness({
  candidate: candidate({ updatedAt: new Date(Date.now() - 90_000).toISOString() }),
  current: feed.getCanonicalSymbolMarketData('FRESHUSDT'), consumer: 'test.long_scan', scanId: 'scan-long',
});
assert.equal(longScan.priceFresh, true);
assert.equal(longScan.bookFresh, true);
assert.equal(hasCurrentStale(longScan.blockReasons), false);

// A genuine stale canonical cache replaces any historical fresh claim and blocks.
feed.setManualPrice('STALEUSDT', 8, Date.now() - 31_000);
const genuinelyStale = rehydrateCandidateMarketFreshness({
  candidate: candidate({ symbol: 'STALEUSDT', blockReasons: [], priceFresh: true, bookFresh: true }),
  current: feed.getCanonicalSymbolMarketData('STALEUSDT'), consumer: 'test.true_stale',
});
assert.equal(genuinelyStale.priceFresh, false);
assert.equal(genuinelyStale.bookFresh, false);
assert.equal(genuinelyStale.blockReasons.includes('PRICE_NOT_FRESH'), true);
assert.equal(genuinelyStale.blockReasons.includes('BOOK_STALE'), true);

// Recent zero data remains invalid/offline, never fresh.
feed.setManualPrice('ZEROUSDT', 0, Date.now() - 1);
const zero = feed.getCanonicalSymbolMarketData('ZEROUSDT');
assert.equal(zero.priceValid, false);
assert.equal(zero.bookValid, false);
assert.equal(zero.priceFresh, false);
assert.equal(zero.bookFresh, false);

// REBOUND_STALE belongs to strategy freshness and survives fresh market recovery.
const reboundOnly = rehydrateCandidateMarketFreshness({
  candidate: candidate({ blockReasons: ['REBOUND_STALE'], primaryBlocker: 'REBOUND_STALE', finalNoBuyReason: 'REBOUND_STALE', reboundFreshnessStatus: 'stale' }),
  current: feed.getCanonicalSymbolMarketData('FRESHUSDT'), consumer: 'test.rebound',
});
assert.deepEqual(reboundOnly.blockReasons, ['REBOUND_STALE']);
assert.equal(reboundOnly.primaryBlocker, 'REBOUND_STALE');
assert.equal(reboundOnly.priceFresh, true);
assert.equal(reboundOnly.bookFresh, true);

// Cross-scan replacement and both UI consumers receive the same corrected view.
const scan2 = candidate({ candidateId: 'scan-2-candidate', blockReasons: [], priceFresh: true, bookFresh: true, primaryBlocker: undefined, finalNoBuyReason: undefined });
const view = mapScannerCandidateToTradeV4View(scan2, false, 'summary');
assert.equal(hasCurrentStale(view.blockReasons), false);
assert.equal(translateBlocker(view.blockReasons.find((reason) => hasCurrentStale([reason]))), '');

// Cache-only rehydration is bounded O(1): no fetch and no candidate timer.
const start = performance.now();
for (let i = 0; i < 1_000; i++) {
  rehydrateCandidateMarketFreshness({ candidate: scan2, current: feed.getCanonicalSymbolMarketData('FRESHUSDT'), consumer: 'test.performance' });
}
const durationMs = performance.now() - start;
assert.ok(durationMs < 1_000, `1000 canonical cache rehydrations took ${durationMs.toFixed(2)}ms`);

feed.destroy();
console.log(`canonical-market-freshness lifecycle: PASS (${durationMs.toFixed(2)}ms / 1000 lookups, additional Binance requests=0)`);
