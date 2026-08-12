import assert from 'node:assert/strict';
import { buildClientOrderId, executionEventKey, normalizeExchangeOrderState } from '../core/execution/ExecutionLifecycle';
import { ExecutionPersistence, type ExecutionStorage } from '../core/execution/ExecutionPersistence';
import { TradingRuntimeHealth } from '../core/execution/TradingRuntimeHealth';
import { ExecutionReconciliationService } from '../core/execution/ExecutionReconciliationService';
import { PositionManager } from '../core/positions/PositionManager';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';
import type { OrderResult, Position } from '../core/types';
import { assessPostFillPriceDeviation } from '../core/execution/PostFillAccounting';
import { readFileSync } from 'node:fs';

class MemoryStorage implements ExecutionStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('FAULT_INJECTION_PERSISTENCE_UNAVAILABLE');
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
const persistence = new ExecutionPersistence(storage);
const clientOrderId = buildClientOrderId('trade-1', 'SOLUSDT', 'BUY');
assert.equal(clientOrderId, buildClientOrderId('trade-1', 'SOLUSDT', 'BUY'));
assert.notEqual(clientOrderId, buildClientOrderId('trade-2', 'SOLUSDT', 'BUY'));
assert.ok(clientOrderId.length <= 36);

const intentInput = { tradeId: 'trade-1', clientOrderId, symbol: 'SOLUSDT', side: 'BUY' as const, requestedQty: 100, executionMode: 'AUTO' as const, executionAdapter: 'Binance Live', owner: 'AUTOBOTS', strategyAtEntry: 'momentum' };
assert.equal(persistence.createIntent(intentInput).status, 'LOCAL_INTENT_CREATED');
assert.throws(() => persistence.createIntent(intentInput), /DUPLICATE_CLIENT_ORDER_ID/);

const partialKey = executionEventKey({ clientOrderId, exchangeOrderId: '42', status: 'PARTIALLY_FILLED', executedQty: 37, avgFillPrice: 100 });
const partial = persistence.transition(clientOrderId, 'PARTIALLY_FILLED', { exchangeOrderId: '42', executedQty: 37, remainingQty: 63, avgFillPrice: 100, reconciliationRequired: true }, partialKey);
assert.equal(partial.record.executedQty, 37);
assert.equal(partial.record.remainingQty, 63);
assert.equal(persistence.getUnresolved().length, 1, 'partial fill remains under reconciliation until terminal exchange state');
assert.equal(persistence.transition(clientOrderId, 'PARTIALLY_FILLED', {}, partialKey).duplicate, true);
assert.equal(normalizeExchangeOrderState('CANCELED', 37), 'PARTIALLY_FILLED');
assert.equal(normalizeExchangeOrderState('FILLED', 100), 'FILLED');
assert.equal(normalizeExchangeOrderState('UNKNOWN_AFTER_TIMEOUT', 0), 'UNKNOWN_AFTER_TIMEOUT');
const deviation = assessPostFillPriceDeviation(106, 100);
assert.equal(deviation.anomaly, 'POST_FILL_PRICE_DEVIATION_CRITICAL');
assert.equal(deviation.positionAccountingRequired, true, 'post-fill deviation cannot discard exposure');
const engineSource = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
assert.ok(!engineSource.includes('ENTRY_PRICE_DEVIATION_BLOCKED'), 'legacy post-fill deviation blocker is removed');
assert.ok(engineSource.includes('positionCreateAllowed=true'), 'post-fill anomalies explicitly preserve position accounting');

const pm = new PositionManager();
const makePosition = (quantity: number, avgEntryPrice: number, fillState: 'PARTIALLY_FILLED' | 'FILLED'): Position => ({
  coin: 'SOLUSDT', tradeId: 'trade-1', quantity, avgEntryPrice, currentPrice: avgEntryPrice, pnl: 0, pnlPercent: 0,
  mode: 'AUTO', openedAt: 1, highestPrice: avgEntryPrice, highestPriceSinceTp: avgEntryPrice, tpArmed: false,
  tpArmedAt: 0, tp1Hit: false, tp2Hit: false, stopLossPercent: 2, tp1Percent: 3, tp2Percent: 0,
  tpMode: 'fixed_single', tpTriggerType: 'tp1', trailFromPeakPercent: 0.5, maxHoldSec: 86400,
  lastPrice: avgEntryPrice, unrealizedPnlPercent: 0, ownerType: 'scanner', adapter: 'Binance Live',
  clientOrderId, exchangeOrderId: '42', requestedQuantity: 100, remainingQuantity: 100 - quantity,
  fillState, executionAdapter: 'Binance Live', buySnapshot: { tradeId: 'trade-1', ownerName: 'AUTOBOTS' } as any,
});
assert.equal(pm.upsertExecutionPosition('SOLUSDT', makePosition(37, 100, 'PARTIALLY_FILLED')).created, true);
assert.equal(pm.upsertExecutionPosition('SOLUSDT', makePosition(37, 100, 'PARTIALLY_FILLED')).changed, false);
assert.equal(pm.upsertExecutionPosition('SOLUSDT', makePosition(100, 101, 'FILLED')).created, false);
assert.equal(pm.getPositionBySymbol('SOLUSDT')?.quantity, 100);
assert.equal(pm.getOpenPositions().length, 1);
assert.throws(() => pm.upsertExecutionPosition('SOLUSDT', makePosition(10, 101, 'PARTIALLY_FILLED')), /NON_MONOTONIC/);

