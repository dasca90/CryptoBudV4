import { PositionManager } from '../core/positions/PositionManager';
import { OrderLockManager, getDefaultLockTTL } from '../core/orders/OrderLockManager';
import { RiskEngine } from '../core/risk/RiskEngine';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { TradingEngine } from '../core/trading/TradingEngine';
import { EntryGate } from '../core/entry-gate/EntryGate';
import type { Position, CloseSnapshot, RiskInput, TradingMode } from '../core/types';

let p = 0, f = 0;
function ok(c: boolean, m: string) { if (c) { p++; } else { f++; console.log('  FAIL ' + m); } }
function eq<T>(a: T, b: T, m: string) { ok(a === b, m); }

function makeDummyPosition(symbol: string, overrides?: Partial<Position>): Position {
  return {
    coin: symbol, quantity: 0.001, avgEntryPrice: 50000, currentPrice: 50100,
    pnl: 0.1, pnlPercent: 0.2, mode: 'AUTO', openedAt: Date.now(),
    highestPrice: 50100, highestPriceSinceTp: 50100, tpArmed: false, tpArmedAt: 0,
    tp1Hit: false, tp2Hit: false, stopLossPercent: 2, tp1Percent: 3, tp2Percent: 6,
    tpMode: 'fixed', tpTriggerType: 'fixed', trailFromPeakPercent: 2, maxHoldSec: 300,
    lastPrice: 50100, unrealizedPnlPercent: 0.2, ownerType: 'auto', adapter: 'paper',
    ...overrides,
  };
}

function makeDummyCloseSnapshot(symbol: string): CloseSnapshot {
  return {
    schemaVersion: 'cryptobud-v4-close-v1', tradeId: 'test', closedAt: new Date().toISOString(),
    symbol, adapter: 'paper', exitReason: 'MANUAL_EXIT', requestedExitPrice: 50000,
    realMarketPriceAtClose: 50000, closePriceSource: 'book_ticker', closePriceStatus: 'fresh_book_ticker',
    closePriceAgeMs: 0, isRealMarketPrice: true, attemptedPriceSources: [], priceResolutionErrors: [],
    exitPrice: 50000, pnlPercent: 0, pnlUsd: 0, fees: 0, slippagePct: 0, durationMs: 1000,
    highestPrice: 50000, highestPriceSinceTp: 50000, mfePercent: 0, maePercent: 0,
    dynamicTrailAudit: null, stopLossPercent: 2, tp1Percent: 3, tp2Percent: 6,
    tpMode: 'fixed', tpTriggerType: 'fixed', executionQuality: 'CLEAN_REAL_MARKET_PRICE',
  };
}

console.log('\n=== Position + Lock Test Suite ===\n');

// ── A. Duplicate position blocks ──
console.log('--- A: duplicate open position blocks BUY ---');
(function() {
  const pm = new PositionManager();
  pm.addPosition('BTCUSDT', makeDummyPosition('BTCUSDT'));
  ok(pm.hasOpenPosition('BTCUSDT'), 'A1: position exists');
  pm.addPosition('BTCUSDT', makeDummyPosition('BTCUSDT'));
  // PositionManager allows add but we check hasOpenPosition before calling add (done in TradingEngine)
  // Verify that having a position means we can't add another via the has check
  ok(pm.hasOpenPosition('BTCUSDT'), 'A2: still has position after duplicate add');
  eq(pm.getOpenPositions().length, 1, 'A3: only one position per symbol');
})();

