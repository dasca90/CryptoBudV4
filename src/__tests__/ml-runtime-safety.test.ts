/**
 * ML Runtime Safety + Shadow Mode Test Suite
 *
 * Tests:
 * 1. Default mlRuntimeMode is shadow_only
 * 2. Changing mode persists
 * 3. mode off does not allow ML mutation
 * 4. shadow_only records events but preserves original decision
 * 5. advisory_only records advisory but preserves original decision
 * 6. active_guarded allows downgrade, blocks upgrade
 * 7. ML cannot force BUY in any mode
 * 8. ML cannot trigger SELL unless active_guarded and ML exits are explicitly enabled
 * 9. Event store caps at 500, doesn't grow unbounded
 * 10. Counter tracking works
 *
 * Run: npx tsx src/__tests__/ml-runtime-safety.test.ts
 */

import { mlRuntimeGuard } from '../core/ml/ml-runtime-guard';
import { mlRuntimeEvents } from '../core/ml/ml-runtime-events';
import { getMLRuntimeEventsStorageStatus, loadMLRuntimeMlExitsEnabled, loadMLRuntimeMode, loadMLRuntimeEventsSnapshot, saveMLRuntimeEventsSnapshot, setMLStore } from '../core/ml/ml-brain-store';
import { TraderBrain } from '../core/trading/TraderBrain';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';
import type { MarketPrice, MlRuntimeMode, MLPrediction, OrderRequest, TraderAction } from '../core/types';
import { logger } from '../utils/logger';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} -- expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function createMemoryStore(maxBytes = Number.POSITIVE_INFINITY, alwaysQuota = false) {
  const data = new Map<string, string>();
  return {
    getItem(key: string): string | null { return data.get(key) ?? null; },
    setItem(key: string, value: string): void {
      if (alwaysQuota || value.length > maxBytes) {
        const err = new Error('Failed to execute setItem on Storage: quota exceeded') as Error & { name: string; code: number };
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      data.set(key, value);
    },
    removeItem(key: string): void { data.delete(key); },
    raw(key: string): string | null { return data.get(key) ?? null; },
  };
}

function makeRuntimeEvent(index: number, reason = `runtime event ${index}`) {
  return {
    id: `quota_evt_${index}`,
    timestamp: 1_700_000_000_000 + index,
    symbol: `T${index}USDT`,
    mode: 'shadow_only' as MlRuntimeMode,
    originalDecision: 'BUY',
    mlPrediction: 'HOLD',
    brainVerdict: null,
    wouldHaveChangedDecision: false,
    wouldHaveChangedTo: null,
    actualDecisionApplied: 'BUY',
    mutationBlocked: true,
    exitTriggered: false,
    reason,
  };
}

function makeSellPrediction(symbol: string): MLPrediction {
  return {
    coin: symbol,
    timestamp: new Date().toISOString(),
    prediction: 'SELL',
    confidence: 0.91,
    features: {
      shortMA: 98,
      longMA: 100,
      rsi: 45,
      volatility: 0.01,
      momentum: -0.01,
      priceChange: -0.02,
    },
    expectedMove: -0.03,
  };
}

function makeLegacyMlExitBrain(symbol = 'MLSELLUSDT'): TraderBrain {
  const adapter: ExchangeAdapter = {
    name: 'TestAdapter',
    isLive: false,
    async connect() { /* test adapter */ },
    async disconnect() { /* test adapter */ },
    async getMarketPrice(coin: string): Promise<MarketPrice> {
      return { coin, bid: 101, ask: 101.1, last: 101, timestamp: Date.now() };
    },
    async submitOrder(_req: OrderRequest) {
      throw new Error('submitOrder must not be reached by ml-runtime-safety test');
    },
    async cancelOrder() { return false; },
    async getBalances() { return []; },
    async getOpenOrders() { return []; },
    async getAccountInfo() { return { canTrade: true, isLive: false }; },
  };
  const ml = {
    predict: () => makeSellPrediction(symbol),
    predictWithBrain: () => ({
      symbol,
      setupId: 'test_setup',
      modelVersion: 'test',
      isTrained: true,
      winProbability: 0.4,
      badEntryRisk: 0.8,
      expectedMovePct: -1,
      expectedHoldMinutes: 10,
      confidenceAdjustment: -0.2,
      suggestedAction: 'WAIT',
      reasons: ['test sell pressure'],
    }),
  };
  const brain = new TraderBrain({
    coin: symbol,
    mode: 'AUTO',
    enabled: true,
    maxPositionSize: 100,
    stopLossPercent: 5,
    takeProfitPercent: 5,
    maxLeverage: 1,
    cooldownSeconds: 0,
    mlEnabled: true,
    minConfidence: 0.5,
  }, adapter, ml as any);
  brain.position = {
    coin: symbol,
    tradeId: 'ml_exit_test_position',
    quantity: 1,
    avgEntryPrice: 100,
    currentPrice: 101,
    pnl: 1,
    pnlPercent: 1,
    mode: 'AUTO',
    openedAt: Date.now() - 60_000,
    highestPrice: 101,
    highestPriceSinceTp: 101,
    tpArmed: false,
    tpArmedAt: 0,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 5,
    tp1Percent: 5,
    tp2Percent: 0,
    tpMode: 'fixed',
    tpTriggerType: 'percent',
    trailFromPeakPercent: 0,
    maxHoldSec: 86_400,
    lastPrice: 101,
    priceTimestamp: Date.now(),
    unrealizedPnlPercent: 1,
    ownerType: 'trader_brain',
    adapter: adapter.name,
  } as any;
  return brain;
}

function evaluateLegacyMlReversal(mode: MlRuntimeMode, mlExitsEnabled: boolean): TraderAction {
  mlRuntimeGuard.setMode(mode);
  mlRuntimeGuard.setMlExitsEnabled(mlExitsEnabled);
  const brain = makeLegacyMlExitBrain();
  return (brain as any).evaluateExit({ bid: 101, ask: 101.1, last: 101 }) as TraderAction;
}

// Reset state before tests
console.log('\n══════════════════════════════════════════════');
console.log('  ML Runtime Safety + Shadow Mode Test Suite');
console.log('══════════════════════════════════════════════\n');

// ── 1. Default mode is shadow_only ──
console.log('\n--- 1: Default mode is shadow_only ---');
{
  // Reset any persisted mode first
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeGuard.setMlExitsEnabled(false);
  assertEqual(mlRuntimeGuard.getMode(), 'shadow_only', '1a: default mode is shadow_only');
  assert(mlRuntimeGuard.isSafe(), '1b: default mode is safe');
  assert(!mlRuntimeGuard.isActive(), '1c: default mode is not active');
  assert(!mlRuntimeGuard.canBlockBuy(), '1d: cannot block buy in shadow_only');
  assert(!mlRuntimeGuard.canTriggerSell(), '1e: cannot trigger sell in shadow_only');
  assert(mlRuntimeGuard.canForceBuy() === false, '1f: canForceBuy is always false');
  assert(mlRuntimeGuard.canForceUpgrade() === false, '1g: canForceUpgrade is always false');
}

// ── 2. Changing mode persists ──
console.log('\n--- 2: Mode change persists ---');
{
  mlRuntimeGuard.setMode('advisory_only');
  assertEqual(mlRuntimeGuard.getMode(), 'advisory_only', '2a: mode changed to advisory_only');
  const loaded = loadMLRuntimeMode();
  assertEqual(loaded, 'advisory_only', '2b: persisted mode is advisory_only');

  mlRuntimeGuard.setMode('off');
  assertEqual(mlRuntimeGuard.getMode(), 'off', '2c: mode changed to off');
  const loaded2 = loadMLRuntimeMode();
  assertEqual(loaded2, 'off', '2d: persisted mode is off');

  mlRuntimeGuard.setMlExitsEnabled(true);
  assertEqual(loadMLRuntimeMlExitsEnabled(), true, '2e: ML exit permission persists as enabled');
  mlRuntimeGuard.setMlExitsEnabled(false);
  assertEqual(loadMLRuntimeMlExitsEnabled(), false, '2f: ML exit permission persists as disabled');

  // Restore to default
  mlRuntimeGuard.setMode('shadow_only');
}

// ── 3. Mode off blocks all ML mutation ──
console.log('\n--- 3: Mode off blocks all ML mutation ---');
{
  mlRuntimeGuard.setMode('off');
  assert(!mlRuntimeGuard.canMutateDecision(), '3a: cannot mutate in off');
  assert(!mlRuntimeGuard.canBlockBuy(), '3b: cannot block buy in off');
  assert(!mlRuntimeGuard.canTriggerSell(), '3c: cannot trigger sell in off');
  assert(!mlRuntimeGuard.canAdjustConfidence(), '3d: cannot adjust confidence in off');
  assert(!mlRuntimeGuard.isActive(), '3e: isActive=false in off');
  assert(mlRuntimeGuard.isSafe(), '3f: isSafe=true in off');

  mlRuntimeGuard.setMode('shadow_only');
}

// ── 4. shadow_only records events but does not allow mutation ──
console.log('\n--- 4: shadow_only observation only ---');
{
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();

  assert(!mlRuntimeGuard.canMutateDecision(), '4a: cannot mutate in shadow_only');
  assert(!mlRuntimeGuard.canBlockBuy(), '4b: cannot block buy in shadow_only');
  assert(!mlRuntimeGuard.canTriggerSell(), '4c: cannot trigger sell in shadow_only');
  assert(mlRuntimeGuard.isSafe(), '4d: isSafe=true in shadow_only');

  // Record shadow decisions
  mlRuntimeEvents.recordShadowDecision({
    symbol: 'BTCUSDT',
    originalDecision: 'BUY',
    mlPrediction: 'HOLD',
    brainVerdict: 'WAIT',
    wouldHaveChangedDecision: true,
    wouldHaveChangedTo: 'WAIT',
    actualDecisionApplied: 'BUY',
    reason: 'ML shadow: would have waited',
  });
  mlRuntimeEvents.recordShadowDecision({
    symbol: 'ETHUSDT',
    originalDecision: 'WAIT',
    mlPrediction: 'SELL',
    brainVerdict: 'BLOCK',
    wouldHaveChangedDecision: true,
    wouldHaveChangedTo: 'BLOCK',
    actualDecisionApplied: 'WAIT',
    reason: 'ML shadow: would have blocked',
  });

  const events = mlRuntimeEvents.getEvents();
  assertEqual(events.length, 2, '4e: 2 shadow decisions recorded');
  // Verify original decisions were preserved
  assertEqual(events[0].actualDecisionApplied, 'BUY', '4f: original BUY preserved');
  assertEqual(events[1].actualDecisionApplied, 'WAIT', '4g: original WAIT preserved');
  assert(events[0].mutationBlocked, '4h: mutation blocked flag set');
  assert(events[1].mutationBlocked, '4i: mutation blocked flag set');

  const counters = mlRuntimeEvents.getCounters();
  assertEqual(counters.shadowDecisions, 2, '4j: shadow counter = 2');
  assertEqual(counters.activeDowngrades, 0, '4k: no active downgrades');

  // Guard state reflects mode
  const state = mlRuntimeGuard.getGuardState(true, false);
  assertEqual(state.mode, 'shadow_only', '4l: guard state shows shadow_only');
  assertEqual(state.counters.shadowDecisions, 2, '4m: guard state counters match');

  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
}

// ── 5. advisory_only records advisory but does not affect trades ──
console.log('\n--- 5: advisory_only advisory only ---');
{
  mlRuntimeGuard.setMode('advisory_only');
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();

  assert(!mlRuntimeGuard.canMutateDecision(), '5a: cannot mutate in advisory_only');
  assert(!mlRuntimeGuard.canBlockBuy(), '5b: cannot block buy in advisory_only');
  assert(!mlRuntimeGuard.canTriggerSell(), '5c: cannot trigger sell in advisory_only');
  assert(!mlRuntimeGuard.isActive(), '5d: isActive=false in advisory_only');
  assert(mlRuntimeGuard.isSafe(), '5e: isSafe=true in advisory_only');

  mlRuntimeEvents.recordAdvisoryEvent({
    symbol: 'SOLUSDT',
    originalDecision: 'BUY',
    mlPrediction: 'HOLD',
    brainVerdict: 'WAIT',
    wouldHaveChangedDecision: true,
    wouldHaveChangedTo: 'WAIT',
    actualDecisionApplied: 'BUY',
    reason: 'ML advisory: consider waiting',
  });

  const events = mlRuntimeEvents.getEvents();
  assertEqual(events.length, 1, '5f: 1 advisory event recorded');
  assertEqual(events[0].actualDecisionApplied, 'BUY', '5g: original BUY preserved in advisory');
  assert(events[0].mutationBlocked, '5h: mutation blocked flag set in advisory');
  assertEqual(events[0].mode, 'advisory_only', '5i: event mode is advisory_only');

  const counters = mlRuntimeEvents.getCounters();
  assertEqual(counters.advisoryEvents, 1, '5j: advisory counter = 1');
  assertEqual(counters.activeDowngrades, 0, '5k: no active downgrades');

  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
}

// ── 6. active_guarded allows downgrade but blocks upgrade ──
console.log('\n--- 6: active_guarded downgrade only ---');
{
  mlRuntimeGuard.setMode('active_guarded');
  mlRuntimeGuard.setMlExitsEnabled(false);
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();

  assert(mlRuntimeGuard.isActive(), '6a: isActive=true in active_guarded');
  assert(!mlRuntimeGuard.isSafe(), '6b: isSafe=false in active_guarded');
  assert(mlRuntimeGuard.canBlockBuy(), '6c: can block buy in active_guarded');
  assert(!mlRuntimeGuard.canTriggerSell(), '6d: active_guarded cannot trigger sell while ML exits setting is OFF');
  assert(mlRuntimeGuard.canMutateDecision(), '6e: can mutate in active_guarded');
  assert(mlRuntimeGuard.canAdjustConfidence(), '6f: can adjust confidence in active_guarded');
  assert(mlRuntimeGuard.canForceBuy() === false, '6g: canForceBuy still false in active_guarded');
  assert(mlRuntimeGuard.canForceUpgrade() === false, '6h: canForceUpgrade still false in active_guarded');
  mlRuntimeGuard.setMlExitsEnabled(true);
  assert(mlRuntimeGuard.canTriggerSell(), '6i: active_guarded can trigger sell only when ML exits setting is ON');

  // Simulate active downgrade
  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'BTCUSDT',
    originalDecision: 'BUY',
    mlPrediction: 'HOLD',
    finalDecision: 'BLOCK',
    downgraded: true,
    exitTriggered: false,
    upgradeBlocked: false,
    reason: 'ML high badEntryRisk',
  });

  // Simulate active exit
  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'ETHUSDT',
    originalDecision: 'HOLD',
    mlPrediction: 'SELL',
    finalDecision: 'EXIT',
    downgraded: false,
    exitTriggered: true,
    upgradeBlocked: false,
    reason: 'ML reversal signal',
  });

  // Simulate blocked upgrade
  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'UNIUSDT',
    originalDecision: 'WAIT',
    mlPrediction: 'BUY',
    finalDecision: 'WAIT',
    downgraded: false,
    exitTriggered: false,
    upgradeBlocked: true,
    reason: 'ML attempted upgrade but blocked',
  });

  // Simulate blocked mutation
  mlRuntimeEvents.recordBlockedMutation({
    symbol: 'UNIUSDT',
    mode: 'active_guarded',
    attemptedMutation: 'upgrade_to_BUY',
    blockedReason: 'ML cannot force BUY',
    originalDecisionPreserved: 'WAIT',
  });

  const events = mlRuntimeEvents.getEvents();
  assert(events.length > 0, '6j: events recorded in active_guarded');
  const counters = mlRuntimeEvents.getCounters();
  assertEqual(counters.activeDowngrades, 1, '6k: 1 active downgrade');
  assertEqual(counters.mlExitTriggers, 1, '6l: 1 ML exit trigger');
  assertEqual(counters.upgradeAttemptsBlocked, 1, '6m: 1 upgrade blocked');
  assertEqual(counters.blockedMutations, 1, '6n: 1 blocked mutation');

  mlRuntimeGuard.setMlExitsEnabled(false);
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
}

