import { runResetScope } from '../core/reset/reset-service';
import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { createDefaultAppSettings } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string) => c ? passed++ : (failed++, console.error(`FAIL: ${m}`));

async function testResetTradingClearsRuntime() {
  const settings = new SettingsPersistence();
  await settings.saveSettings({ ...createDefaultAppSettings(), scannerBanlist: ['EURIUSDT'] });

  const state = { open: [{ coin: 'BTCUSDT' }], locks: 1, balance: 12000 };
  const engine = {
    getPositionManager: () => ({
      clearAllPositions: () => { state.open = []; },
      getOpenPositions: () => state.open,
    }),
    getOrderLockManager: () => ({ releaseAllLocks: () => { state.locks = 0; } }),
    setAccountBalance: (b: number) => { state.balance = b; },
    resetPaperPositions: async () => { state.open = []; state.locks = 0; },
  };
  const journalState = { trades: [{ status: 'closed' }], ml: 1, cleared: false };
  const journal = {
    clearTradingPersistence: async () => { journalState.trades = []; journalState.ml = 0; journalState.cleared = true; },
    getClosedTrades: () => [],
    getTrades: () => [],
    computeMLCounts: () => ({ trainingEligible: journalState.ml }),
  } as any;

  const res = await runResetScope('reset_trading', { journal, engine: engine as any, settingsPersistence: settings });
  ok(res.ok, '1 reset_trading verification passes');
  ok(state.open.length === 0, '2 open positions cleared');
  ok(state.locks === 0, '3 locks cleared');
  ok(journalState.cleared, '4 journal persistence clear called');
  const loaded = await settings.loadSettings();
  ok((loaded.scannerBanlist ?? []).includes('EURIUSDT'), '5 banned coins preserved');
}

async function testFullDemoResetResetsBalance() {
  const settings = new SettingsPersistence();
  const state = { open: [{ coin: 'SKYUSDT' }], locks: 1, balance: 12000 };
  const engine = {
    getPositionManager: () => ({
      clearAllPositions: () => { state.open = []; },
      getOpenPositions: () => state.open,
    }),
    getOrderLockManager: () => ({ releaseAllLocks: () => { state.locks = 0; } }),
    setAccountBalance: (b: number) => { state.balance = b; },
    resetPaperPositions: async () => { state.open = []; state.locks = 0; },
  };
  const journal = {
    clearTradingPersistence: async () => {},
    getClosedTrades: () => [],
    getTrades: () => [],
    computeMLCounts: () => ({ trainingEligible: 0 }),
  } as any;
  await runResetScope('full_demo_reset', { journal, engine: engine as any, settingsPersistence: settings });
  ok(state.balance === 10000, '6 full_demo_reset resets demo balance');
}

async function testResetMlDoesNotClearOpen() {
  const settings = new SettingsPersistence();
  const state = { open: [{ coin: 'NILUSDT' }] };
  const engine = {
    getPositionManager: () => ({
      clearAllPositions: () => {},
      getOpenPositions: () => state.open,
    }),
    getOrderLockManager: () => ({ releaseAllLocks: () => {} }),
    setAccountBalance: (_b: number) => {},
    resetPaperPositions: async () => {},
  };
  const journal = {
    getClosedTrades: () => [{ tradeId: 't1' }],
    getTrades: () => [{ tradeId: 't1' }],
    computeMLCounts: () => ({ trainingEligible: 0 }),
  } as any;
  const res = await runResetScope('reset_ml', { journal, engine: engine as any, settingsPersistence: settings });
  ok(res.ok, '7 reset_ml verification passes');
  ok(state.open.length === 1, '8 reset_ml preserves open positions');
}

(async () => {
  await testResetTradingClearsRuntime();
  await testFullDemoResetResetsBalance();
  await testResetMlDoesNotClearOpen();
  console.log(`reset-service: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