persistence.transition(clientOrderId, 'FILLED', { executedQty: 100, remainingQty: 0, avgFillPrice: 101, positionAccounted: true, journalAccounted: true, exitManagementAttached: true });
assert.equal(new ExecutionPersistence(storage).get(clientOrderId)?.executedQty, 100);
const canonicalRecord = persistence.get(clientOrderId)!;
const duplicateJournal = { getTrades: () => [{ tradeId: 'trade-1' }, { tradeId: 'trade-1' }] } as any;
const compareService = new ExecutionReconciliationService(persistence, pm, duplicateJournal, {} as any, new TradingRuntimeHealth());
pm.updatePosition('SOLUSDT', { quantity: 99, avgEntryPrice: 102 });
const mismatchKinds = compareService.compareLocal(canonicalRecord).map(issue => issue.classification);
assert.ok(mismatchKinds.includes('QUANTITY_MISMATCH'));
assert.ok(mismatchKinds.includes('PRICE_MISMATCH'));
assert.ok(mismatchKinds.includes('DUPLICATE_JOURNAL_TRADE'));
pm.updatePosition('SOLUSDT', { quantity: 100, avgEntryPrice: 101 });

const health = new TradingRuntimeHealth();
health.requireReconciliation('FAULT_INJECTION');
assert.equal(health.getSnapshot().newBuysAllowed, false);
assert.equal(health.getSnapshot().exitEngineEnabled, true);
assert.equal(health.getSnapshot().manualCloseAllowed, true);

const unknownStorage = new MemoryStorage();
const unknownPersistence = new ExecutionPersistence(unknownStorage);
const unknownId = buildClientOrderId('trade-timeout', 'ETHUSDT', 'BUY');
unknownPersistence.createIntent({ tradeId: 'trade-timeout', clientOrderId: unknownId, symbol: 'ETHUSDT', side: 'BUY', requestedQty: 1, executionMode: 'AUTO', executionAdapter: 'Binance Live', owner: 'AUTOBOTS', strategyAtEntry: 'balanced' });
unknownPersistence.transition(unknownId, 'UNKNOWN_AFTER_TIMEOUT', { reconciliationRequired: true });
const queriedFill: OrderResult = { orderId: '99', clientOrderId: unknownId, coin: 'ETHUSDT', side: 'BUY', quantity: 1, requestedQuantity: 1, remainingQuantity: 0, price: 2000, status: 'filled', timestamp: Date.now() };
const adapter = {
  name: 'Binance Live', isLive: true, connect: async () => {}, disconnect: async () => {},
  getMarketPrice: async () => ({ coin: 'ETHUSDT', bid: 1999, ask: 2001, last: 2000, timestamp: Date.now() }),
  submitOrder: async () => { throw new Error('must not retry'); }, cancelOrder: async () => false,
  getBalances: async () => [], getOpenOrders: async () => [], getAccountInfo: async () => ({ canTrade: true, isLive: true }),
  getOrder: async () => queriedFill,
} satisfies ExchangeAdapter;
const timeoutHealth = new TradingRuntimeHealth();
const reconciliation = new ExecutionReconciliationService(unknownPersistence, new PositionManager(), { getTrades: () => [] } as any, adapter, timeoutHealth);
const issues = await reconciliation.reconcilePendingOrders();
assert.ok(issues.some(issue => issue.classification === 'POSITION_MISSING'));
assert.equal(unknownPersistence.get(unknownId)?.status, 'FILLED');
assert.equal(timeoutHealth.canOpenNewBuy(), false);

const failingStorage = new MemoryStorage();
failingStorage.failWrites = true;
assert.throws(() => new ExecutionPersistence(failingStorage).createIntent({ ...intentInput, clientOrderId: 'fault-id' }), /FAULT_INJECTION/);

console.log('live execution hardening tests passed');