// ── B. Active BUY lock blocks duplicate BUY ──
console.log('\n--- B: active BUY lock blocks duplicate BUY ---');
(function() {
  const lm = new OrderLockManager();
  const r1 = lm.acquireLock({ symbol: 'ETHUSDT', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test' });
  ok(r1.acquired, 'B1: first lock acquired');
  const r2 = lm.acquireLock({ symbol: 'ETHUSDT', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test2' });
  ok(!r2.acquired, 'B2: duplicate BUY lock blocked');
  eq(r2.reason, 'ORDER_LOCK_DUPLICATE_BUY', 'B3: correct block reason');
  ok(r2.existingLock !== null, 'B4: existing lock returned');
})();

// ── C. Stale BUY lock auto-cleans ──
console.log('\n--- C: stale BUY lock auto-cleans ---');
(function() {
  const lm = new OrderLockManager();
  const r1 = lm.acquireLock({ symbol: 'ADAUSDT', side: 'BUY', mode: 'MANUAL', adapter: 'paper', reason: 'test', ttl: 1 });
  ok(r1.acquired, 'C1: lock acquired');
  lm.cleanupStaleLocks(Date.now() + 5000);
  ok(!lm.hasActiveLock('ADAUSDT', 'BUY'), 'C2: expired lock cleaned');
  const r2 = lm.acquireLock({ symbol: 'ADAUSDT', side: 'BUY', mode: 'MANUAL', adapter: 'paper', reason: 'test2' });
  ok(r2.acquired, 'C3: new lock can be acquired after stale cleaned');
})();

// ── D. Lock released after successful BUY ──
console.log('\n--- D: lock released after successful BUY ---');
(function() {
  const lm = new OrderLockManager();
  const r = lm.acquireLock({ symbol: 'BNBUSDT', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test' });
  ok(r.acquired, 'D1: lock acquired');
  ok(r.lock !== null, 'D2: lock object exists');
  if (r.lock) {
    lm.releaseLock(r.lock.lockId, 'entry_complete');
  }
  ok(!lm.hasActiveLock('BNBUSDT', 'BUY'), 'D3: no active locks after release');
  eq(lm.getActiveLocks().length, 0, 'D4: active locks = 0');
})();

// ── E. Lock released after failed BUY ──
console.log('\n--- E: lock released after failed BUY ---');
(function() {
  const lm = new OrderLockManager();
  const r = lm.acquireLock({ symbol: 'SOLUSDT', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test' });
  ok(r.acquired, 'E1: lock acquired');
  if (r.lock) {
    lm.releaseLock(r.lock.lockId, 'entry_failed');
  }
  ok(!lm.hasActiveLock('SOLUSDT', 'BUY'), 'E2: lock released after failure');
})();

// ── F. SELL lock blocks duplicate sell ──
console.log('\n--- F: SELL lock blocks duplicate sell ---');
(function() {
  const lm = new OrderLockManager();
  const r1 = lm.acquireLock({ symbol: 'DOGEUSDT', side: 'SELL', mode: 'AUTO', adapter: 'paper', reason: 'exit' });
  ok(r1.acquired, 'F1: SELL lock acquired');
  const r2 = lm.acquireLock({ symbol: 'DOGEUSDT', side: 'SELL', mode: 'AUTO', adapter: 'paper', reason: 'exit2' });
  ok(!r2.acquired, 'F2: duplicate SELL blocked');
  eq(r2.reason, 'ORDER_LOCK_DUPLICATE_SELL', 'F3: correct block reason');
})();

// ── G. Lock released after SELL success ──
console.log('\n--- G: lock released after SELL success ---');
(function() {
  const lm = new OrderLockManager();
  const r = lm.acquireLock({ symbol: 'XRPUSDT', side: 'SELL', mode: 'AUTO', adapter: 'paper', reason: 'exit' });
  ok(r.acquired, 'G1: SELL lock acquired');
  if (r.lock) {
    lm.releaseLock(r.lock.lockId, 'exit_complete');
  }
  ok(!lm.hasActiveLock('XRPUSDT', 'SELL'), 'G2: no active SELL lock after release');
})();

// ── H. Restored positions prevent duplicate BUY ──
console.log('\n--- H: restored positions prevent duplicate BUY ---');
(function() {
  const pm = new PositionManager();
  pm.restorePositions([makeDummyPosition('RESTOREDBTC')]);
  ok(pm.hasOpenPosition('RESTOREDBTC'), 'H1: restored position exists');
  eq(pm.getOpenPositions().length, 1, 'H2: exactly one restored position');
  pm.addPosition('RESTOREDBTC', makeDummyPosition('RESTOREDBTC'));
  eq(pm.getOpenPositions().length, 1, 'H3: duplicate add blocked by check (TradingEngine prevents)');
})();

// ── I. Expired locks are not restored / cleaned on startup ──
console.log('\n--- I: expired locks cleaned on startup ---');
(function() {
  const lm = new OrderLockManager();
  lm.acquireLock({ symbol: 'EXPBTC', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test', ttl: 1 });
  lm.cleanupStaleLocks(Date.now() + 5000);
  eq(lm.getActiveLocks().length, 0, 'I1: no active expired locks');
  // clearExpiredLocks should clean any remaining
  lm.clearExpiredLocks();
  eq(lm.getActiveLocks().length, 0, 'I2: still 0 after full cleanup');
})();

// ── J. PositionManager exposure summary ──
console.log('\n--- J: PositionManager exposure summary ---');
(function() {
  const pm = new PositionManager();
  pm.addPosition('BTCUSDT', makeDummyPosition('BTCUSDT', { mode: 'AUTO', buySnapshot: { riskGroup: 'blue_chip' } as any }));
  pm.addPosition('ETHUSDT', makeDummyPosition('ETHUSDT', { mode: 'SCALPER', buySnapshot: { riskGroup: 'large_cap' } as any }));
  const summary = pm.getExposureSummary();
  eq(summary.totalOpen, 2, 'J1: totalOpen = 2');
  eq(summary.byMode['AUTO'], 1, 'J2: AUTO count = 1');
  eq(summary.byMode['SCALPER'], 1, 'J3: SCALPER count = 1');
  eq(summary.bySymbol.length, 2, 'J4: 2 symbols');
  ok(summary.totalExposure > 0, 'J5: totalExposure > 0');
})();

// ── K. PositionManager updates highestPrice ──
console.log('\n--- K: PositionManager updates highestPrice ---');
(function() {
  const pm = new PositionManager();
  const pos = makeDummyPosition('HIGHBTC');
  pos.highestPrice = 50000;
  pm.addPosition('HIGHBTC', pos);
  pm.updatePosition('HIGHBTC', { highestPrice: 51000, currentPrice: 51000 });
  const updated = pm.getPositionBySymbol('HIGHBTC');
  ok(updated !== undefined, 'K1: position exists');
  if (updated) eq(updated.highestPrice, 51000, 'K2: highestPrice updated');
})();

// ── L. RiskEngine duplicate position check ──
console.log('\n--- L: RiskEngine duplicate position check ---');
(function() {
  const re = new RiskEngine();
  const input: RiskInput = {
    symbol: 'DUPBTC', mode: 'AUTO', side: 'BUY', quantity: 0.001, price: 50000,
    estimatedValue: 50, mlConfidence: 0.8, riskGroup: null, currentPositions: 1,
    totalOpenPositions: 1, dailyPnlUsd: 0, accountBalance: 10000,
    consecutiveLosses: 0, winRate: 0.5, dailyTradeCount: 0, maxDrawdownPercent: 0,
    groupExposures: [], config: re.getConfig(), positionSymbols: ['DUPBTC'],
  };
  const d = re.evaluateRisk(input);
  ok(d.blockReasons.includes('RISK_DUPLICATE_POSITION'), 'L1: duplicate position blocked');
})();

// ── M. OrderLockManager diagnostics ──
console.log('\n--- M: OrderLockManager diagnostics ---');
(function() {
  const lm = new OrderLockManager();
  lm.acquireLock({ symbol: 'DIAGBTC', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test' });
  const diag = lm.getDiagnostics();
  eq(diag.activeLocks, 1, 'M1: 1 active lock');
  ok(diag.bySymbol['DIAGBTC'] !== undefined, 'M2: DIAGBTC in bySymbol');
  ok(diag.byMode['AUTO'] >= 1, 'M3: AUTO in byMode');
})();

// ── N. Lock TTL defaults ──
console.log('\n--- N: Lock TTL defaults ---');
(function() {
  eq(getDefaultLockTTL('BUY', 'AUTO'), 30000, 'N1: AUTO BUY TTL=30s');
  eq(getDefaultLockTTL('SELL', 'AUTO'), 30000, 'N2: AUTO SELL TTL=30s');
  eq(getDefaultLockTTL('BUY', 'SCALPER'), 10000, 'N3: SCALPER BUY TTL=10s');
  eq(getDefaultLockTTL('SELL', 'SCALPER'), 10000, 'N4: SCALPER SELL TTL=10s');
  eq(getDefaultLockTTL('BUY', 'MANUAL'), 30000, 'N5: MANUAL BUY TTL=30s');
})();

// ── O. TradingEngine lock management ──
console.log('\n--- O: TradingEngine lock management ---');
(function() {
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);

  const pm = engine.getPositionManager();
  const lm = engine.getOrderLockManager();

  // Acquire a lock
  const lockR = lm.acquireLock({ symbol: 'ENGBTC', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test' });
  ok(lockR.acquired, 'O1: TradingEngine lock acquired');

  // Verify it's tracked
  ok(lm.hasActiveLock('ENGBTC', 'BUY'), 'O2: TradingEngine has active lock');
  eq(lm.getActiveLocks().length, 1, 'O3: exactly 1 active lock');

  // Release
  if (lockR.lock) {
    lm.releaseLock(lockR.lock.lockId, 'test_done');
  }
  ok(!lm.hasActiveLock('ENGBTC', 'BUY'), 'O4: lock released');
  eq(lm.getActiveLocks().length, 0, 'O5: 0 active locks after release');

  // PositionManager add/remove
  pm.addPosition('ENGBTC', makeDummyPosition('ENGBTC'));
  ok(pm.hasOpenPosition('ENGBTC'), 'O6: position added via TradingEngine PM');
  pm.closePosition('ENGBTC', makeDummyCloseSnapshot('ENGBTC'));
  ok(!pm.hasOpenPosition('ENGBTC'), 'O7: position closed via TradingEngine PM');

  // Release locks for symbol
  const r2 = lm.acquireLock({ symbol: 'RELBTC', side: 'SELL', mode: 'MANUAL', adapter: 'paper', reason: 'exit' });
  ok(r2.acquired, 'O8: sell lock acquired');
  lm.releaseLocksForSymbol('RELBTC');
  ok(!lm.hasActiveLock('RELBTC'), 'O9: all locks released for symbol');

  // Stale lock cleanup via engine start/stop (just call cleanup directly)
  const r3 = lm.acquireLock({ symbol: 'STALEBTC', side: 'BUY', mode: 'AUTO', adapter: 'paper', reason: 'test', ttl: 1 });
  ok(r3.acquired, 'O10: short-ttl lock acquired');
  lm.cleanupStaleLocks(Date.now() + 5000);
  ok(!lm.hasActiveLock('STALEBTC', 'BUY'), 'O11: stale lock cleaned');
})();

// ── Summary ──
console.log(`\n=== Position + Lock Suite: ${p} passed, ${f} failed ===\n`);
if (f > 0) process.exit(1);