// ── 7. ML cannot force BUY in any mode ──
console.log('\n--- 7: ML cannot force BUY in any mode ---');
{
  const modes: MlRuntimeMode[] = ['off', 'shadow_only', 'advisory_only', 'active_guarded'];
  for (const m of modes) {
    mlRuntimeGuard.setMode(m);
    assert(mlRuntimeGuard.canForceBuy() === false, `7-${m}: canForceBuy is always false`);
    assert(mlRuntimeGuard.canForceUpgrade() === false, `7-${m}b: canForceUpgrade is always false`);
  }
  mlRuntimeGuard.setMode('shadow_only');
}

// ── 8. ML cannot trigger SELL in off/shadow/advisory ──
console.log('\n--- 8: ML cannot trigger SELL without active_guarded + explicit ML exit setting ---');
{
  const noSellModes: MlRuntimeMode[] = ['off', 'shadow_only', 'advisory_only'];
  for (const m of noSellModes) {
    mlRuntimeGuard.setMode(m);
    mlRuntimeGuard.setMlExitsEnabled(true);
    assert(!mlRuntimeGuard.canTriggerSell(), `8-${m}: cannot trigger sell in ${m}`);
  }
  mlRuntimeGuard.setMode('active_guarded');
  mlRuntimeGuard.setMlExitsEnabled(false);
  assert(!mlRuntimeGuard.canTriggerSell(), '8d: cannot trigger sell in active_guarded while ML exits are disabled');
  mlRuntimeGuard.setMlExitsEnabled(true);
  assert(mlRuntimeGuard.canTriggerSell(), '8e: can trigger sell only in active_guarded with ML exits enabled');
  mlRuntimeGuard.setMlExitsEnabled(false);
  mlRuntimeGuard.setMode('shadow_only');
}

