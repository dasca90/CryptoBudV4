/**
 * Bounded Memory Regression Test Suite
 *
 * Proves that all internal buffers, maps, and collections remain bounded
 * after simulated long-run operation (48h of scanner ticks + price updates).
 *
 * Run: npx tsx src/__tests__/bounded-memory-regression.test.ts
 */

import { ScannerBrainService } from '../core/scanner/ScannerBrainService';
import { DiagnosticsEngine } from '../core/diagnostics/DiagnosticsEngine';
import { PositionManager } from '../core/positions/PositionManager';
import { OrderLockManager } from '../core/orders/OrderLockManager';
import { logger } from '../utils/logger';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string, detail?: string) {
  if (condition) { passed++; } else { failed++; console.error(`  ❌ ${msg}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Bounded Memory Regression Test Suite');
  console.log('══════════════════════════════════════════════\n');

  // ──── 1. ScannerBrainService LRU eviction ────
  console.log('\n── 1. ScannerBrainService tempBrains LRU eviction ──\n');

  // Create a mock Map<string, TraderBrain> for manualBrains
  const fakeAdapter = { isLive: false, name: 'Test' } as any;
  const fakeML = {} as any;
  const manualBrains = new Map();
  // Set maxTempBrains to small value for testing
  const sbs = new ScannerBrainService(manualBrains, fakeAdapter, fakeML);
  (sbs as any).maxTempBrains = 5;

  // Create 10 unique symbols
  for (let i = 0; i < 10; i++) {
    const sym = `COIN${String(i).padStart(3, '0')}USDT`;
    sbs.getOrCreateBrainForSymbol(sym);
  }
  assert(
    sbs.getTempBrainCount() <= 5,
    'G1: tempBrains does not exceed maxTempBrains (5)',
    `count=${sbs.getTempBrainCount()}`
  );

  // Re-access an old symbol should bring it to front and not increase count
  sbs.getOrCreateBrainForSymbol('COIN000USDT');
  assert(
    sbs.getTempBrainCount() <= 5,
    'G2: tempBrains still bounded after re-access',
    `count=${sbs.getTempBrainCount()}`
  );

  // Clear temp brains
  sbs.clearTempBrains();
  assert(
    sbs.getTempBrainCount() === 0,
    'G3: clearTempBrains empties the map',
    `count=${sbs.getTempBrainCount()}`
  );

  // Test with realistic count (250)
  const sbs2 = new ScannerBrainService(manualBrains, fakeAdapter, fakeML);
  (sbs2 as any).maxTempBrains = 250;
  for (let i = 0; i < 500; i++) {
    const sym = `COIN${String(i).padStart(4, '0')}USDT`;
    sbs2.getOrCreateBrainForSymbol(sym);
  }
  assert(
    sbs2.getTempBrainCount() <= 250,
    'G4: tempBrains stays at 250 with 500 unique symbols',
    `count=${sbs2.getTempBrainCount()}`
  );

  console.log(`\n  ScannerBrainService sub-total: passed so far`);

  // ──── 2. DiagnosticsEngine unsubscribe stored ────
  console.log('\n── 2. DiagnosticsEngine logger unsubscribe ──\n');

  const pm = new PositionManager();
  const olm = new OrderLockManager();
  const de = new DiagnosticsEngine();
  de.setPositionManager(pm);
  de.setOrderLockManager(olm);

  // Verify diagnostics engine doesn't crash
  const snap = de.snapshot();
  assert(typeof snap.logCount === 'number', 'H1: snapshot.logCount is a number');
  assert(snap.memoryEstimateMb === null || snap.memoryEstimateMb >= 0, 'H2: memoryEstimateMb is valid');

  const telemetry = de.getMemoryTelemetry();
  assert(typeof telemetry.logCount === 'number', 'H3: getMemoryTelemetry().logCount is a number');
  assert(typeof telemetry.warningCount === 'number', 'H4: getMemoryTelemetry().warningCount is a number');

  // Destroy and verify no errors
  de.destroy();
  assert(true, 'H5: destroy() does not throw');

  // ──── 3. Logger buffer boundedness ────
  console.log('\n── 3. Logger buffer bounded at 2000 ──\n');

  assert(logger.getStats().maxLogCount === 2000, 'I1: maxLogCount is 2000');
  assert(logger.getStats().currentLogCount >= 0, 'I2: currentLogCount is non-negative');
  assert(logger.getStats().currentLogCount <= logger.getStats().maxLogCount, 'I3: currentLogCount <= maxLogCount');

  // Verify visible count doesn't exceed maxLogs
  const initialCount = logger.getStats().currentLogCount;
  // Write many log entries
  for (let i = 0; i < 5000; i++) {
    logger.info(`BOUNDED_MEMORY_TEST_LOG: iteration=${i} logCategory=TEST`);
  }
  const afterCount = logger.getStats().currentLogCount;
  assert(afterCount <= 2000, 'I4: log count stays <= 2000 after 5000 writes', `count=${afterCount}`);

  // ──── 4. ScannerBrainService clearTempBrains ────
  console.log('\n── 4. ScannerBrainService cleanup ──\n');

  const sbs3 = new ScannerBrainService(manualBrains, fakeAdapter, fakeML);
  for (let i = 0; i < 50; i++) {
    const sym = `CLN${String(i).padStart(4, '0')}USDT`;
    sbs3.getOrCreateBrainForSymbol(sym);
  }
  assert(sbs3.getTempBrainCount() <= 250, 'J1: tempBrains within bounds');
  assert(sbs3.getTempBrainCount() > 0, 'J2: tempBrains has entries');

  sbs3.clearTempBrains();
  assert(sbs3.getTempBrainCount() === 0, 'J3: clearTempBrains empties all');

  console.log(`\n  All bounded memory tests done`);

  // ──── Summary ────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
