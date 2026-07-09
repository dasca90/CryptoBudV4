import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyOvernightMemory,
  formatOvernightStabilityAudit,
  updateOvernightStabilitySnapshot,
} from '../core/diagnostics/overnightStability';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const app = read('src', 'App.tsx');
const logsPage = read('src', 'ui', 'pages', 'LogsPage.tsx');
const loggerSource = read('src', 'utils', 'logger.ts');
const diagnosticsSource = read('src', 'core', 'diagnostics', 'overnightStability.ts');
const pkg = read('package.json');

assert.ok(app.includes('formatOvernightStabilityAudit'), 'App emits overnight stability audit');
assert.ok(app.includes('30 * 60 * 1000'), 'overnight audit cadence is 30 minutes');
assert.ok(app.includes("activeTab === 'air-scanner'"), 'airScannerMounted is derived from the active tab');
assert.ok(app.includes('lastStartupRecoveryAtRef.current'), 'audit reports last startup recovery timestamp');
assert.ok(app.includes('getAirScannerCleanupStats'), 'audit can report last 3D cleanup timestamp');

for (const field of [
  'uptimeHours',
  'activeTab',
  'scannerRunning',
  'autoBotsEnabled',
  'openPositionsCount',
  'closedPositionsCount',
  'jsHeapUsed',
  'visibleLogCount',
  'internalAuditCount',
  'airScannerMounted',
  'activeIntervalsCount',
  'activeSubscriptionsCount',
  'memoryPressureActive',
  'pressureReason',
  'memoryGrowthReason',
  'memoryGrowthWarmupActive',
  'isStartupGracePeriodActive',
  'lastMemoryBufferTrimAt',
  'lastStartupRecoveryAt',
  'lastRuntimeCleanupAt',
]) {
  assert.ok(diagnosticsSource.includes(field), `OVERNIGHT_STABILITY_AUDIT includes ${field}`);
}

assert.ok(loggerSource.includes('lastMemoryBufferTrimAt'), 'logger stats expose last buffer trim timestamp');
assert.ok(logsPage.includes('Overnight Status'), 'Logs page renders Overnight Status badge');
assert.ok(logsPage.includes('Runtime:') && logsPage.includes('Memory:') && logsPage.includes('3D Active:') && logsPage.includes('Scanner:') && logsPage.includes('Last cleanup:'), 'badge renders required labels');
assert.ok(logsPage.includes('pressureReason'), 'badge can show exact pressure reason');
assert.ok(logsPage.includes('data-testid="overnight-status-badge"'), 'badge has stable regression test id');
assert.ok(pkg.includes('test:overnight-stability'), 'package exposes overnight stability test');

assert.equal(classifyOvernightMemory({ jsHeapUsed: null, memoryPressureActive: false }), 'Stable');
assert.equal(classifyOvernightMemory({ jsHeapUsed: 100, memoryPressureActive: true }), 'Pressure');
assert.equal(classifyOvernightMemory({ jsHeapUsed: 100, memoryPressureActive: true, memoryPressureLevel: 'warning', isStartupGracePeriodActive: true }), 'Measuring');
assert.equal(classifyOvernightMemory({ jsHeapUsed: 100, memoryPressureActive: true, memoryPressureLevel: 'critical', isStartupGracePeriodActive: true }), 'Pressure');
updateOvernightStabilitySnapshot({
  uptimeHours: 0,
  activeTab: 'trade',
  scannerRunning: false,
  autoBotsEnabled: false,
  openPositionsCount: 0,
  closedPositionsCount: 0,
  jsHeapUsed: 100 * 1024 * 1024,
  visibleLogCount: 0,
  internalAuditCount: 0,
  airScannerMounted: false,
  activeIntervalsCount: 0,
  activeSubscriptionsCount: 0,
  memoryPressureActive: false,
  memoryPressureLevel: 'normal',
  pressureReason: 'none',
  memoryGrowthReason: 'none_detected',
  memoryGrowthWarmupActive: true,
  isStartupGracePeriodActive: false,
  lastMemoryBufferTrimAt: null,
  lastStartupRecoveryAt: null,
  lastRuntimeCleanupAt: null,
  lastAirScannerCleanupAt: null,
});
assert.equal(classifyOvernightMemory({ jsHeapUsed: 180 * 1024 * 1024, memoryPressureActive: false, memoryGrowthWarmupActive: true }), 'Warm-up');

const snapshot = updateOvernightStabilitySnapshot({
  uptimeHours: 12,
  activeTab: 'trade',
  scannerRunning: true,
  autoBotsEnabled: true,
  openPositionsCount: 1,
  closedPositionsCount: 2,
  jsHeapUsed: 123456,
  visibleLogCount: 100,
  internalAuditCount: 200,
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
  lastStartupRecoveryAt: 111,
  lastRuntimeCleanupAt: 222,
  lastAirScannerCleanupAt: null,
});
const audit = formatOvernightStabilityAudit(snapshot);
assert.ok(audit.startsWith('OVERNIGHT_STABILITY_AUDIT:'), 'formats overnight audit event');
assert.ok(audit.includes('activeTab=trade') && audit.includes('airScannerMounted=false') && audit.includes('scannerRunning=true'), 'audit formats key acceptance fields');
assert.ok(audit.includes('pressureReason=none') && audit.includes('isStartupGracePeriodActive=false'), 'overnight audit includes pressure reason and startup grace state');
assert.ok(audit.includes('memoryGrowthReason=none_detected') && audit.includes('memoryGrowthWarmupActive=false'), 'overnight audit includes memory growth reason and warm-up state');
assert.ok(audit.includes('lastRuntimeCleanupAt=222'), 'overnight audit includes runtime cleanup timestamp');

console.log('overnight-stability-verification tests passed');