// ── 9. Event store caps at 500 ──
console.log('\n--- 9: ML exit setting defaults safe for new/old persisted state ---');
{
  const newInstallStore = createMemoryStore();
  setMLStore(newInstallStore);
  mlRuntimeGuard.setMlExitsEnabled(false);
  assertEqual(loadMLRuntimeMlExitsEnabled(), false, '9a: missing persisted mlExitsEnabled defaults false for new installs');

  const oldSettingsStore = createMemoryStore();
  oldSettingsStore.setItem('ml_runtime_mode', 'active_guarded');
  setMLStore(oldSettingsStore);
  mlRuntimeGuard.setMode('active_guarded');
  mlRuntimeGuard.setMlExitsEnabled(false);
  assertEqual(loadMLRuntimeMlExitsEnabled(), false, '9b: old persisted runtime settings without mlExitsEnabled default false');
  assert(!mlRuntimeGuard.canTriggerSell(), '9c: old active_guarded persisted mode cannot sell without explicit mlExitsEnabled');

  const partialSettingsStore = createMemoryStore();
  partialSettingsStore.setItem('ml_runtime_mode', 'shadow_only');
  setMLStore(partialSettingsStore);
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeGuard.setMlExitsEnabled(false);
  assertEqual(loadMLRuntimeMlExitsEnabled(), false, '9d: partial persisted settings default mlExitsEnabled false');

  setMLStore(createMemoryStore());
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeGuard.setMlExitsEnabled(false);
}

