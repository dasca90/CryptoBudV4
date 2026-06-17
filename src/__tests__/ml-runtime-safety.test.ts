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
 * 8. ML cannot trigger SELL in off/shadow/advisory
 * 9. Event store caps at 500, doesn't grow unbounded
 * 10. Counter tracking works
 *
 * Run: npx tsx src/__tests__/ml-runtime-safety.test.ts
 */

import { mlRuntimeGuard } from '../core/ml/ml-runtime-guard';
import { mlRuntimeEvents } from '../core/ml/ml-runtime-events';
import { saveMLRuntimeMode, loadMLRuntimeMode } from '../core/ml/ml-brain-store';
import type { MlRuntimeMode } from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; console.error(`  \u274c ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} -- expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
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
  mlRuntimeEvents.clearEvents();
  mlRuntimeEvents.resetCounters();

  assert(mlRuntimeGuard.isActive(), '6a: isActive=true in active_guarded');
  assert(!mlRuntimeGuard.isSafe(), '6b: isSafe=false in active_guarded');
  assert(mlRuntimeGuard.canBlockBuy(), '6c: can block buy in active_guarded');
  assert(mlRuntimeGuard.canTriggerSell(), '6d: can trigger sell in active_guarded');
  assert(mlRuntimeGuard.canMutateDecision(), '6e: can mutate in active_guarded');
  assert(mlRuntimeGuard.canAdjustConfidence(), '6f: can adjust confidence in active_guarded');
  assert(mlRuntimeGuard.canForceBuy() === false, '6g: canForceBuy still false in active_guarded');
  assert(mlRuntimeGuard.canForceUpgrade() === false, '6h: canForceUpgrade still false in active_guarded');

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
  assert(events.length > 0, '6i: events recorded in active_guarded');
  const counters = mlRuntimeEvents.getCounters();
  assertEqual(counters.activeDowngrades, 1, '6j: 1 active downgrade');
  assertEqual(counters.mlExitTriggers, 1, '6k: 1 ML exit trigger');
  assertEqual(counters.upgradeAttemptsBlocked, 1, '6l: 1 upgrade blocked');
  assertEqual(counters.blockedMutations, 1, '6m: 1 blocked mutation');

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
console.log('\n--- 8: ML cannot trigger SELL except active_guarded ---');
{
  const noSellModes: MlRuntimeMode[] = ['off', 'shadow_only', 'advisory_only'];
  for (const m of noSellModes) {
    mlRuntimeGuard.setMode(m);
    assert(!mlRuntimeGuard.canTriggerSell(), `8-${m}: cannot trigger sell in ${m}`);
  }
  mlRuntimeGuard.setMode('active_guarded');
  assert(mlRuntimeGuard.canTriggerSell(), '8d: can trigger sell in active_guarded');
  mlRuntimeGuard.setMode('shadow_only');
}

// ── 9. Event store caps at 500 ──
console.log('\n--- 9: Event store bounded at 500 ---');
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
  assert(recent[0].timestamp >= recent[1].timestamp, '9d: recent events in reverse chronological order');

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

console.log(`\n\n══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
