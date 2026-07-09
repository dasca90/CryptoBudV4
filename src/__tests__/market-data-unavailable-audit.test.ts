import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveClosePrice, formatClosePriceUnavailableAudit } from '../core/market-data/close-price-resolver';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { resolveTopCandidateDisplay } from '../components/trade-v4/topCandidatesPanelModel';
import type { TradeV4CandidateView } from '../components/trade-v4/types';

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function candidate(overrides: Partial<TradeV4CandidateView> = {}): TradeV4CandidateView {
  return {
    candidateId: 'c_MDATA',
    symbol: 'MDATAUSDT',
    price: 1,
    rank: 1,
    score: 90,
    confidenceSource: 'test',
    source: 'dipper',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    status: 'BUY',
    engineState: 'detected',
    confidence: 70,
    spreadPct: 0.1,
    volumeRel: 1,
    dipPct: 0,
    reboundPct: 1,
    tpRoomPct: 2,
    momentum: 1,
    mainReason: 'BLOCK_MARKET_DATA_OFFLINE',
    requiredNextAction: null,
    blockReasons: ['BLOCK_MARKET_DATA_OFFLINE'],
    mlBadEntryRisk: null,
    dataQuality: 'BAD',
    isOrderLocked: false,
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'BLOCK_MARKET_DATA_OFFLINE',
    ...overrides,
  };
}

const feed = MarketDataFeed.getInstance();
const originalFetch = globalThis.fetch;

feed.destroy();
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes('/ticker/bookTicker')) return mockResponse({ bidPrice: '0', askPrice: '0' });
  if (u.includes('/ticker/price')) return mockResponse({ symbol: 'FRESHUSDT', price: '12.34' });
  return mockResponse({});
}) as typeof fetch;

const restFallback = await resolveClosePrice('FRESHUSDT', 'SELL');
assert.equal(restFallback.source, 'rest_ticker', 'safe resolver uses fresh REST fallback when book ticker is missing');
assert.equal(restFallback.price, 12.34);
assert.equal(restFallback.isFresh, true);
assert.equal(restFallback.isRealMarketPrice, true);

feed.destroy();
feed.setManualPrice('STALEUSDT', 9.99, Date.now() - 120000);
globalThis.fetch = (async () => {
  throw new Error('binance offline');
}) as typeof fetch;

const unavailable = await resolveClosePrice('STALEUSDT', 'SELL', {
  lastKnownPrice: 9.88,
  lastKnownPriceAt: Date.now() - 120000,
  entrySnapshotPrice: 8.88,
});
assert.equal(unavailable.source, 'unavailable', 'stale fallback is not used for exit');
assert.equal(unavailable.price, 0);
assert.ok(unavailable.sourceDiagnostics?.some((d) => d.source === 'entrySnapshot fallback' && d.available && !d.fresh), 'entry snapshot is recorded as diagnostic only');
const closeAudit = formatClosePriceUnavailableAudit({
  resolution: unavailable,
  symbol: 'STALEUSDT',
  positionId: 'pos_1',
  executionMode: 'DEMO',
  exitTickSkipped: true,
});
assert.ok(closeAudit.includes('CLOSE_PRICE_UNAVAILABLE_AUDIT'), 'close price unavailable audit is formatted');
assert.ok(closeAudit.includes('book_ticker'), 'audit includes book ticker source');
assert.ok(closeAudit.includes('position.lastKnownPrice'), 'audit includes position last known source');
assert.ok(closeAudit.includes('exitTickSkipped=true'), 'audit proves exit tick was skipped without crashing');

const marketDataBlocked = resolveTopCandidateDisplay({ candidate: candidate() });
assert.notEqual(marketDataBlocked.status, 'BUY', 'BUY + finalExecutable false does not display BUY');
assert.equal(marketDataBlocked.reasonText, 'BUY-ready, but market data unavailable. Waiting for fresh price.');

const staleReady = resolveTopCandidateDisplay({
  candidate: candidate({ finalExecutable: true, buyAllowed: true }),
  executionSelected: false,
  executionSkipped: true,
  executionSkipReason: 'BLOCK_MARKET_DATA_OFFLINE',
});
assert.equal(staleReady.whyLabel, 'BUY-ready, but market data unavailable. Waiting for fresh price.');

for (const [file, needle] of [
  ['src/core/market-data/BinancePublicClient.ts', 'BINANCE_REQUEST_HEALTH_AUDIT'],
  ['src/core/scanner/MarketScanner.ts', 'BUY_MARKET_DATA_OFFLINE_AUDIT'],
  ['src/core/scanner/MarketScanner.ts', 'CONFIDENCE_SCALE_MISMATCH_AUDIT'],
  ['src/components/trade-v4/OpenPositionsPanel.tsx', 'Exit check skipped - no fresh close price.'],
] as const) {
  assert.ok(readFileSync(file, 'utf8').includes(needle), `${needle} is wired in ${file}`);
}

const closeResolverSource = readFileSync('src/core/market-data/close-price-resolver.ts', 'utf8');
assert.ok(closeResolverSource.includes('entry_snapshot_not_allowed_for_real_exit'), 'entry snapshot fallback is documented as not allowed for real exit');
assert.ok(!closeResolverSource.includes("source: 'trigger_fallback'"), 'old trigger fallback is not used for close price resolution');

globalThis.fetch = originalFetch;
feed.destroy();
console.log('market-data-unavailable-audit.test.ts passed');