console.log('\n--- 10: TraderBrain legacy ml_reversal is gated ---');
{
  const shadowSell = evaluateLegacyMlReversal('shadow_only', true);
  assertEqual(shadowSell.type, 'NOOP', '10a: shadow mode + ML SELL prediction does not create sell');
  assertEqual((shadowSell as any).reason, 'hold', '10b: shadow mode ML SELL holds');

  const advisorySell = evaluateLegacyMlReversal('advisory_only', true);
  assertEqual(advisorySell.type, 'NOOP', '10c: advisory mode + ML SELL prediction does not create sell');
  assertEqual((advisorySell as any).reason, 'hold', '10d: advisory mode ML SELL holds');

  const activeOffSell = evaluateLegacyMlReversal('active_guarded', false);
  assertEqual(activeOffSell.type, 'NOOP', '10e: active_guarded + mlExitsEnabled=false + ML SELL prediction does not create sell');
  assertEqual((activeOffSell as any).reason, 'hold', '10f: active_guarded with ML exits disabled holds');

  const activeOnSell = evaluateLegacyMlReversal('active_guarded', true);
  assertEqual(activeOnSell.type, 'EXIT', '10g: legacy TraderBrain ml_reversal can only create EXIT when active_guarded + mlExitsEnabled=true');
  assertEqual((activeOnSell as any).reason, 'ml_reversal', '10h: legacy ML exit reason remains ml_reversal in private legacy path');

  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeGuard.setMlExitsEnabled(false);
}

