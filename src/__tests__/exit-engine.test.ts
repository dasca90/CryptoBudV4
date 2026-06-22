/**
 * Exit Engine Test Suite
 *
 * Priority order: INVALID_PRICE → SL → TP1 → TP2 → Dynamic Trail → Armed Trail → Time → Manual
 *
 * Run: npx tsx src/__tests__/exit-engine.test.ts
 */

import { ExitEngine } from '../core/exits/ExitEngine';
import { evaluateDynamicTrailFloor } from '../core/exits/dynamic-trailing';
import type { ExitInput, DynamicTrailInput } from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function makeInput(overrides?: Partial<ExitInput>): ExitInput {
  return {
    coin: 'BTCUSDT',
    entryPrice: 100,
    quantity: 1,
    currentPrice: 101,
    bidPrice: 100.9,
    askPrice: 101.1,
    lastPrice: 101,
    priceTimestamp: Date.now(),
    openedAt: Date.now() - 60000,
    highestPrice: 105,
    highestPriceSinceTp: 101,
    tpArmed: true,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 2,
    tp1Percent: 3,
    tp2Percent: 6,
    trailFromPeakPercent: 1,
    maxHoldSec: 86400,
    mode: 'AUTO',
    isLive: false,
    timeBasedExitEnabled: false,
    resumeGuardActive: false,
    exitCyclesSinceHydration: 6,
    maxTimeBasedExitsPerCycle: 2,
    priceAgeMs: 0,
    ...overrides,
  };
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Exit Engine Test Suite');
  console.log('══════════════════════════════════════════════\n');

  const engine = new ExitEngine();

  // ── A: Invalid price — should HOLD with INVALID_PRICE ──
  console.log('\n── A: SL has highest priority, evaluated before all ──\n');

  const slInput = makeInput({ currentPrice: 97, stopLossPercent: 2 });
  const slResult = engine.evaluateExit(slInput);
  assert(slResult.shouldClosePosition === true, 'A1: SL triggers exit when pnl <= -slPercent');
  assert(slResult.exitReason === 'STOP_LOSS', `A2: Exit reason is STOP_LOSS (got ${slResult.exitReason})`);
  assertEqual(slResult.pnlPercent, -3, 'A3: PnL% is -3% (97 vs 100 entry)');

  // ── B: Invalid price — should HOLD with INVALID_PRICE ──
  console.log('\n── B: Invalid price should not exit ──\n');

  const invalidInput = makeInput({ currentPrice: 0 });
  const invalidResult = engine.evaluateExit(invalidInput);
  assert(invalidResult.shouldClosePosition === false, 'B1: Zero price returns HOLD');
  assert(invalidResult.exitReason === 'INVALID_PRICE', `B2: Exit reason is INVALID_PRICE (got ${invalidResult.exitReason})`);

  const nanInput = makeInput({ currentPrice: NaN });
  const nanResult = engine.evaluateExit(nanInput);
  assert(nanResult.shouldClosePosition === false, 'B3: NaN price returns HOLD');

  // ── C: TP1 fixed exit ──
  console.log('\n── C: TP1 fixed exit ──\n');

  const tp1Input = makeInput({ currentPrice: 103.5, tp1Percent: 3 });
  const tp1Result = engine.evaluateExit(tp1Input);
  assert(tp1Result.shouldClosePosition === true, 'C1: TP1 triggers exit at 103.5 (above 3%)');
  assert(tp1Result.exitReason === 'TP1_FIXED', `C2: Exit reason is TP1_FIXED (got ${tp1Result.exitReason})`);

  const tp1NotHit = makeInput({ currentPrice: 102.5, tp1Percent: 3 });
  const tp1NotHitResult = engine.evaluateExit(tp1NotHit);
  assert(tp1NotHitResult.shouldClosePosition === false, 'C3: TP1 does not trigger at 102.5 (below 3%)');

  // ── D: TP2 fixed exit (after TP1 hit) ──
  console.log('\n── D: TP2 fixed exit ──\n');

  const tp2Input = makeInput({ currentPrice: 107, tp1Hit: true, tp2Percent: 6 });
  const tp2Result = engine.evaluateExit(tp2Input);
  assert(tp2Result.shouldClosePosition === true, 'D1: TP2 triggers exit at 107 (above 6%)');
  assert(tp2Result.exitReason === 'TP2_FIXED', `D2: Exit reason is TP2_FIXED (got ${tp2Result.exitReason})`);

  // Without TP1 hit, TP1 check fires first (price 107 > tp1 103)
  const tp2WithoutTp1 = makeInput({ currentPrice: 107, tp1Hit: false, tp2Percent: 6 });
  const tp2WithoutTp1Result = engine.evaluateExit(tp2WithoutTp1);
  assert(tp2WithoutTp1Result.shouldClosePosition === true, 'D3: TP1 fires before TP2 when tp1Percent=3 (price 107 > 103)');
  assert(tp2WithoutTp1Result.exitReason === 'TP1_FIXED', 'D4: Reason is TP1_FIXED (TP1 priority over TP2)');

  // ── E: Dynamic trail exit ──
  console.log('\n── E: Dynamic trail exit ──\n');

  // tp1Percent=1 → TP1 fires at 101, but we set tp1Hit=true to skip it and reach trail
  const trailInput = makeInput({
    currentPrice: 102,
    entryPrice: 100,
    tpArmed: true,
    tp1Hit: true,
    highestPriceSinceTp: 107,
    trailFromPeakPercent: 2,
    tp1Percent: 1,
  });
  const trailResult = engine.evaluateExit(trailInput);
  assert(trailResult.shouldClosePosition === true, 'E1: Dynamic trail triggers (retraced 4.7% from 107 to 102, trail 2% from peak = 104.86)');
  assert(trailResult.exitReason === 'DYNAMIC_TRAIL', `E2: Exit reason is DYNAMIC_TRAIL (got ${trailResult.exitReason})`);

  const trailNotHit = makeInput({
    currentPrice: 106,
    entryPrice: 100,
    tpArmed: true,
    tp1Hit: true,
    highestPriceSinceTp: 107,
    trailFromPeakPercent: 2,
    tp1Percent: 1,
    tp2Percent: 8,
  });
  const trailNotHitResult = engine.evaluateExit(trailNotHit);
  assert(trailNotHitResult.shouldClosePosition === false, 'E3: Trail does not trigger at 106 (above trail 104.86, below TP2 108)');

  // ── F: Dynamic trail floor breach ──
  console.log('\n── F: Dynamic trail floor breach ──\n');

  // trail=5% from peak 105 → 99.75, floor at tp1=1% → 101, current 99 below floor
  const floorInput = makeInput({
    currentPrice: 99,
    entryPrice: 100,
    tpArmed: true,
    tp1Hit: true,
    highestPriceSinceTp: 105,
    trailFromPeakPercent: 5,
    tp1Percent: 1,
  });
  const floorResult = engine.evaluateExit(floorInput);
  assert(floorResult.shouldClosePosition === true, 'F1: Trail floor triggers exit below TP1 floor');
  assert(floorResult.exitReason === 'DYNAMIC_TRAIL_FLOOR', `F2: Exit reason is DYNAMIC_TRAIL_FLOOR (got ${floorResult.exitReason})`);

  // ── G: Time-based exit ──
  console.log('\n── G: Time-based exit ──\n');

  const timeInput = makeInput({
    currentPrice: 101,
    openedAt: Date.now() - 100000,
    maxHoldSec: 10,
    timeBasedExitEnabled: true,
  });
  const timeResult = engine.evaluateExit(timeInput);
  assert(timeResult.shouldClosePosition === true, 'G1: Time-based exit triggers after maxHoldSec');
  assert(timeResult.exitReason === 'TIME_BASED_EXIT', `G2: Exit reason is TIME_BASED_EXIT (got ${timeResult.exitReason})`);

  const timeDisabled = makeInput({
    currentPrice: 101,
    openedAt: Date.now() - 100000,
    maxHoldSec: 10,
    timeBasedExitEnabled: false,
  });
  const timeDisabledResult = engine.evaluateExit(timeDisabled);
  assert(timeDisabledResult.shouldClosePosition === false, 'G3: Time-based exit does not trigger when disabled');

  const timeResumeGuard = makeInput({
    currentPrice: 101,
    openedAt: Date.now() - 100000,
    maxHoldSec: 10,
    timeBasedExitEnabled: true,
    resumeGuardActive: true,
    exitCyclesSinceHydration: 1,
  });
  const timeResumeGuardResult = engine.evaluateExit(timeResumeGuard);
  assert(timeResumeGuardResult.shouldClosePosition === false, 'G4: Resume guard blocks hydrated old position');

  const staleTimeInput = makeInput({
    currentPrice: 101,
    openedAt: Date.now() - 100000,
    maxHoldSec: 10,
    timeBasedExitEnabled: true,
    priceAgeMs: 60000,
  });
  const staleTimeResult = engine.evaluateExit(staleTimeInput);
  assert(staleTimeResult.shouldClosePosition === false, 'G5: Stale price cannot trigger Time-Based Exit');

  const batchEngine = new ExitEngine();
  batchEngine.startCycle(1);
  const batchInputs = Array.from({ length: 5 }, (_, index) => makeInput({
    coin: `BATCH${index}USDT`,
    currentPrice: 101,
    openedAt: Date.now() - 100000,
    maxHoldSec: 10,
    timeBasedExitEnabled: true,
    maxTimeBasedExitsPerCycle: 2,
  }));
  const batchClosed = batchInputs.filter((input) => batchEngine.evaluateExit(input).shouldClosePosition).length;
  assert(batchClosed === 2, `G6: Batch limit allows only 2 Time-Based Exits per cycle (got ${batchClosed})`);

  // ── H: SL priority over TP ──
  console.log('\n── H: SL priority over TP ──\n');

  const slTpInput = makeInput({
    currentPrice: 95,
    tp1Percent: 3,
    stopLossPercent: 2,
  });
  const slTpResult = engine.evaluateExit(slTpInput);
  assert(slTpResult.shouldClosePosition === true, 'H1: SL fires at 95 even though TP conditions would also trigger');
  assert(slTpResult.exitReason === 'STOP_LOSS', `H2: Exit reason is STOP_LOSS not TP (got ${slTpResult.exitReason})`);

  // ── I: DynamicTrailFloor unit tests ──
  console.log('\n── I: DynamicTrailFloor unit tests ──\n');

  const dtInput: DynamicTrailInput = {
    entryPrice: 100,
    tp1Percent: 1,
    highestPriceSinceTp: 110,
    trailFromPeakPercent: 2,
    currentMarketPrice: 109,
  };
  const dt1 = evaluateDynamicTrailFloor(dtInput);
  assert(dt1.shouldExit === false, 'I1: No exit at 109 (above trail exit 107.8)');
  assertEqual(dt1.highestPriceSinceTp, 110, 'I2: Highest price preserved at 110');

  const dtInput2: DynamicTrailInput = {
    entryPrice: 100,
    tp1Percent: 1,
    highestPriceSinceTp: 110,
    trailFromPeakPercent: 5,
    currentMarketPrice: 103,
  };
  const dt2 = evaluateDynamicTrailFloor(dtInput2);
  assert(dt2.shouldExit === true, 'I3: Exit at 103 (below trail 104.5)');

  const dtInput3: DynamicTrailInput = {
    entryPrice: 100,
    tp1Percent: 1,
    highestPriceSinceTp: 103,
    trailFromPeakPercent: 2,
    currentMarketPrice: 105,
  };
  const dt3 = evaluateDynamicTrailFloor(dtInput3);
  assertEqual(dt3.highestPriceSinceTp, 105, 'I4: Highest price updates to 105');
  assert(dt3.shouldExit === false, 'I5: No exit at 105 (above trail floor)');

  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
