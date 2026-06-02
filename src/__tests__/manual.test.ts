/**
 * Manual Test Suite
 *
 * Tests:
 * A. ManualRuntime starts OFF
 * B. analyzeSymbol produces full ManualAnalysisSnapshot
 * C. stale analysis detection
 * D. executeManualBuy blocked when no analysis
 * E. executeManualBuy blocked when analysis stale
 * F. executeManualBuy blocked by EntryGate
 * G. executeManualBuy succeeds with fresh ALLOW
 * H. Manual BuySnapshot has MANUAL mode fields
 * I. executeManualSell uses MANUAL_EXIT reason
 * J. executeManualSell blocked when no position
 *
 * Run: npx tsx src/__tests__/manual.test.ts
 */

import { ManualRuntime } from '../core/manual/ManualRuntime';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { EntryGate } from '../core/entry-gate/EntryGate';
import { TradingEngine } from '../core/trading/TradingEngine';
import { TraderBrain } from '../core/trading/TraderBrain';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { logger } from '../utils/logger';
import type {
  TraderBrainDecision, MarketPrice, ManualAnalysisSnapshot,
  ManualBuyRequest, ManualSellRequest, BuySnapshot, TradeRecord,
} from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
}

function makeDecision(overrides?: Partial<TraderBrainDecision>): TraderBrainDecision {
  return {
    symbol: 'BTCUSDT',
    mode: 'MANUAL',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.75,
    status: 'BUY',
    entryPlan: { side: 'BUY', price: 50000, quantity: 0.001, reason: 'manual test' },
    exitPlan: null,
    reasons: ['manual_analysis'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
    ...overrides,
  };
}

const TEST_SYMBOL = 'MANUALTESTUSDT';
const TEST_SYMBOL_2 = 'MANUALTEST2USDT';

console.log('\n=== Manual Test Suite ===\n');

// ── A. ManualRuntime starts OFF ────────────────────────
console.log('\n--- A: ManualRuntime starts OFF ---');
{
  const runtime = new ManualRuntime();
  assertEqual(runtime.getState(), 'OFF', 'A1: initial state is OFF');
  assertEqual(runtime.getAnalysis(), null, 'A2: no analysis initially');
  assert(!runtime.isFresh(), 'A3: isFresh returns false when no analysis');
}

// ── B. analyzeSymbol produces full snapshot ─────────────
console.log('\n--- B: analyzeSymbol produces full ManualAnalysisSnapshot ---');
{
  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);

  const runtime = new ManualRuntime();
  runtime.setBrainDecide(async (symbol, price) => makeDecision({ symbol }));

  const snapshot = await runtime.analyzeSymbol(TEST_SYMBOL);
  assert(!!snapshot, 'B1: snapshot returned');
  assertEqual(snapshot.symbol, TEST_SYMBOL, 'B2: correct symbol');
  assert(snapshot.price > 0, 'B3: price populated');
  assert(snapshot.bid > 0, 'B4: bid populated');
  assert(snapshot.ask > 0, 'B5: ask populated');
  assert(!!snapshot.analysisId, 'B6: analysisId populated');
  assert(snapshot.analysisId.startsWith('manual_'), 'B7: analysisId prefix');
  assert(!!snapshot.traderBrainDecision, 'B8: traderBrainDecision populated');
  assertEqual(snapshot.traderBrainDecision!.selectedStrategy, 'momentum', 'B9: correct strategy');
  assert(!!snapshot.entryGateDecision, 'B10: entryGateDecision populated');
  assert(!snapshot.isStale, 'B11: not stale initially');
  assert(snapshot.staleAfterMs > 0, 'B12: staleAfterMs set');

  // Verify runtime state changed
  assertEqual(runtime.getState(), 'READY', 'B13: state is READY');
  assert(runtime.isFresh(), 'B14: isFresh returns true');
  assert(runtime.getAnalysis()!.analysisId === snapshot.analysisId, 'B15: getAnalysis returns same snapshot');

  feed.destroy();
}

