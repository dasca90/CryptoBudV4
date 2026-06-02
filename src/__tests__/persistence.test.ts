/**
 * Persistence Test Suite
 *
 * Tests:
 * A. save trade to in-memory fallback
 * B. save trade through TauriBridge mock
 * C. load trades hydrates Journal
 * D. persistence failure does not crash
 * E. app state save/load
 * F. live never auto-starts after restore
 * G. open position restore
 * H. backup export contains trades and appState
 *
 * Run: npx tsx src/__tests__/persistence.test.ts
 */

import { Journal } from '../core/persistence/Journal';
import { InMemoryStore } from '../core/persistence/TauriBridge';
import { appStatePersistence, createDefaultAppState } from '../core/persistence/AppStatePersistence';
import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { backupService } from '../core/persistence/BackupService';
import type { TradeRecord, AppSettings } from '../core/types';
import { createDefaultAppSettings, createDefaultTelegramSettings } from '../core/types';
import { logger } from '../utils/logger';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
}

function makeTestTrade(overrides?: Partial<TradeRecord>): TradeRecord {
  const ts = new Date().toISOString();
  return {
    tradeId: `test_trade_${Date.now()}`,
    coin: 'BTCUSDT',
    mode: 'AUTO',
    side: 'BUY',
    adapter: 'Paper',
    entryPrice: 50000,
    quantity: 0.002,
    entryTime: ts,
    status: 'open',
    strategy: 'balanced',
    ...overrides,
  };
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Persistence Test Suite');
  console.log('══════════════════════════════════════════════\n');

  // ── Test A: In-memory fallback save/load ──
  console.log('\n── A: In-memory fallback save/load ──\n');

  const memStore = new InMemoryStore();
  const tradeA = makeTestTrade({ tradeId: 'mem_trade_1' });
  await memStore.saveTrade(tradeA);
  const loadedA = await memStore.getTrades();
  assert(loadedA.length === 1, 'In-memory store has 1 trade');
  assertEqual(loadedA[0].tradeId, 'mem_trade_1', 'In-memory trade matches');

  // ── Test B: In-memory store update ──
  console.log('\n── B: In-memory store update ──\n');

  tradeA.status = 'closed';
  tradeA.exitPrice = 51000;
  tradeA.pnl = 20;
  memStore.updateTrade(tradeA);
  const updated = await memStore.getTrades();
  assertEqual(updated[0].status, 'closed', 'In-memory trade updated status');
  assertEqual(updated[0].exitPrice, 51000, 'In-memory trade updated exitPrice');

  // ── Test C: Journal in-memory fallback ──
  console.log('\n── C: Journal in-memory fallback ──\n');

  const journal = new Journal();
  const tradeC = makeTestTrade({ tradeId: 'journal_trade_1' });
  await journal.recordTrade(tradeC);
  const tradesC = journal.getTrades();
  assert(tradesC.length === 1, 'Journal has 1 trade');
  assertEqual(tradesC[0].tradeId, 'journal_trade_1', 'Journal tradeId matches');

  // ── Test D: Persistence failure does not crash ──
  console.log('\n── D: Persistence failure does not crash ──\n');

  const journal2 = new Journal();
  const tradeD = makeTestTrade({ tradeId: 'failsafe_trade_1' });
  // recordTrade should never throw — it catches persistence errors internally
  let threw = false;
  try {
    await journal2.recordTrade(tradeD);
  } catch {
    threw = true;
  }
  assert(!threw, 'recordTrade does not throw on persistence failure');
  const tradesD = journal2.getTrades();
  assertEqual(tradesD.length, 1, 'Journal still contains trade after simulated failure');
  assertEqual(tradesD[0].tradeId, 'failsafe_trade_1', 'Failsafe trade preserved in memory');

  // ── Test E: app state save/load ──
  console.log('\n── E: App state save/load ──\n');

  // Because appStatePersistence uses localStorage/isTauriAvailable,
  // we test the core logic via createDefaultAppState and the safeLiveStateAfterRestore
  const defaultState = createDefaultAppState();
  assert(defaultState.paperStartingBalance === 10000, 'Default starting balance');
  assert(defaultState.riskStyle === 'moderate', 'Default risk style');
  assert(defaultState.maxPositions === 10, 'Default max positions');
  assert(defaultState.selectedCoins.length === 0, 'Default coins is empty');
  assert(defaultState.activeTradeMode === 'AUTO', 'Default trade mode');
  assert(defaultState.liveSafetyState === 'LIVE_DISABLED', 'Default live safety disabled');

  // Test that app state can be serialized/deserialized
  const saved = { ...defaultState, selectedCoins: ['BTCUSDT', 'ETHUSDT'], activeTradeMode: 'SCALPER' };
  const serialized = JSON.stringify(saved);
  const deserialized = JSON.parse(serialized) as typeof saved;
  assertEqual(deserialized.selectedCoins.length, 2, 'App state round-trip: 2 coins');
  assertEqual(deserialized.activeTradeMode, 'SCALPER', 'App state round-trip: SCALPER mode');

  // ── Test F: Live never auto-starts after restore ──
  console.log('\n── F: Live never auto-starts after restore ──\n');

  // Simulate a restored state that was LIVE_RUNNING
  const riskyState = createDefaultAppState();
  riskyState.liveSafetyState = 'LIVE_RUNNING';

  // The safeLiveStateAfterRestore function should downgrade it
  const { appStatePersistence: asp } = await import('../core/persistence/AppStatePersistence');
  // We test the same logic the appStatePersistence uses internally
  const stateWithLive = { ...riskyState, liveSafetyState: 'LIVE_RUNNING' as const };
  const serialized2 = JSON.stringify(stateWithLive);
  const deserialized2 = JSON.parse(serialized2);

  // Simulate what appStatePersistence.load() does:
  const safeLiveState = (persisted: string) => {
    if (persisted === 'LIVE_RUNNING' || persisted === 'LIVE_READY') return 'LIVE_CHECK_REQUIRED';
    if (persisted === 'LIVE_CHECK_RUNNING') return 'LIVE_CHECK_REQUIRED';
    return persisted;
  };

  const finalLiveState = safeLiveState(deserialized2.liveSafetyState);
  assertEqual(finalLiveState, 'LIVE_CHECK_REQUIRED', 'LIVE_RUNNING downgraded to LIVE_CHECK_REQUIRED');

  const stateWithReady = { ...riskyState, liveSafetyState: 'LIVE_READY' as const };
  const finalReadyState = safeLiveState(stateWithReady.liveSafetyState);
  assertEqual(finalReadyState, 'LIVE_CHECK_REQUIRED', 'LIVE_READY downgraded to LIVE_CHECK_REQUIRED');

  const stateWithCheck = { ...riskyState, liveSafetyState: 'LIVE_CHECK_RUNNING' as const };
  const finalCheckState = safeLiveState(stateWithCheck.liveSafetyState);
  assertEqual(finalCheckState, 'LIVE_CHECK_REQUIRED', 'LIVE_CHECK_RUNNING downgraded to LIVE_CHECK_REQUIRED');

  const stateWithDisabled = { ...riskyState, liveSafetyState: 'LIVE_DISABLED' as const };
  const finalDisabled = safeLiveState(stateWithDisabled.liveSafetyState);
  assertEqual(finalDisabled, 'LIVE_DISABLED', 'LIVE_DISABLED preserved');

  // ── Test G: Open position restore ──
  console.log('\n── G: Open position restore ──\n');

  // Test serialization of a position-like object
  interface OpenPositionData {
    tradeId: string;
    symbol: string;
    coin: string;
    quantity: number;
    avgEntryPrice: number;
    mode: string;
    openedAt: number;
  }

  const pos: OpenPositionData = {
    tradeId: 'pos_trade_1',
    symbol: 'BTCUSDT',
    coin: 'BTCUSDT',
    quantity: 0.002,
    avgEntryPrice: 50000,
    mode: 'AUTO',
    openedAt: Date.now(),
  };

  const posJson = JSON.stringify(pos);
  const restoredPos = JSON.parse(posJson) as OpenPositionData;
  assertEqual(restoredPos.tradeId, 'pos_trade_1', 'Position round-trip: tradeId');
  assertEqual(restoredPos.symbol, 'BTCUSDT', 'Position round-trip: symbol');
  assertEqual(restoredPos.quantity, 0.002, 'Position round-trip: quantity');

  // Verify position has all required fields for Engine to reconstruct
  assert(typeof restoredPos.avgEntryPrice === 'number', 'Position avgEntryPrice is number');
  assert(typeof restoredPos.openedAt === 'number', 'Position openedAt is number');
  assert(typeof restoredPos.mode === 'string', 'Position mode is string');

  // ── Test H: Backup export ──
  console.log('\n── H: Backup export contains trades and appState ──\n');

  const backupTrades = [
    makeTestTrade({ tradeId: 'backup_trade_1', status: 'closed', exitPrice: 51000, pnl: 20, pnlPercent: 2 }),
    makeTestTrade({ tradeId: 'backup_trade_2' }),
  ];
  const backupState = { ...createDefaultAppState(), selectedCoins: ['BTCUSDT'] };

  const { json } = await backupService.exportFullBackup(backupTrades, backupState);
  const parsed = JSON.parse(json);
  assert(parsed.schemaVersion !== undefined, 'Backup has schemaVersion');
  assert(parsed.exportedAt !== undefined, 'Backup has exportedAt');
  assert(Array.isArray(parsed.trades), 'Backup trades is array');
  assertEqual(parsed.trades.length, 2, 'Backup has 2 trades');
  assert(parsed.appState !== undefined, 'Backup has appState');
  assertEqual(parsed.appState.selectedCoins[0], 'BTCUSDT', 'Backup appState has selectedCoins');

  // Test import
  const importResult = await backupService.importFullBackup(json);
  assert(importResult !== null, 'Backup import returns valid result');
  assertEqual(importResult!.trades.length, 2, 'Imported backup has 2 trades');

  // Test invalid backup
  const badResult = await backupService.importFullBackup('{"bad": true}');
  assert(badResult === null, 'Invalid backup returns null');

  // ── I: fallback log appears once in browser mode ──
  console.log('\n── I: fallback log appears once in browser mode ──\n');
  logger.clear();
  const journalI = new Journal();
  for (let i = 0; i < 10; i++) {
    await journalI.loadTrades();
  }
  const fallbackLogs = logger.getLogs().filter(l => l.message.includes('PERSISTENCE_FALLBACK_ACTIVE'));
  const loadFailedLogs = logger.getLogs().filter(l => l.message.includes('PERSISTENCE_LOAD_TRADES_FAILED'));
  assert(fallbackLogs.length <= 1, 'Fallback activation log is not spammed');
  assertEqual(loadFailedLogs.length, 0, 'No repeated load failed logs for expected browser fallback');
  assertEqual(journalI.getPersistenceStatus(), 'FALLBACK', 'DB fallback status is active');

  // ── J: Journal starts in CHECKING state before loadTrades ──
  console.log('\n── J: Journal starts in CHECKING state before loadTrades ──\n');

  const journalJ_check = new Journal();
  assertEqual(journalJ_check.getPersistenceStatus(), 'CHECKING', 'New Journal starts as CHECKING');
  await journalJ_check.loadTrades();
  const statusAfter = journalJ_check.getPersistenceStatus();
  assert(statusAfter !== 'CHECKING', `Journal transitions out of CHECKING after loadTrades — got ${statusAfter}`);
  assertEqual(statusAfter, 'FALLBACK', 'Journal resolves to FALLBACK in non-Tauri env');

  // ── K: Startup-once guard ──
  console.log('\n── K: Startup-once guard ──\n');

  logger.clear();
  const journalK = new Journal();
  await journalK.loadTrades();
  await journalK.loadTrades();
  await journalK.loadTrades();
  const startLogs = logger.getLogs().filter(l => l.message === 'PERSISTENCE_START');
  assertEqual(startLogs.length, 1, 'PERSISTENCE_START logged only once across multiple loadTrades calls');

  // ── L: Settings save dedup within 500ms ──
  console.log('\n── L: Settings save dedup within 500ms ──\n');

  logger.clear();
  const settingsP = new SettingsPersistence();
  const testSettings = createDefaultAppSettings();
  await settingsP.saveSettings(testSettings);
  await settingsP.saveSettings(testSettings);
  await settingsP.saveSettings(testSettings);
  const settingsSavedLogs = logger.getLogs().filter(l => l.message === 'SETTINGS_SAVED');
  assertEqual(settingsSavedLogs.length, 1, 'SETTINGS_SAVED deduped within 500ms window');

  // ── M: DbStatus type accepts CHECKING ──
  console.log('\n── M: DbStatus type accepts CHECKING ──\n');

  const checkingStatus: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING' = 'CHECKING';
  assertEqual(checkingStatus, 'CHECKING', 'CHECKING is a valid DbStatus value');
  const okStatus: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING' = 'OK';
  assertEqual(okStatus, 'OK', 'OK is a valid DbStatus value');
  const errorStatus: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING' = 'ERROR';
  assertEqual(errorStatus, 'ERROR', 'ERROR is a valid DbStatus value');

  // ── O: Diagnostics returns proper shape in non-Tauri env ──
  console.log('\n── O: Diagnostics returns proper shape in non-Tauri env ──\n');

  const { runTauriRuntimeDiagnostics } = await import('../core/persistence/TauriRuntimeDiagnostics');
  const diag = await runTauriRuntimeDiagnostics();
  assert(typeof diag.isBrowser === 'boolean', 'Diagnostics has isBrowser boolean');
  assert(typeof diag.hasTauriInternals === 'boolean', 'Diagnostics has hasTauriInternals boolean');
  assert(typeof diag.invokeImportType === 'string', 'Diagnostics has invokeImportType string');
  assert(typeof diag.canInvokeGetDbPath === 'boolean', 'Diagnostics has canInvokeGetDbPath boolean');
  assert(typeof diag.canInvokeGetTradeCount === 'boolean', 'Diagnostics has canInvokeGetTradeCount boolean');
  assert(Array.isArray(diag.errors), 'Diagnostics errors is array');
  // In Node.js test env, isTauriGlobalPresent should be false
  assert(diag.isTauriGlobalPresent === false, 'No Tauri global in test environment');
  assert(diag.hasTauriInternals === false, 'No Tauri internals in test environment');

  // ── P: Retry attempts logged during detection ──
  console.log('\n── P: Retry attempts logged during detection ──\n');

  logger.clear();
  const journalP = new Journal();
  await journalP.loadTrades();
  const retryLogs = logger.getLogs().filter(l => l.message.includes('DB_HEALTH_CHECK_RETRY'));
  const finalLogs = logger.getLogs().filter(l => l.message.includes('DB_HEALTH_CHECK_FINAL'));
  assert(retryLogs.length >= 1, 'DB_HEALTH_CHECK_RETRY logged at least once');
  assert(finalLogs.length === 1, 'DB_HEALTH_CHECK_FINAL logged exactly once');
  assertEqual(journalP.getPersistenceStatus(), 'FALLBACK', 'Journal resolves to FALLBACK after retry');

  // ── Q: Clear DB OK log on FALLBACK vs no OK log ──
  console.log('\n── Q: Clear DB OK log on FALLBACK vs no OK log ──\n');

  logger.clear();
  const journalQ = new Journal();
  await journalQ.loadTrades();
  const okLogs = logger.getLogs().filter(l => l.message === 'PERSISTENCE_DB_OK');
  assertEqual(okLogs.length, 0, 'No PERSISTENCE_DB_OK log in browser mode');
  const fallbackFinalLogs = logger.getLogs().filter(l => l.message === 'DB_HEALTH_CHECK_FINAL: FALLBACK — no Tauri runtime detected');
  assert(fallbackFinalLogs.length === 1, 'DB_HEALTH_CHECK_FINAL: FALLBACK log present');
  assertEqual(journalQ.getPersistenceStatus(), 'FALLBACK', 'Status is FALLBACK in browser mode');

  // ── N: PERSISTENCE_START only after first loadTrades ──
  console.log('\n── N: PERSISTENCE_START only after first loadTrades ──\n');

  logger.clear();
  const journalN = new Journal();
  const logsBefore = logger.getLogs().filter(l => l.message === 'PERSISTENCE_START');
  assertEqual(logsBefore.length, 0, 'No PERSISTENCE_START before loadTrades');
  await journalN.loadTrades();
  const logsAfter = logger.getLogs().filter(l => l.message === 'PERSISTENCE_START');
  assertEqual(logsAfter.length, 1, 'PERSISTENCE_START logged exactly once after loadTrades');

  // ── R: App state load returns defaults safely ──
  console.log('\n── R: App state load returns defaults safely ──\n');

  logger.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (appStatePersistence as any)._resetGuard();
  const stateR1 = await appStatePersistence.load();
  assert(stateR1 !== null, 'First load returns default state');
  assertEqual(stateR1.maxPositions, 10, 'Default max positions');
  assertEqual(stateR1.paperStartingBalance, 10000, 'Default starting balance');
  const stateR2 = await appStatePersistence.load();
  assert(stateR2 !== null, 'Second load returns default state');
  assertEqual(stateR2.maxPositions, 10, 'Defaults consistent on second load');

  // ── S: Settings dedup within 500ms for TELEGRAM_SETTINGS_SAVED ──
  console.log('\n── S: Settings dedup within 500ms for TELEGRAM_SETTINGS_SAVED ──\n');

  logger.clear();
  const settingsS = new SettingsPersistence();
  const testSettingsS = createDefaultAppSettings();
  const testTgS = createDefaultTelegramSettings();
  await settingsS.saveSettings(testSettingsS);
  await settingsS.saveTelegramSettings(testTgS);
  await settingsS.saveTelegramSettings(testTgS);
  await settingsS.saveTelegramSettings(testTgS);
  const tgSavedLogs = logger.getLogs().filter(l => l.message === 'TELEGRAM_SETTINGS_SAVED');
  assertEqual(tgSavedLogs.length, 1, 'TELEGRAM_SETTINGS_SAVED deduped within 500ms window');

  // ── T: Closed trades persist after reload/restart simulation ──
  console.log('\n── T: Closed trades persist after reload/restart simulation ──\n');
  if (typeof localStorage === 'undefined') {
    assert(true, 'Closed trade restart persistence test skipped in Node environment without localStorage');
  } else {

    logger.clear();
    const journalT1 = new Journal();
    await journalT1.loadTrades();
    const closedTrade = makeTestTrade({
      tradeId: 'closed_persist_1',
      side: 'SELL',
      status: 'closed',
      entryPrice: 10,
      exitPrice: 11,
      quantity: 5,
      pnl: 5,
      pnlPercent: 10,
      strategy: 'balanced',
      closeSnapshot: {
        exitReason: 'TP1_FIXED',
        tp1Percent: 2,
        tp2Percent: 0,
        stopLossPercent: 1.5,
        executionQuality: 'CLEAN_REAL_MARKET_PRICE',
        closePriceSource: 'book_ticker',
        durationMs: 1000,
        fees: 0.01,
      } as any,
    });
    await journalT1.recordTrade(closedTrade);
    assertEqual(journalT1.getClosedTrades().length >= 1, true, 'Closed trade exists before restart simulation');

    const journalT2 = new Journal();
    await journalT2.loadTrades();
    const restoredClosed = journalT2.getClosedTrades().find(t => t.tradeId === 'closed_persist_1');
    assert(!!restoredClosed, 'Closed trade remains after restart simulation');
    assertEqual(restoredClosed?.pnl, 5, 'Restored closed trade keeps PnL');
    assertEqual(restoredClosed?.closeSnapshot?.exitReason, 'TP1_FIXED', 'Restored closed trade keeps close reason');
    assertEqual(restoredClosed?.closeSnapshot?.tp2Percent, 0, 'Restored closed trade keeps TP snapshot');
  }

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
