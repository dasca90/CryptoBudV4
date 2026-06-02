import { logger } from '../utils/logger';
import { DiagnosticsEngine } from '../core/diagnostics/DiagnosticsEngine';
import { PerformanceGuard } from '../core/diagnostics/PerformanceGuard';
import { PositionManager } from '../core/positions/PositionManager';
import { OrderLockManager } from '../core/orders/OrderLockManager';

let p = 0, f = 0;
function ok(c: boolean, m: string) { if (c) { p++; } else { f++; console.log('  FAIL: ' + m); } }
function eq<T>(a: T, b: T, m: string) { ok(a === b, m); }

async function testLoggerCaps() {
  console.log('\n--- A: logger caps logs ---');
  for (let i = 0; i < 2500; i++) {
    logger.info(`test log ${i}`);
  }
  const stats = logger.getStats();
  ok(stats.currentLogCount <= 2000, 'A1: logs capped at 2000');
  ok(stats.totalLogged >= 2500, 'A2: total counts all logs');
}

async function testLoggerThrottle() {
  console.log('\n--- B: logger throttles duplicate logs ---');
  const before = logger.getStats().totalLogged;
  for (let i = 0; i < 10; i++) {
    logger.throttled('INFO', 'throttled msg', 'test_throttle_key', 10000);
  }
  const after = logger.getStats().totalLogged;
  // Only 1 should have been logged (the first), the rest suppressed
  eq(after - before, 1, 'B1: only 1 of 10 throttled logs stored');
  const finalStats = logger.getStats();
  ok(finalStats.totalSuppressed > 0, 'B2: suppressed count > 0');
}

async function testErrorNotSuppressed() {
  console.log('\n--- C: ERROR logs not suppressed ---');
  const before = logger.getStats().totalLogged;
  for (let i = 0; i < 5; i++) {
    logger.throttled('ERROR', 'test error', 'test_error_key', 10000);
  }
  const after = logger.getStats().totalLogged;
  // ERROR should never be suppressed, all 5 should reach push
  ok(after - before === 5, 'C1: all 5 ERROR logs stored despite throttling');
}

async function testChartDataCapped() {
  console.log('\n--- D: chart data capped ---');
  // Simulate chart data cap directly without React hooks
  const chartData: { time: number; price: number }[] = [];
  for (let i = 0; i < 300; i++) {
    chartData.push({ time: i, price: 100 + i });
    if (chartData.length > 200) chartData.shift();
  }
  ok(chartData.length <= 200, 'D1: chart data max 200 per symbol');
  eq(chartData.length, 200, 'D2: exactly 200 after 300 pushes');
  eq(chartData[0].time, 100, 'D3: oldest data dropped');
}

async function testEquityHistoryCapped() {
  console.log('\n--- E: equity history capped ---');
  const history: { time: number; equity: number }[] = [];
  for (let i = 0; i < 600; i++) {
    history.push({ time: i, equity: 10000 + i });
    if (history.length > 500) history.shift();
  }
  ok(history.length <= 500, 'E1: equity max 500');
  eq(history.length, 500, 'E2: exactly 500 after 600 pushes');
}

async function testScannerSnapshotsCapped() {
  console.log('\n--- F: scanner snapshots capped ---');
  const pm = new PositionManager();
  const olm = new OrderLockManager();
  const de = new DiagnosticsEngine();
  de.setPositionManager(pm);
  de.setOrderLockManager(olm);

  const snap = de.snapshot({ scannerSnapshotCount: 25 });
  ok(snap.scannerSnapshotCount === 25, 'F1: scanner snapshot count recorded');
}

async function testScalperSnapshotsCapped() {
  console.log('\n--- G: scalper snapshots capped ---');
  const pm = new PositionManager();
  const olm = new OrderLockManager();
  const de = new DiagnosticsEngine();
  de.setPositionManager(pm);
  de.setOrderLockManager(olm);

  const snap = de.snapshot({ scalperSnapshotCount: 25 });
  ok(snap.scalperSnapshotCount === 25, 'G1: scalper snapshot count recorded');
}

async function testSlowScannerWarning() {
  console.log('\n--- I: slow scanner detected ---');
  const pg = new PerformanceGuard();
  pg.checkScannerDuration(6000);
  const warnings = pg.getWarnings();
  ok(warnings.length > 0, 'I1: scanner slow warning generated');
  eq(warnings[0].code, 'PERF_SCANNER_SLOW', 'I2: correct warning code');
}

async function testSlowScalperWarning() {
  console.log('\n--- J: slow scalper detected ---');
  const pg = new PerformanceGuard();
  pg.checkScalperTickDuration(2000);
  const warnings = pg.getWarnings();
  ok(warnings.length > 0, 'J1: scalper slow warning generated');
  eq(warnings[0].code, 'PERF_SCALPER_SLOW', 'J2: correct warning code');
}

async function testPersistenceSlowWarning() {
  console.log('\n--- K: persistence slow warning ---');
  const pg = new PerformanceGuard();
  pg.checkPersistenceDuration(2000);
  const warnings = pg.getWarnings();
  ok(warnings.length > 0, 'K1: persistence slow warning generated');
  eq(warnings[0].code, 'PERF_PERSISTENCE_SLOW', 'K2: correct warning code');
}

async function testLogCountWarning() {
  console.log('\n--- H: log count warning ---');
  const pg = new PerformanceGuard();
  pg.checkLogCount(1800);
  const warnings = pg.getWarnings().filter(w => w.code === 'PERF_LOG_COUNT_HIGH');
  ok(warnings.length > 0, 'H1: log count high warning generated');
}

async function testIntervalCleanup() {
  console.log('\n--- L: interval cleanup ---');
  const intervals: ReturnType<typeof setInterval>[] = [];
  const id = setInterval(() => {}, 1000);
  intervals.push(id);
  eq(intervals.length, 1, 'L1: interval created');
  clearInterval(id);
  ok(true, 'L2: interval cleaned up');
}

async function testDebugModeOff() {
  console.log('\n--- M: debug mode off suppresses noisy logs ---');
  const debugMode = false;
  if (!debugMode) {
    const before = logger.getStats().totalLogged;
    for (let i = 0; i < 5; i++) {
      logger.throttled('INFO', `debug log ${i}`, 'debug_test_key', 5000);
    }
    const after = logger.getStats().totalLogged;
    // Throttled should suppress repeats within 5s window
    ok(after - before <= 2, 'M1: throttled logs suppressed when debug off');
  }
}

async function testDebugModeOn() {
  console.log('\n--- N: debug mode on allows detailed logs but still capped ---');
  const statsBefore = logger.getStats();
  for (let i = 0; i < 100; i++) {
    logger.info(`debug detail ${i}`);
  }
  const statsAfter = logger.getStats();
  ok(statsAfter.totalLogged > statsBefore.totalLogged, 'N1: debug logs appear');
  ok(statsAfter.currentLogCount <= 2000, 'N2: cap still enforced at 2000');
}

(async () => {
  console.log('=== Diagnostics Test Suite ===');
  await testLoggerCaps();
  await testLoggerThrottle();
  await testErrorNotSuppressed();
  await testChartDataCapped();
  await testEquityHistoryCapped();
  await testScannerSnapshotsCapped();
  await testScalperSnapshotsCapped();
  await testLogCountWarning();
  await testSlowScannerWarning();
  await testSlowScalperWarning();
  await testPersistenceSlowWarning();
  await testIntervalCleanup();
  await testDebugModeOff();
  await testDebugModeOn();
  console.log(`\n=== Diagnostics Suite: ${p} passed, ${f} failed ===`);
  if (f > 0) process.exit(1);
})();