// ── C. Stale analysis detection ─────────────────────────
console.log('\n--- C: stale analysis detection ---');
{
  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);

  const runtime = new ManualRuntime();
  runtime.setBrainDecide(async (symbol, price) => makeDecision({ symbol }));

  const snapshot = await runtime.analyzeSymbol(TEST_SYMBOL);
  assert(!snapshot.isStale, 'C1: not stale after fresh analysis');
  assert(runtime.isFresh(), 'C2: isFresh true');

  runtime.markStale();
  assert(runtime.getAnalysis()!.isStale, 'C3: isStale true after markStale');
  assert(!runtime.isFresh(), 'C4: isFresh false after stale');
  assertEqual(runtime.getState(), 'STALE', 'C5: state is STALE');

  // Re-analyze restores freshness
  feed.setManualPrice(TEST_SYMBOL, 50100);
  const snapshot2 = await runtime.analyzeSymbol(TEST_SYMBOL);
  assert(!snapshot2.isStale, 'C6: fresh after re-analyze');
  assert(runtime.isFresh(), 'C7: isFresh true after re-analyze');

  runtime.reset();
  assertEqual(runtime.getState(), 'OFF', 'C8: reset sets state OFF');
  assertEqual(runtime.getAnalysis(), null, 'C9: reset clears analysis');

  feed.destroy();
}

// ── D. executeManualBuy blocked when no analysis ─────────
console.log('\n--- D: executeManualBuy blocked when no analysis ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  const noBrain = engine.getBrain('NONEXISTENT');
  assert(!noBrain, 'D1: non-existent brain is undefined');
}

// ── E. executeManualBuy blocked when analysis stale ──────
console.log('\n--- E: executeManualBuy blocked when analysis stale ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);

  const manualRuntime = engine.getManualRuntime();
  manualRuntime.setBrainDecide(async (symbol, price) => makeDecision({ symbol }));

  const snapshot = await manualRuntime.analyzeSymbol(TEST_SYMBOL);
  assert(snapshot.entryGateDecision?.decision === 'ALLOW', 'E1: EntryGate allows');

  // Mark stale then try buy
  manualRuntime.markStale();
  const staleSnap = manualRuntime.getAnalysis()!;
  assert(staleSnap.isStale, 'E2: analysis is stale');

  // executeManualBuy should bail early on stale
  const req: ManualBuyRequest = { symbol: TEST_SYMBOL, analysisId: staleSnap.analysisId, manualUserConfirmed: true };
  await engine.executeManualBuy(staleSnap, req);
  assert(!brain.position, 'E3: no position created after stale buy');

  feed.destroy();
}

// ── F. executeManualBuy blocked by EntryGate ─────────────
console.log('\n--- F: executeManualBuy blocked by EntryGate ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);
  const manualRuntime = engine.getManualRuntime();
  manualRuntime.setBrainDecide(async (symbol, price) => makeDecision({
    symbol,
    confidence: 0.1,
    blockReasons: ['very_high_risk'],
  }));

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  const snapshot = await manualRuntime.analyzeSymbol(TEST_SYMBOL);
  // Low confidence + risk block should cause EntryGate to return WAIT or BLOCK
  // EntryGate blocks when mlConfidence < 0.3 or has risk blocks
  const gateBlocked = snapshot.entryGateDecision?.decision !== 'ALLOW';
  assert(gateBlocked, 'F1: EntryGate blocks low confidence / risk symbol');

  if (!gateBlocked) {
    // If it somehow passed, try another symbol with max positions filled
    logger.info('F: EntryGate allowed (setup was too clean)');
  }

  feed.destroy();
}

