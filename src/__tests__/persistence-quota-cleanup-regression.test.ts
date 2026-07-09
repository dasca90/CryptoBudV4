import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from '../core/persistence/Journal';
import { tauriDb } from '../core/persistence/TauriBridge';
import {
  buildOpenPositionPersistenceRows,
  OPEN_POSITIONS_MAX_PAYLOAD_BYTES,
  runRuntimeStorageCleanup,
} from '../core/persistence/localStorageMaintenance';
import {
  formatOvernightStabilityAudit,
  updateOvernightStabilitySnapshot,
} from '../core/diagnostics/overnightStability';
import { buildTradeV4PageModel } from '../lib/air-scanner/tradeV4DataAdapter';
import { repairOpenPositionRiskSnapshot } from '../core/persistence/localStorageMaintenance';
import type { Position, TradeRecord } from '../core/types';

class QuotaLocalStorage {
  private data = new Map<string, string>();
  quotaBytes = Number.POSITIVE_INFINITY;

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const next = new Map(this.data);
    next.set(key, value);
    const bytes = Array.from(next.values()).reduce((sum, raw) => sum + raw.length * 2, 0);
    if (bytes > this.quotaBytes) {
      const err = new Error(`Setting the value of '${key}' exceeded the quota`);
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.data = next;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

const storage = new QuotaLocalStorage();
(globalThis as any).localStorage = storage;

function makePosition(index: number, heavy = false): Position {
  const symbol = `COIN${index}USDT`;
  return {
    coin: symbol,
    quantity: 2 + index,
    avgEntryPrice: 1.25 + index,
    currentPrice: 1.3 + index,
    pnl: 0,
    pnlPercent: 0,
    mode: 'AUTO',
    openedAt: Date.now() - index * 1000,
    tradeId: `trade-${index}`,
    highestPrice: 1.4 + index,
    highestPriceSinceTp: 1.4 + index,
    tpArmed: false,
    tpArmedAt: 0,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 2,
    tp1Percent: 1.8,
    tp2Percent: 0,
    tpMode: 'dynamic',
    tpTriggerType: 'mark_price',
    trailFromPeakPercent: 0.6,
    maxHoldSec: 0,
    lastPrice: 1.3 + index,
    priceTimestamp: Date.now(),
    unrealizedPnlPercent: 0,
    ownerType: 'scanner',
    adapter: 'paper',
    buySnapshot: {
      schemaVersion: 'test',
      tradeId: `trade-${index}`,
      createdAt: new Date().toISOString(),
      symbol,
      mode: 'AUTO',
      adapter: 'paper',
      riskGroup: 'mid_caps',
      selectedStrategy: 'momentum',
      selectedPlaybook: null,
      marketRegime: null,
      btcRegime: null,
      groupRegime: null,
      entryPrice: 1.25 + index,
      realMarketPriceAtBuy: 1.25 + index,
      entryPriceSource: 'test',
      entryPriceAgeMs: 0,
      isRealMarketPriceAtBuy: true,
      spreadPct: 0.01,
      volumeRel: 1,
      confidence: 0.7,
      traderBrainDecision: null,
      ruleDecisionTrace: {},
      mlPredictionAtEntry: null,
      entryGateDecision: null,
      riskDecision: null,
      candidateRank: index,
      candidatePoolSize: 4,
      topCandidatesAtDecision: [],
      rejectedNearCandidates: [],
      whySelectedOverOthers: null,
      settingsSnapshot: heavy ? { scannerSnapshots: 'x'.repeat(80_000) } : {},
      entryConfigSnapshot: {
        selectedStrategy: 'momentum',
        finalEntryRule: 'momentum_entry',
        setupResult: 'MOMENTUM_OK',
        finalExecutable: true,
        finalExecutableAtEntry: true,
        buyAllowed: true,
        entryConfirmedAtEntry: true,
        riskParams: {
          entryPrice: 1.25 + index,
          tp1Pct: 1.8,
          tp1TargetPrice: (1.25 + index) * 1.018,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          sourceTp2: 'autobots_enforced_zero',
          slPct: 2,
          slSource: 'user',
          sourceSl: 'user',
          autoBotsOnAtEntry: true,
        },
        strategyAuditSnapshot: {
          strategySelected: 'momentum',
          finalEntryRule: 'momentum_entry',
          setupResult: 'MOMENTUM_OK',
          finalExecutable: true,
          finalExecutableAtEntry: true,
          buyAllowed: true,
          entryConfirmedAtEntry: true,
          setupMetrics: [
            { key: 'momentumConfirmed', actualValue: true, requiredValue: true, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
          ],
        },
      },
      ...(heavy ? {
        candleHistory: 'x'.repeat(80_000),
        scannerSnapshots: 'x'.repeat(80_000),
        auditTrail: 'x'.repeat(80_000),
        mlTrainingRows: 'x'.repeat(80_000),
      } : {}),
    } as any,
    ...(heavy ? {
      candleHistory: 'x'.repeat(80_000),
      scannerSnapshots: 'x'.repeat(80_000),
      auditTrail: 'x'.repeat(80_000),
      logs: 'x'.repeat(80_000),
      closedTrades: [{ tradeId: `trade-${index}`, status: 'closed' }],
      mlTrainingRows: 'x'.repeat(80_000),
    } : {}),
  } as Position;
}

function closedTrade(tradeId: string, coin: string): TradeRecord {
  return {
    tradeId,
    coin,
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'paper',
    entryPrice: 1,
    exitPrice: 1.02,
    quantity: 1,
    pnl: 0.02,
    pnlPercent: 2,
    entryTime: new Date(Date.now() - 1000).toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'TP1_FIXED',
    closeSnapshot: { exitReason: 'TP1_FIXED' } as any,
  };
}

function attachTraderBrainDecision(position: Position): Position {
  const snapshot = (position as any).buySnapshot;
  snapshot.traderBrainDecision = {
    symbol: position.coin,
    mode: position.mode,
    selectedStrategy: snapshot.selectedStrategy,
    selectedPlaybook: 'momentum',
    confidence: 0.82,
    status: 'BUY',
    entryPlan: { side: 'BUY', price: position.avgEntryPrice, quantity: position.quantity, reason: 'test_entry' },
    exitPlan: null,
    reasons: ['test_ready'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: {
      unifiedSignal: {
        signal: 'BUY',
        reasonCode: 'MOMENTUM_READY',
        reason: 'test',
        dipPercent: -1.2,
        requiredDipPct: 1,
        dipPassed: true,
        reboundPct: 0.8,
        requiredReboundPct: 0.5,
        reboundPassed: true,
        momentumConfirmed: true,
        definition: { buyRule: 'momentum' },
      },
      playbookResult: null,
      autobotsResult: null,
    },
  };
  snapshot.ruleDecisionTrace = snapshot.traderBrainDecision.ruleDecisionTrace;
  return position;
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  (journal as any).closedTradesHydrated = true;
  (journal as any).trades = [closedTrade('trade-1', 'COIN1USDT')];
  const stale = buildOpenPositionPersistenceRows([makePosition(1)]);
  storage.setItem('cryptobud_v4:open_positions_primary', JSON.stringify(stale));
  storage.setItem('cryptobud_v4:open_positions_critical', JSON.stringify(stale));

  const loaded = await journal.loadOpenPositions();
  assert.equal(loaded.length, 0, 'closed TP1_FIXED trade is filtered out of open-position restore');
  assert.equal(JSON.parse(storage.getItem('cryptobud_v4:open_positions_primary') ?? '[]').length, 0, 'stale open row is persisted as removed');
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  (journal as any).closedTradesHydrated = true;
  (journal as any).trades = [closedTrade('trade-11', 'COIN11USDT')];
  (journal as any).useTauri = true;
  (journal as any).tauriReady = true;
  const active = buildOpenPositionPersistenceRows([attachTraderBrainDecision(makePosition(10))])[0];
  const stale = buildOpenPositionPersistenceRows([attachTraderBrainDecision(makePosition(11))])[0];
  const deleted: string[] = [];
  const originalGetOpenPositions = tauriDb.getOpenPositions;
  const originalDeleteOpenPosition = tauriDb.deleteOpenPosition;
  const originalSaveOpenPosition = tauriDb.saveOpenPosition;
  try {
    tauriDb.getOpenPositions = async () => [active, stale];
    tauriDb.deleteOpenPosition = async (tradeId: string) => { deleted.push(tradeId); };
    tauriDb.saveOpenPosition = async () => {};
    const loaded = await journal.loadOpenPositions();
    assert.deepEqual(loaded.map(r => r.trade_id), ['trade-10'], 'Tauri open-position load returns only non-closed rows');
    assert.deepEqual(deleted, ['trade-11'], 'Tauri stale open row is deleted at the persistent source after closed-trade filtering');
  } finally {
    tauriDb.getOpenPositions = originalGetOpenPositions;
    tauriDb.deleteOpenPosition = originalDeleteOpenPosition;
    tauriDb.saveOpenPosition = originalSaveOpenPosition;
  }
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  (journal as any).closedTradesHydrated = true;
  (journal as any).trades = [closedTrade('trade-2', 'COIN2USDT')];
  const stale = buildOpenPositionPersistenceRows([makePosition(2)]);
  storage.setItem('cryptobud_v4:open_positions_primary', JSON.stringify(stale));
  storage.setItem('cryptobud_v4:open_positions_critical', JSON.stringify(stale));

  assert.equal(await journal.deleteOpenPosition('trade-2'), true, 'first stale repair persists');
  assert.equal(await journal.deleteOpenPosition('trade-2'), true, 'second identical stale repair is idempotent');
  assert.equal(JSON.parse(storage.getItem('cryptobud_v4:open_positions_primary') ?? '[]').length, 0, 'idempotent repair does not reintroduce stale open row');
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const [row] = buildOpenPositionPersistenceRows([attachTraderBrainDecision(makePosition(12))]);
  const snapshot = row.buy_snapshot_json ? JSON.parse(row.buy_snapshot_json) as any : null;
  assert.ok(snapshot && 'traderBrainDecision' in snapshot, 'minimal buy snapshot keeps traderBrainDecision key for restored open positions');
  assert.equal(snapshot.traderBrainDecision.selectedStrategy, 'momentum', 'minimal buy snapshot preserves selected strategy from traderBrainDecision');
  assert.equal(snapshot.traderBrainDecision.ruleDecisionTrace.unifiedSignal.reasonCode, 'MOMENTUM_READY', 'minimal buy snapshot preserves unified signal for setup metrics');
  assert.equal(snapshot.traderBrainDecision.entryPlan.reason, 'test_entry', 'minimal buy snapshot preserves bounded entry plan');
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const reports = Array.from({ length: 80 }, (_, i) => ({ id: i, report: 'x'.repeat(500) }));
  storage.setItem('cryptobud_v4:saved_bot_reports', JSON.stringify(reports));
  storage.quotaBytes = 18_000;
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  (journal as any).closedTradesHydrated = true;
  const ok = await journal.saveOpenPosition('trade-3', 'COIN3USDT', JSON.stringify(makePosition(3)), undefined);
  assert.equal(ok, true, 'quota exceeded during critical write recovers by pruning and retrying');
  assert.ok((storage.getItem('cryptobud_v4:saved_bot_reports') ?? '').length < JSON.stringify(reports).length, 'quota recovery trims non-critical reports first');
  assert.equal(journal.wasLastOpenPositionWriteSuccessful(), true, 'successful recovery keeps open-position persistence healthy');
}

{
  const rows = buildOpenPositionPersistenceRows([1, 2, 3, 4].map((i) => makePosition(i, true)));
  const payload = JSON.stringify(rows);
  assert.ok(payload.length < OPEN_POSITIONS_MAX_PAYLOAD_BYTES, 'four open positions persist below hard payload bound');
  const firstPosition = JSON.parse(rows[0].position_json) as any;
  const firstSnapshot = rows[0].buy_snapshot_json ? JSON.parse(rows[0].buy_snapshot_json) as any : null;
  assert.equal(firstPosition.buySnapshot, undefined, 'minimal position_json does not duplicate buySnapshot');
  assert.equal(firstSnapshot.entryConfigSnapshot.riskParams.tp1Pct, 1.8, 'minimal open-position payload preserves TP1 risk snapshot in buy_snapshot_json');
  assert.equal(firstSnapshot.entryConfigSnapshot.riskParams.tp1Source, 'AutoBots dynamic per coin', 'minimal buy_snapshot_json preserves canonical TP1 source');
  assert.equal(firstSnapshot.entryConfigSnapshot.riskParams.tp2Pct, 0, 'minimal snapshot keeps AutoBots TP2=0 in canonical risk snapshot');
  for (const forbidden of ['candleHistory', 'scannerSnapshots', 'auditTrail', 'mlTrainingRows', 'closedTrades', 'logs']) {
    assert.equal(payload.includes(forbidden), false, `open-position payload excludes ${forbidden}`);
  }
}

{
  const stripped = makePosition(9, false) as any;
  delete stripped.buySnapshot.entryConfigSnapshot;
  const [row] = buildOpenPositionPersistenceRows([stripped]);
  const repaired = JSON.parse(row.position_json) as any;
  const repairedSnapshot = row.buy_snapshot_json ? JSON.parse(row.buy_snapshot_json) as any : null;
  assert.equal(repaired.buySnapshot, undefined, 'repaired position_json remains bounded without duplicated buySnapshot');
  assert.equal(repairedSnapshot.entryConfigSnapshot.riskParams.tp1Pct, stripped.tp1Percent, 'persistence repairs prior stripped TP1 snapshot from canonical position fields');
  assert.equal(repairedSnapshot.entryConfigSnapshot.riskParams.tp1TargetPrice, stripped.avgEntryPrice * (1 + stripped.tp1Percent / 100), 'repaired TP1 target is derived from entry price and TP1 percent');
  assert.ok(String(repairedSnapshot.entryConfigSnapshot.riskParams.tp1Source).includes('AutoBots'), 'repaired snapshot keeps AutoBots TP1 source identity');

  const restoredPosition = repaired as Position;
  restoredPosition.buySnapshot = repairedSnapshot;
  repairOpenPositionRiskSnapshot(restoredPosition, 'test_restore_roundtrip');
  const model = buildTradeV4PageModel({
    scannerSnapshot: null,
    positions: [restoredPosition],
    closedTrades: [],
    selectedSymbol: restoredPosition.coin,
    scannerRunning: true,
    engineOnline: true,
    mode: 'PAPER',
    capital: 1000,
    usedCapital: restoredPosition.avgEntryPrice * restoredPosition.quantity,
    pnlToday: 0,
    dataQuality: 'GOOD',
  });
  assert.equal(model.openPositions[0].tp1Pct, stripped.tp1Percent, 'UI model restores TP1 from repaired canonical risk snapshot');
  assert.notEqual(model.openPositions[0].riskSnapshotStatus, 'SNAPSHOT_MISSING', 'UI model no longer shows SNAPSHOT_MISSING after restore repair');
}

storage.clear();
storage.quotaBytes = Number.POSITIVE_INFINITY;
{
  const appState = { schemaVersion: 'x', savedAt: new Date().toISOString(), equityHistory: Array.from({ length: 2000 }, (_, time) => ({ time, equity: 10000 + time })) };
  storage.setItem('cryptobud_v4:app_state_v1', JSON.stringify(appState));
  const cleanup = runRuntimeStorageCleanup(Date.now());
  assert.ok(cleanup.appStateEquityPointsTrimmed > 0, 'cleanup trims long-running equity history');
  const snapshot = updateOvernightStabilitySnapshot({
    uptimeHours: 17.7,
    activeTab: 'trade',
    scannerRunning: true,
    autoBotsEnabled: true,
    openPositionsCount: 4,
    closedPositionsCount: 1,
    jsHeapUsed: 100,
    visibleLogCount: 10,
    internalAuditCount: 20,
    airScannerMounted: false,
    activeIntervalsCount: 2,
    activeSubscriptionsCount: 1,
    memoryPressureActive: false,
    memoryPressureLevel: 'normal',
    pressureReason: 'none',
    memoryGrowthReason: 'none_detected',
    memoryGrowthWarmupActive: false,
    isStartupGracePeriodActive: false,
    lastMemoryBufferTrimAt: null,
    lastStartupRecoveryAt: null,
    lastRuntimeCleanupAt: Date.now(),
    lastAirScannerCleanupAt: null,
  });
  assert.notEqual(snapshot.lastRuntimeCleanupAt, null, 'simulated long runtime has a real cleanup timestamp');
  assert.ok(formatOvernightStabilityAudit(snapshot).includes('lastRuntimeCleanupAt='), 'overnight audit reports cleanup timestamp');
}

storage.clear();
storage.quotaBytes = 10;
{
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  (journal as any).closedTradesHydrated = true;
  const ok = await journal.saveOpenPosition('trade-4', 'COIN4USDT', JSON.stringify(makePosition(4)), undefined);
  assert.equal(ok, false, 'unrecoverable persistence failure returns false');
  assert.equal(journal.getPersistenceStatus(), 'ERROR', 'unrecoverable persistence failure marks app health degraded');
  assert.match(journal.getDbInfo().saveError ?? '', /localStorage|emergency/i, 'degraded health records root persistence error');
}

const root = process.cwd();
const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const engineSource = readFileSync(join(root, 'src', 'core', 'trading', 'TradingEngine.ts'), 'utf8');
const tauriBridgeSource = readFileSync(join(root, 'src', 'core', 'persistence', 'TauriBridge.ts'), 'utf8');
const tauriLibSource = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
assert.ok(appSource.includes('MEMORY_CLEANUP_RUN_AUDIT'), 'cleanup scheduler emits MEMORY_CLEANUP_RUN_AUDIT');
assert.ok(appSource.includes('lastRuntimeCleanupAtRef.current = now'), 'cleanup scheduler updates actual last cleanup timestamp');
assert.ok(engineSource.includes('tradeInvariantRepairSucceeded') && engineSource.includes('dedupeKey'), 'tradeId invariant repair is deduped and idempotent');
assert.ok(tauriLibSource.includes('#[tauri::command(rename_all = "snake_case")]') && tauriLibSource.includes('fn delete_open_position(state: State<AppState>, trade_id: String)'), 'Rust delete_open_position command explicitly expects snake_case trade_id payload');
assert.ok(tauriBridgeSource.includes("invoke<void>('delete_open_position', { trade_id: tradeId })"), 'Frontend calls Tauri delete_open_position with explicit snake_case trade_id payload');
assert.equal(tauriBridgeSource.includes("delete_open_position', { tradeId"), false, 'Frontend no longer relies on implicit camelCase payload for Tauri delete_open_position');

console.log('persistence quota cleanup regression tests passed');
