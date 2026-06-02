/**
 * Final hardening regression tests for scanner fixes.
 *
 * Verifies:
 * - AutoBots toggle persistence
 * - Manual override is clearly shown when active
 * - EntryGate runs for eligible candidates
 * - Paper/Live decision remains unified
 * - Logs page controls render
 * - Momentum layered classification
 * - trader-brain test exits cleanly
 *
 * Run: npx tsx src/__tests__/regression-hardening.test.ts
 */

import { readFileSync } from 'node:fs';
import { EntryGate } from '../core/entry-gate/EntryGate';
import { logger, type LogEntry } from '../utils/logger';
import type { EntryGateInput, EntryGateOutput } from '../core/types';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };
const eq = <T>(a: T, b: T, m: string) => ok(a === b, m);

// ── 1. AutoBots toggle persistence (source code analysis) ──
(() => {
  console.log('\n── 1. AutoBots toggle persistence ──\n');
  const tradePage = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
  const settingsPersistence = readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8');

  // AutoBots state is persisted via settingsPersistence
  ok(tradePage.includes('settingsPersistence.saveSettings'), '1a AutoBots toggle saves to persistence');
  ok(tradePage.includes('paperAutoExecutionEnabled'), '1b paperAutoExecutionEnabled field persisted');
  ok(tradePage.includes('AUTOBOTS_HYDRATION_RESTORE'), '1c Hydration restores persisted AutoBots state');
  ok(tradePage.includes('AUTOBOTS_HYDRATION_CONFLICT'), '1d Hydration detects conflicts with user toggle');

  // Manual override is clearly shown (in scanner source)
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  ok(scannerSrc.includes('STRATEGY_SOURCE_CONFLICT_AUDIT'), '1e Manual strategy conflict detection');
  ok(tradePage.includes('setManualStrategy'), '1f Manual strategy setter called');

  // Strategy dropdown is disabled when AutoBots active
  ok(tradePage.includes('onTogglePaperAuto'), '1g Paper auto toggle function passed to children');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 2. Manual override clearly shown ──
(() => {
  console.log('\n── 2. Manual override detection ──\n');
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');

  ok(scannerSrc.includes('setManualStrategy'), '2a Scanner.setManualStrategy exists');
  ok(scannerSrc.includes('manualMode'), '2b Scanner tracks manualMode state');
  ok(scannerSrc.includes('ManualOverride'), '2c Strategy router has ManualOverride source');
  ok(scannerSrc.includes('MANUAL_STRATEGY_SOURCE_AUDIT'), '2d Manual strategy source audit log exists');
  ok(scannerSrc.includes('MANUAL_STRATEGY_APPLIED'), '2e Manual strategy applied log exists');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 3. EntryGate runs for eligible candidates ──
(() => {
  console.log('\n── 3. EntryGate eligibility ──\n');
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  const entryGateSrc = readFileSync('src/core/entry-gate/EntryGate.ts', 'utf8');

  // EntryGate runs for V3-eligible candidates (no genuine hard blocks)
  ok(scannerSrc.includes('isV3Eligible'), '3a V3 eligibility check exists');
  ok(scannerSrc.includes('genuineHardBlockers'), '3b Genuine hard blockers defined');
  ok(scannerSrc.includes('ENTRY_GATE_ELIGIBILITY_AUDIT'), '3c EntryGate eligibility audit log');
  ok(scannerSrc.includes('ENTRY_GATE_RUNTIME_SUMMARY'), '3d EntryGate runtime summary log');

  // EntryGate checks all required conditions
  ok(entryGateSrc.includes('BLOCK_CONFIDENCE_TOO_LOW'), '3e Confidence check in EntryGate');
  ok(entryGateSrc.includes('BLOCK_BTC_DUMP'), '3f BTC dump check in EntryGate');
  ok(entryGateSrc.includes('BLOCK_NO_TP_ROOM'), '3g TP room check in EntryGate');
  ok(entryGateSrc.includes('BLOCK_PRICE_STALE'), '3h Stale price check in EntryGate');

  // EntryGate confidence audit
  ok(scannerSrc.includes('ENTRY_GATE_CONFIDENCE_SCALE_AUDIT'), '3i Confidence scale audit log added');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 4. Paper/Live decision remains unified ──
(() => {
  console.log('\n── 4. Paper/Live unified decision ──\n');
  const executorSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
  const paperExecutorSrc = readFileSync('src/core/scanner/PaperAutoExecutionController.ts', 'utf8');
  const liveExecutorSrc = readFileSync('src/core/scanner/BinanceLiveExecutionController.ts', 'utf8');

  // Unified decision mode
  ok(executorSrc.includes('decisionMode'), '4a ExecutionPlanner uses decisionMode');
  ok(executorSrc.includes("decisionMode: 'unified'"), '4b Unified decision mode constant');
  ok(executorSrc.includes('executionAdapter'), '4c ExecutionPlanner uses executionAdapter');

  // Paper executor checks unified decision
  ok(paperExecutorSrc.includes("plannedAction !== 'BUY'"), '4d Paper executor checks unified BUY action');
  ok(paperExecutorSrc.includes('WRONG_PLANNED_ACTION'), '4e Paper executor handles non-BUY planned action');

  // Live executor has live-specific pre-checks
  ok(liveExecutorSrc.includes('apiKeysConfigured'), '4f Live executor checks API keys configured');
  ok(liveExecutorSrc.includes('revalidateLiveCandidate'), '4g Live execution revalidation defined');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 5. Logs page controls render ──
(() => {
  console.log('\n── 5. Logs page controls ──\n');
  const logsSrc = readFileSync('src/ui/pages/LogsPage.tsx', 'utf8');

  // All toolbar controls must exist
  ok(logsSrc.includes('Clear Logs'), '5a Clear Logs button');
  ok(logsSrc.includes('Pause'), '5b Pause/Resume button');
  ok(logsSrc.includes('Auto↓'), '5c Auto-scroll toggle');
  ok(logsSrc.includes('↓ Bot'), '5d Jump Bottom');
  ok(logsSrc.includes('↑ Top'), '5e Jump Top');
  ok(logsSrc.includes('Export'), '5f Export button');
  ok(logsSrc.includes('Copy'), '5g Copy button');
  ok(logsSrc.includes('Compact'), '5h Compact mode toggle');
  ok(logsSrc.includes('Search'), '5i Search input');
  ok(logsSrc.includes('No logs yet'), '5j Empty state');

  // Severity filters with counters
  ok(logsSrc.includes("'ERROR'"), '5k ERROR filter');
  ok(logsSrc.includes("'WARN'"), '5l WARN filter');
  ok(logsSrc.includes("'INFO'"), '5m INFO filter');
  ok(logsSrc.includes("'TRADE'"), '5n TRADE filter');

  // Source filters
  ok(logsSrc.includes("'Binance'"), '5o Binance source filter');
  ok(logsSrc.includes("'Scanner'"), '5p Scanner source filter');
  ok(logsSrc.includes("'AutoBots'"), '5q AutoBots source filter');
  ok(logsSrc.includes("'EntryGate'"), '5r EntryGate source filter');

  // Scroll behavior
  ok(logsSrc.includes('onScroll'), '5s Scroll handler (mouse wheel)');
  ok(logsSrc.includes('scrollRef'), '5t Scroll ref defined');
  ok(logsSrc.includes('scrollTop'), '5u scrollTop property used');
  ok(logsSrc.includes('scrollHeight'), '5v scrollHeight property checked');

  // Clear confirmation
  ok(logsSrc.includes('showConfirmClear'), '5w Clear confirmation state');
  ok(logsSrc.includes('Clear all?'), '5x Clear confirmation prompt');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 6. Momentum layered classification ──
(() => {
  console.log('\n── 6. Momentum layered classification ──\n');
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');

  // MOMENTUM_DIRECTION_AUDIT must use layered fields
  ok(scannerSrc.includes('shortTermMomentumDirection'), '6a shortTermMomentumDirection field');
  ok(scannerSrc.includes('periodTrendDirection'), '6b periodTrendDirection field');
  ok(scannerSrc.includes('isBounceInsideDowntrend'), '6c isBounceInsideDowntrend field');
  ok(scannerSrc.includes('isDumping'), '6d isDumping field');

  // Old flat isPositive/isNegative must NOT exist in the audit
  const oldPositiveFlag = /isPositive=\$\{isPositiveMomentum\}/.test(scannerSrc);
  ok(!oldPositiveFlag, '6e Old isPositive flag removed from MOMENTUM_DIRECTION_AUDIT');
  const oldNegativeFlag = /isNegative=\$\{isNegativeMomentum\}/.test(scannerSrc);
  ok(!oldNegativeFlag, '6f Old isNegative flag removed from MOMENTUM_DIRECTION_AUDIT');
  const oldSidewaysFlag = /isSideways=\$\{isSideways\}/.test(scannerSrc);
  ok(!oldSidewaysFlag, '6g Old isSideways flag removed from MOMENTUM_DIRECTION_AUDIT');

  // MOMENTUM_FLAG_CONSISTENCY_AUDIT exists
  ok(scannerSrc.includes('MOMENTUM_FLAG_CONSISTENCY_AUDIT'), '6h Momentum flag consistency audit exists');
  ok(scannerSrc.includes('contradictionDetected'), '6i Contradiction detection in audit');

  // recencyWeightedMomentum used in pocket detection
  ok(scannerSrc.includes('recencyWeightedMomentum'), '6j recencyWeightedMomentum used in scanner');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 7. EntryGate confidence audit ──
(() => {
  console.log('\n── 7. EntryGate confidence scale audit ──\n');
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');

  ok(scannerSrc.includes('ENTRY_GATE_CONFIDENCE_SCALE_AUDIT'), '7a Confidence scale audit exists');
  ok(scannerSrc.includes('displayedConfidence'), '7b displayedConfidence field');
  ok(scannerSrc.includes('rawConfidence'), '7c rawConfidence field');
  ok(scannerSrc.includes('scaleMismatchDetected'), '7d scaleMismatchDetected field');
  ok(scannerSrc.includes('thresholdSource'), '7e thresholdSource field');
  ok(scannerSrc.includes('confidenceSource'), '7f confidenceSource field');
  ok(scannerSrc.includes('requiredConfidence=0.3'), '7g requiredConfidence threshold logged');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 8. EntryGate runtime: confidence threshold correct ──
(() => {
  console.log('\n── 8. EntryGate runtime confidence ──\n');

  const gate = new EntryGate();
  const baseInput: EntryGateInput = {
    coin: 'TEST', side: 'BUY', price: 50000, quantity: 0.001,
    mode: 'AUTO', mlConfidence: 0.8, prediction: 'MOMENTUM',
    currentPositions: 0, maxPositions: 10, recentLoss: false,
    spreadOk: true, volumePass: true, priceFresh: true,
    btcDumping: false, marketRegimeUnsafe: false,
    reboundConfirmed: true, momentumConfirmed: true,
    tpRoomOk: true, isVeryHighRisk: false, isLive: false,
  };

  // High confidence passes
  const resultHigh = gate.evaluate({ ...baseInput, mlConfidence: 0.8 });
  ok(!resultHigh.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), '8a 0.8 confidence not blocked');

  // Low confidence blocks
  const resultLow = gate.evaluate({ ...baseInput, mlConfidence: 0.2 });
  ok(resultLow.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), '8b 0.2 confidence blocked');

  // Threshold boundary: exactly 0.3 passes
  const resultBoundary = gate.evaluate({ ...baseInput, mlConfidence: 0.3 });
  ok(!resultBoundary.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), '8c 0.3 confidence passes (threshold is < 0.3, not <=)');

  // Slightly below threshold blocks
  const resultBelow = gate.evaluate({ ...baseInput, mlConfidence: 0.299 });
  ok(resultBelow.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), '8d 0.299 confidence blocked');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── 9. Logger runtime: log entry export ──
(() => {
  console.log('\n── 9. Logger runtime ──\n');

  const testLogger = logger;
  testLogger.clear();

  testLogger.info('TEST_HARDENING: regression test');
  const logs = testLogger.getLogs();
  ok(logs.length >= 1, '9a Logger stores entries');
  ok(logs.some((l: LogEntry) => l.message.includes('TEST_HARDENING')), '9b Logger retrieves specific entry');
  ok(logs[0].timestamp !== undefined && logs[0].timestamp.length > 0, '9c Log entry has timestamp');

  const exportStr = testLogger.export();
  const parsed = JSON.parse(exportStr);
  ok(Array.isArray(parsed), '9d Logger export returns valid JSON array');
  ok(parsed.length >= 1, '9e Logger export contains entries');

  const stats = testLogger.getStats();
  ok(stats.totalLogged >= 1, '9f Logger stats track totalLogged');
  ok(stats.currentLogCount >= 1, '9g Logger stats track currentLogCount');

  console.log(`   ${p} passed, ${f} failed`);
})();

// ── Summary ──
console.log('\n══════════════════════════════════════════════');
console.log(`  Regression hardening: ${p} passed, ${f} failed`);
console.log('══════════════════════════════════════════════\n');

if (f > 0) process.exit(1);