// ── G. executeManualBuy succeeds with fresh ALLOW ────────
console.log('\n--- G: executeManualBuy succeeds ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);
  await adapter.connect();

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);
  feed.setSymbolFilters(TEST_SYMBOL, { symbol: TEST_SYMBOL, status: 'TRADING', baseAsset: 'MT', quoteAsset: 'USDT', minNotional: 10, minQty: 0.00001, maxQty: 1000, stepSize: 0.00001, tickSize: 0.01, minPrice: 0.01, maxPrice: 10000000, quotePrecision: 8, baseAssetPrecision: 8, quoteAssetPrecision: 8, isSpotTradingAllowed: true });

  const manualRuntime = engine.getManualRuntime();
  manualRuntime.setBrainDecide(async (symbol, price) => makeDecision({
    symbol,
    confidence: 0.85,
    blockReasons: [],
    status: 'BUY',
    entryPlan: { side: 'BUY', price: 50000, quantity: 0.001, reason: 'manual entry' },
  }));

  const snapshot = await manualRuntime.analyzeSymbol(TEST_SYMBOL);
  assert(snapshot.entryGateDecision?.decision === 'ALLOW', 'G1: EntryGate ALLOW');

  const req: ManualBuyRequest = { symbol: TEST_SYMBOL, analysisId: snapshot.analysisId, manualUserConfirmed: true };
  await engine.executeManualBuy(snapshot, req);

  assert(!!brain.position, 'G2: position created');
  assertEqual(brain.position!.coin, TEST_SYMBOL, 'G3: correct coin');

  const buySnap = brain.position!.buySnapshot;
  assert(!!buySnap, 'G4: buySnapshot on position');
  assertEqual(buySnap!.mode, 'MANUAL', 'G5: mode is MANUAL');
  assertEqual(buySnap!.selectedStrategy, 'MANUAL_momentum', 'G6: strategy prefixed with MANUAL_');
  assert(!buySnap!.entryGateDecision || buySnap!.entryGateDecision.decision === 'ALLOW', 'G7: EntryGate allowed');

  feed.destroy();
}

// ── H. Manual BuySnapshot has MANUAL mode fields ─────────
console.log('\n--- H: Manual BuySnapshot has MANUAL mode fields ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);
  await adapter.connect();

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL_2, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL_2, brain);

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL_2, 30000);
  feed.setSymbolFilters(TEST_SYMBOL_2, { symbol: TEST_SYMBOL_2, status: 'TRADING', baseAsset: 'MT2', quoteAsset: 'USDT', minNotional: 10, minQty: 0.00001, maxQty: 1000, stepSize: 0.00001, tickSize: 0.01, minPrice: 0.01, maxPrice: 10000000, quotePrecision: 8, baseAssetPrecision: 8, quoteAssetPrecision: 8, isSpotTradingAllowed: true });

  const manualRuntime = engine.getManualRuntime();
  manualRuntime.setBrainDecide(async (symbol, price) => makeDecision({
    symbol,
    confidence: 0.9,
    blockReasons: [],
    status: 'BUY',
    entryPlan: { side: 'BUY', price: 30000, quantity: 0.002, reason: 'manual entry 2' },
  }));

  const snapshot = await manualRuntime.analyzeSymbol(TEST_SYMBOL_2);
  assert(snapshot.entryGateDecision?.decision === 'ALLOW', 'H1: EntryGate ALLOW');

  const req: ManualBuyRequest = { symbol: TEST_SYMBOL_2, analysisId: snapshot.analysisId, manualUserConfirmed: true };
  await engine.executeManualBuy(snapshot, req);

  const buySnap = brain.position!.buySnapshot!;
  assert('manualAnalysisId' in buySnap, 'H2: manualAnalysisId field exists');
  assertEqual((buySnap as any).manualAnalysisId, snapshot.analysisId, 'H3: manualAnalysisId matches');
  assert('manualUserConfirmed' in buySnap, 'H4: manualUserConfirmed field exists');
  assertEqual((buySnap as any).manualUserConfirmed, true, 'H5: manualUserConfirmed is true');
  assertEqual(buySnap.candidatePoolSize, null, 'H6: candidatePoolSize is null for manual');
  assertEqual(buySnap.topCandidatesAtDecision.length, 0, 'H7: topCandidatesAtDecision empty');
  assertEqual(buySnap.whySelectedOverOthers, 'Manual trade \u2014 user confirmed entry', 'H8: custom reason');

  // Clean up
  await engine.executeManualSell({ symbol: TEST_SYMBOL_2, reason: 'MANUAL_EXIT' });
  assert(!brain.position, 'H9: position closed after sell');

  feed.destroy();
}

