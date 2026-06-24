import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from '../core/persistence/Journal';
import type { Position, TradeRecord } from '../core/types';

const root = process.cwd();
const journalSource = readFileSync(join(root, 'src', 'core', 'persistence', 'Journal.ts'), 'utf8');
const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');

assert.ok(journalSource.includes('OPEN_POSITION_STORE_RECONCILIATION_AUDIT'), 'Journal emits open-position store reconciliation audit');
assert.ok(journalSource.includes('writeOpenPosFallback(canonicalRows)'), 'reconciliation rewrites primary and backup from PositionManager canonical rows');
assert.ok(appSource.includes('reconcileOpenPositionsToPositionManager'), 'App invokes open-position reconciliation after runtime state changes');
assert.ok(appSource.includes('paper_balance_sync'), 'paper balance sync repairs stale open-position store mismatches');
assert.ok(appSource.includes('startup_hydration'), 'startup hydration repairs stale open-position store mismatches');

class LocalStorageMock {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

(globalThis as any).localStorage = new LocalStorageMock();

function position(index: number): Position {
  const symbol = `COIN${index}USDT`;
  const tradeId = `trade-${index}`;
  return {
    coin: symbol,
    quantity: 1,
    avgEntryPrice: 10 + index,
    currentPrice: 10 + index,
    pnl: 0,
    pnlPercent: 0,
    mode: 'AUTO',
    openedAt: Date.now() - index * 1000,
    tradeId,
    highestPrice: 10 + index,
    highestPriceSinceTp: 10 + index,
    tpArmed: false,
    tpArmedAt: 0,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 2,
    tp1Percent: 1,
    tp2Percent: 2,
    tpMode: 'fixed',
    tpTriggerType: 'mark',
    trailFromPeakPercent: 1,
    maxHoldSec: 3600,
    lastPrice: 10 + index,
    unrealizedPnlPercent: 0,
    ownerType: 'AutoBots',
    adapter: 'paper',
  };
}

function openTrade(index: number): TradeRecord {
  const p = position(index);
  return {
    tradeId: p.tradeId!,
    coin: p.coin,
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'paper',
    entryPrice: p.avgEntryPrice,
    quantity: p.quantity,
    entryTime: new Date(p.openedAt).toISOString(),
    status: 'open',
    strategy: 'balanced',
  };
}

const journal = new Journal();
journal.markOpenPositionsHydrated();
for (let i = 1; i <= 15; i += 1) {
  await journal.recordTrade(openTrade(i));
  await journal.saveOpenPosition(`trade-${i}`, `COIN${i}USDT`, JSON.stringify(position(i)));
}

const canonicalPositions = Array.from({ length: 11 }, (_, i) => position(i + 1));
const audit = await journal.reconcileOpenPositionsToPositionManager(canonicalPositions, 'regression_test_close_4_positions');
assert.equal(audit.positionManagerOpenCount, 11);
assert.equal(audit.storeOpenCount, 15);
assert.deepEqual(audit.staleStorePositionIds.sort(), ['trade-12', 'trade-13', 'trade-14', 'trade-15']);
assert.deepEqual(audit.staleStoreSymbols.sort(), ['COIN12USDT', 'COIN13USDT', 'COIN14USDT', 'COIN15USDT']);
assert.equal(audit.removedCount, 4);
assert.equal(audit.invariantOk, true);
assert.equal(journal.getOpenTrades().length, 11);

const primaryRows = JSON.parse(localStorage.getItem('cryptobud_v4:open_positions_primary') ?? '[]');
const backupRows = JSON.parse(localStorage.getItem('cryptobud_v4:open_positions_critical') ?? '[]');
assert.equal(primaryRows.length, 11);
assert.equal(backupRows.length, 11);
assert.equal(new Set(journal.getOpenTrades().map(t => t.coin)).has('COIN12USDT'), false, 'duplicate checks cannot see stale closed symbol');
assert.equal(journal.getOpenTrades().length, canonicalPositions.length, 'max positions and group caps consume canonical PositionManager count');

console.log('open position store reconciliation tests passed');