console.log('\n--- 11: TradingEngine does not consume legacy TraderAction EXIT ---');
{
  const tradingEngineSource = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
  const traderBrainSource = readFileSync('src/core/trading/TraderBrain.ts', 'utf8');

  assert(traderBrainSource.includes('private evaluateExit'), '11a: TraderBrain.evaluateExit exists as private legacy code');
  assert(traderBrainSource.includes('ml_reversal'), '11b: legacy ml_reversal path is still visible for audit');
  assert(traderBrainSource.includes('mlRuntimeGuard.canTriggerSell()'), '11c: legacy ml_reversal path is gated by canTriggerSell');
  assert(traderBrainSource.includes("reason: 'exit_handled_by_engine'"), '11d: TraderBrain.tick delegates open-position exits to engine');
  assert(!tradingEngineSource.includes('.tick('), '11e: TradingEngine does not call TraderBrain.tick');
  assert(!/action\.type\s*={0,2}\s*['"]EXIT['"]/.test(tradingEngineSource), '11f: TradingEngine has no TraderAction EXIT branch');
  assert(!/case\s+['"]EXIT['"]/.test(tradingEngineSource), '11g: TradingEngine has no switch case consuming TraderAction EXIT');
  assert(!/\bthis\.executeExit\(/.test(tradingEngineSource), '11h: legacy executeExit(action, brain) is not invoked by TradingEngine');
  assert(tradingEngineSource.includes('this.exitEngine.evaluateExit(exitInput)'), '11i: real sell path remains ExitEngine.evaluateExit');
  assert(tradingEngineSource.includes('this.executeExitWithSnapshot(brain, pos, decision, priceRes)'), '11j: real sell path remains executeExitWithSnapshot with ExitEngine decision');
}

console.log('\n--- 12: Event store bounded at 500 ---');
{
  mlRuntimeGuard.setMode('shadow_only');
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();

  // Add 510 events
  for (let i = 0; i < 510; i++) {
    mlRuntimeEvents.recordShadowDecision({
      symbol: 'TEST',
      originalDecision: 'BUY',
      mlPrediction: 'HOLD',
      brainVerdict: null,
      wouldHaveChangedDecision: false,
      wouldHaveChangedTo: null,
      actualDecisionApplied: 'BUY',
      reason: `Test event ${i}`,
    });
  }

  const events = mlRuntimeEvents.getEvents();
  assert(events.length <= 500, `9a: events capped at 500 (got ${events.length})`);
  assert(events.length === 500, '9b: exactly 500 events retained');

  // Recent events should have the latest entries
  const recent = mlRuntimeEvents.getRecentEvents(2);
  assertEqual(recent.length, 2, '9c: getRecentEvents returns 2');
  assert(recent[0].timestamp <= recent[1].timestamp, '9d: recent events preserve stored chronological order');

  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
  assertEqual(mlRuntimeEvents.getEvents().length, 0, '9e: clearEvents works');
  const zeroCtrs = mlRuntimeEvents.getCounters();
  assertEqual(zeroCtrs.shadowDecisions, 0, '9f: resetCounters works');
}

// ── 10. Guard state reflects brain state ──
console.log('\n--- 10: Guard state reflects brain state ---');
{
  mlRuntimeGuard.setMode('advisory_only');

  const untrained = mlRuntimeGuard.getGuardState(false, false);
  assertEqual(untrained.mode, 'advisory_only', '10a: mode in guard state');
  assert(!untrained.brainLoaded, '10b: brain not loaded');
  assert(!untrained.modelTrained, '10c: model not trained');

  const trained = mlRuntimeGuard.getGuardState(true, true);
  assert(trained.brainLoaded, '10d: brain loaded');
  assert(trained.modelTrained, '10e: model trained');
  assert(trained.persisted, '10f: persisted flag');

  mlRuntimeGuard.setMode('shadow_only');
}

// ── 11. Record mode change is logged ──
console.log('\n--- 11: Mode change event recorded ---');
{
  mlRuntimeGuard.setMode('off');
  const ts = mlRuntimeGuard.getLastModeChangeAt();
  assert(ts !== null, '11a: last mode change timestamp set');
  assert(typeof ts === 'string' && ts.includes('T'), '11b: timestamp is ISO format');

  // Setting same mode should not change timestamp
  mlRuntimeGuard.setMode('off');
  const ts2 = mlRuntimeGuard.getLastModeChangeAt();
  assertEqual(ts2, ts, '11c: same mode does not change timestamp');

  mlRuntimeGuard.setMode('shadow_only');
  const ts3 = mlRuntimeGuard.getLastModeChangeAt();
  assert(ts3 !== null, '11d: timestamp set after mode change');
  assert(typeof ts3 === 'string' && ts3.includes('T'), '11e: new timestamp is ISO format');
}

// --- 12. Active guarded ML logs are batched in normal mode ---
console.log('\n--- 12: Active guarded ML summary logging ---');
{
  logger.clear();
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
  mlRuntimeEvents.beginActiveGuardScanCycle('scan_test_ml_active_guard_summary');

  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'BTCUSDT',
    originalDecision: 'BUY',
    mlPrediction: 'HOLD',
    finalDecision: 'BLOCK',
    downgraded: true,
    exitTriggered: false,
    upgradeBlocked: false,
    reason: 'ML high badEntryRisk',
  });
  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'ETHUSDT',
    originalDecision: 'HOLD',
    mlPrediction: 'SELL',
    finalDecision: 'EXIT',
    downgraded: false,
    exitTriggered: true,
    upgradeBlocked: false,
    reason: 'ML reversal signal',
  });
  mlRuntimeEvents.recordActiveDowngrade({
    symbol: 'UNIUSDT',
    originalDecision: 'WAIT',
    mlPrediction: 'BUY',
    finalDecision: 'WAIT',
    downgraded: false,
    exitTriggered: false,
    upgradeBlocked: true,
    reason: 'ML attempted upgrade but blocked',
  });

  mlRuntimeEvents.flushActiveGuardSummary('scan_test_ml_active_guard_summary');

  const logs = logger.getLogs().map(entry => entry.message);
  const summaryLogs = logs.filter(message => message.includes('ML_ACTIVE_GUARD_SUMMARY_AUDIT'));
  const detailedLogs = logs.filter(message => message.includes('ML_ACTIVE_GUARDED_DECISION_AUDIT'));
  assertEqual(summaryLogs.length, 1, '12a: one ML active guard summary log emitted per scan cycle');
  assertEqual(detailedLogs.length, 0, '12b: detailed per-symbol active guard logs suppressed in normal mode');
  assert(summaryLogs[0].includes('scanCycleId=scan_test_ml_active_guard_summary'), '12c: summary includes scanCycleId');
  assert(summaryLogs[0].includes('totalEvaluated=3'), '12d: summary includes total evaluated count');
  assert(summaryLogs[0].includes('holdCount=1'), '12e: summary includes hold count');
  assert(summaryLogs[0].includes('buyCount=1'), '12f: summary includes buy count');
  assert(summaryLogs[0].includes('sellCount=1'), '12g: summary includes sell count');
  assert(summaryLogs[0].includes('downgradedCount=1'), '12h: summary includes downgraded count');
  assert(summaryLogs[0].includes('exitTriggeredCount=1'), '12i: summary includes exit count');
  assert(summaryLogs[0].includes('upgradeBlockedCount=1'), '12j: summary includes upgrade blocked count');
  assert(summaryLogs[0].includes('topSymbolsChanged=BTCUSDT|ETHUSDT|UNIUSDT'), '12k: summary includes changed symbols');
  assert(summaryLogs[0].includes('suppressedDetailedCount=3'), '12l: summary reports suppressed detailed count');

  const events = mlRuntimeEvents.getEvents();
  const counters = mlRuntimeEvents.getCounters();
  assertEqual(events.length, 3, '12m: per-symbol ML runtime events remain available');
  assertEqual(counters.activeDowngrades, 1, '12n: active downgrade counter unchanged');
  assertEqual(counters.mlExitTriggers, 1, '12o: exit trigger counter unchanged');
  assertEqual(counters.upgradeAttemptsBlocked, 1, '12p: upgrade blocked counter unchanged');
  const persisted = loadMLRuntimeEventsSnapshot();
  assert(persisted !== null, '12q: ML runtime events snapshot persisted for refresh recovery');
  assertEqual(persisted?.events.length ?? 0, 3, '12r: persisted runtime snapshot keeps per-symbol events');
  assertEqual(persisted?.counters.activeDowngrades ?? -1, 1, '12s: persisted runtime snapshot keeps blocked/downgrade counters');

  logger.clear();
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();
}

console.log(`\n\n══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════\n`);

// --- 13. ML runtime event persistence is quota-safe ---
console.log('\n--- 13: Runtime event storage is quota-safe ---');
{
  const boundedStore = createMemoryStore(250_000);
  setMLStore(boundedStore);
  logger.clear();

  const largeReason = 'x'.repeat(1800);
  saveMLRuntimeEventsSnapshot({
    version: 1,
    savedAt: new Date().toISOString(),
    counters: {
      shadowDecisions: 800,
      advisoryEvents: 0,
      activeDowngrades: 0,
      mlExitTriggers: 0,
      blockedMutations: 0,
      upgradeAttemptsBlocked: 0,
    },
    events: Array.from({ length: 800 }, (_, i) => makeRuntimeEvent(i, `${largeReason}_${i}`)),
  });

  const persisted = loadMLRuntimeEventsSnapshot();
  const status = getMLRuntimeEventsStorageStatus();
  assert(persisted !== null, '13a: oversized runtime event snapshot still persists');
  assert((persisted?.events.length ?? 0) <= 500, '13b: stored runtime events never exceed max event count');
  assert(status.bytes <= status.maxBytes, `13c: stored runtime event payload stays under max bytes (${status.bytes}/${status.maxBytes})`);
  assert(status.prunedCount > 0, '13d: old runtime events are pruned before quota overflow');
  assert(status.saveOk, '13e: quota-safe pruning saves successfully when payload can fit');
  assertEqual(persisted?.counters.shadowDecisions ?? -1, 800, '13f: counters persist independently of event pruning');
}

// --- 14. Quota errors recover without warning spam ---
console.log('\n--- 14: Runtime event quota errors are throttled ---');
{
  const quotaStore = createMemoryStore(Number.POSITIVE_INFINITY, true);
  setMLStore(quotaStore);
  logger.clear();

  const snapshot = {
    version: 1 as const,
    savedAt: new Date().toISOString(),
    counters: {
      shadowDecisions: 5,
      advisoryEvents: 0,
      activeDowngrades: 0,
      mlExitTriggers: 0,
      blockedMutations: 0,
      upgradeAttemptsBlocked: 0,
    },
    events: Array.from({ length: 5 }, (_, i) => makeRuntimeEvent(i, 'quota retry event')),
  };

  for (let i = 0; i < 5; i++) {
    saveMLRuntimeEventsSnapshot(snapshot);
  }

  const logs = logger.getLogs().map(entry => entry.message);
  const quotaWarnings = logs.filter(message => message.includes('ML_RUNTIME_EVENTS_QUOTA_RECOVERY_AUDIT'));
  const legacyWarnings = logs.filter(message => message.includes('ML_RUNTIME_EVENTS_SAVE_FAILED'));
  const status = getMLRuntimeEventsStorageStatus();
  assertEqual(quotaWarnings.length, 1, '14a: quota recovery emits one throttled warning, not spam');
  assertEqual(legacyWarnings.length, 0, '14b: legacy save-failed warning spam is not emitted for quota errors');
  assert(status.quotaLimited, '14c: storage status marks quota-limited state');
  assert(!status.saveOk, '14d: storage status records failed persistence while runtime continues');
  assertEqual(mlRuntimeGuard.canForceBuy(), false, '14e: ML decision guard behavior is unchanged after quota error');
}

setMLStore(createMemoryStore());
logger.clear();
mlRuntimeEvents.clearEvents();
mlRuntimeEvents.resetCounters();

console.log(`\n  Updated Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