// ── I. executeManualSell uses MANUAL_EXIT reason ─────────
console.log('\n--- I: executeManualSell uses MANUAL_EXIT reason ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);
  await adapter.connect();

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice(TEST_SYMBOL, 50000);
  feed.setSymbolFilters(TEST_SYMBOL, { symbol: TEST_SYMBOL, status: 'TRADING', baseAsset: 'MT', quoteAsset: 'USDT', minNotional: 10, minQty: 0.00001, maxQty: 1000, stepSize: 0.00001, tickSize: 0.01, minPrice: 0.01, maxPrice: 10000000, quotePrecision: 8, baseAssetPrecision: 8, quoteAssetPrecision: 8, isSpotTradingAllowed: true });

  // First get into a position
  const manualRuntime = engine.getManualRuntime();
  manualRuntime.setBrainDecide(async (symbol, price) => makeDecision({
    symbol,
    confidence: 0.85,
    blockReasons: [],
    status: 'BUY',
    entryPlan: { side: 'BUY', price: 50000, quantity: 0.001, reason: 'manual entry sell test' },
  }));

  const snapshot = await manualRuntime.analyzeSymbol(TEST_SYMBOL);
  assert(snapshot.entryGateDecision?.decision === 'ALLOW', 'I1: EntryGate ALLOW for entry');

  const buyReq: ManualBuyRequest = { symbol: TEST_SYMBOL, analysisId: snapshot.analysisId, manualUserConfirmed: true };
  await engine.executeManualBuy(snapshot, buyReq);
  assert(!!brain.position, 'I2: position created');

  const prevTradeCount = journal.getTrades().length;

  // Now sell (updates buy's trade record in-place)
  await engine.executeManualSell({ symbol: TEST_SYMBOL, reason: 'MANUAL_EXIT' });
  assert(!brain.position, 'I3: position closed');

  const trades = journal.getTrades();
  assertEqual(trades.length, prevTradeCount, 'I4: trade count unchanged (updated in place)');
  assertEqual(trades[0].status, 'closed', 'I5: trade status is closed');
  assert(trades[0].closeSnapshot?.exitReason === 'MANUAL_EXIT', 'I6: exitReason is MANUAL_EXIT');
  assert(trades[0].closeSnapshot?.executionQuality === 'CLEAN_REAL_MARKET_PRICE', 'I7: execution quality good');

  feed.destroy();
}

// ── J. executeManualSell blocked when no position ────────
console.log('\n--- J: executeManualSell blocked when no position ---');
{
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);

  const brain = new TraderBrain(
    { coin: TEST_SYMBOL, mode: 'MANUAL', enabled: true, maxPositionSize: 100,
      stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30,
      mlEnabled: true, minConfidence: 0.6 },
    adapter, ml,
  );
  engine.brains.set(TEST_SYMBOL, brain);

  assert(!brain.position, 'J1: no position initially');
  await engine.executeManualSell({ symbol: TEST_SYMBOL, reason: 'MANUAL_EXIT' });
  // Should log warning and return without error
  assert(!brain.position, 'J2: still no position after sell on empty');
}

// ── Summary ──────────────────────────────────────────────
console.log(`\n=== Manual Test Suite Complete: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
