import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatMemoryBufferStatusAudit, formatMemoryGrowthReasonAudit, formatMemoryPressureReasonAudit, updateMemoryPressure } from '../core/diagnostics/memoryLifecycle';
import { resolveExecutionDecision, type ExecutionDecisionParams } from '../core/scanner/executionDecision';
import { resolveTopCandidateDisplay } from '../components/trade-v4/TopCandidatesPanel';
import type { TradeV4CandidateView } from '../components/trade-v4/types';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

function baseParams(overrides: Partial<ExecutionDecisionParams> = {}): ExecutionDecisionParams {
  return {
    symbol: 'SOLUSDT',
    scanId: 'scan_stale_reason',
    candidateRank: 1,
    status: 'BUY',
    finalExecutable: true,
    buyAllowed: true,
    setupResult: 'READY',
    finalExecutionStrategy: 'balanced',
    riskGroup: 'mid_caps',
    groupName: 'mid_caps',
    groupRecommendedStrategy: 'balanced',
    groupOpenCount: 1,
    groupMaxOpen: 4,
    groupExposure: 100,
    groupMaxExposure: 1000,
    priceFresh: true,
    bookFresh: true,
    spreadOk: true,
    tpRoomOk: true,
    capitalOk: true,
    maxOpenPositionsOk: true,
    maxGroupPositionsOk: true,
    maxGroupExposureOk: true,
    duplicateOpenPosition: false,
    pendingOrderExists: false,
    banned: false,
    buySpacingOk: true,
    runtimeExecutionEnabled: true,
    ...overrides,
  };
}

function baseCandidate(overrides: Partial<TradeV4CandidateView> = {}): TradeV4CandidateView {
  return {
    candidateId: 'cand_SOLUSDT',
    symbol: 'SOLUSDT',
    price: 142,
    rank: 1,
    score: 92,
    confidenceSource: 'test',
    source: 'dipper',
    riskGroup: 'mid_caps',
    strategy: 'balanced',
    status: 'BUY',
    engineState: 'detected',
    confidence: 0.92,
    spreadPct: 0.04,
    volumeRel: 1.7,
    dipPct: -1.5,
    reboundPct: 0.8,
    tpRoomPct: 3.2,
    momentum: 1.1,
    mainReason: 'BUY_READY',
    requiredNextAction: null,
    blockReasons: [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
    finalExecutable: true,
    buyAllowed: true,
    primaryBlocker: null,
    finalNoBuyReason: 'BLOCK_MAX_POSITIONS',
    ...overrides,
  };
}

const pressureAudit = formatMemoryPressureReasonAudit({
  jsHeapUsed: 720,
  jsHeapLimit: 1000,
  heapUsedPct: 72,
  pressureThresholdPct: 72,
  visibleLogCount: 2000,
  internalAuditCount: 5000,
  candidateStoreCount: 52,
  closedTradesCount: 8,
  openPositionsCount: 1,
  activeIntervalsCount: 2,
  activeSubscriptionsCount: 1,
  airScannerMounted: false,
  activeTab: 'trade',
  pressureReason: 'buffer_at_capacity',
  isStartupGracePeriodActive: true,
});

const bufferOnlyPressure = updateMemoryPressure({
  heapRatio: 0.2,
  visibleLogCount: 2000,
  visibleLogMax: 2000,
  internalAuditCount: 5000,
  internalAuditMax: 5000,
});
assert.equal(bufferOnlyPressure.active, false, 'full ring buffers do not create memory pressure when heap is normal');
assert.equal(bufferOnlyPressure.reason, 'none', 'buffer_at_capacity is no longer a pressure reason');

const bufferAudit = formatMemoryBufferStatusAudit({
  visibleLogCount: 2000,
  visibleLogMax: 2000,
  internalAuditCount: 5000,
  internalAuditMax: 5000,
  trimCount: 42,
  lastTrimAt: 123,
  bufferAtCapacity: true,
  heapPressure: false,
  pressureReason: 'none',
});
const growthAudit = formatMemoryGrowthReasonAudit({
  jsHeapUsed: 1500,
  previousHeapUsed: 1000,
  heapDelta: 500,
  growthWindowMinutes: 30,
  activeTab: 'trade',
  airScannerMounted: false,
  visibleLogCount: 2000,
  internalAuditCount: 5000,
  candidateStoreCount: 52,
  scannerSnapshotCount: 10,
  openPositionStoreCount: 15,
  positionManagerOpenCount: 11,
  closedTradesCount: 4,
  activeIntervalsCount: 2,
  activeSubscriptionsCount: 1,
  probableGrowthSource: 'open_position_store_mismatch',
});
for (const field of [
  'MEMORY_BUFFER_STATUS_AUDIT:',
  'visibleLogCount=2000',
  'visibleLogMax=2000',
  'internalAuditCount=5000',
  'internalAuditMax=5000',
  'trimCount=42',
  'lastTrimAt=123',
  'bufferAtCapacity=true',
  'heapPressure=false',
  'pressureReason=none',
]) {
  assert.ok(bufferAudit.includes(field), `memory buffer status audit includes ${field}`);
}

for (const field of [
  'MEMORY_PRESSURE_REASON_AUDIT:',
  'jsHeapUsed=720',
  'jsHeapLimit=1000',
  'heapUsedPct=72.00',
  'pressureThresholdPct=72',
  'visibleLogCount=2000',
  'internalAuditCount=5000',
  'candidateStoreCount=52',
  'closedTradesCount=8',
  'openPositionsCount=1',
  'activeIntervalsCount=2',
  'activeSubscriptionsCount=1',
  'airScannerMounted=false',
  'activeTab=trade',
  'pressureReason=buffer_at_capacity',
  'isStartupGracePeriodActive=true',
]) {
  assert.ok(pressureAudit.includes(field), `memory pressure reason audit includes ${field}`);
}

const executableDecision = resolveExecutionDecision(baseParams({
  previousFinalNoBuyReason: 'BLOCK_MAX_POSITIONS',
  candidateWhy: 'BUY_READY',
}));
assert.equal(executableDecision.finalNoBuyReason, 'none', 'stale BLOCK_MAX_POSITIONS is cleared for executable BUY_READY candidate');
assert.equal(executableDecision.finalDecision, 'EXECUTE', 'executable BUY_READY candidate remains executable');

const buyReadyDisplay = resolveTopCandidateDisplay({
  candidate: baseCandidate({
    executionDecision: executableDecision as any,
  }),
  executionSelected: true,
  executionSkipped: false,
});
assert.equal(buyReadyDisplay.status, 'BUY', 'BUY_READY row stays BUY');
assert.notEqual(buyReadyDisplay.exactSkipReason, 'BLOCK_MAX_POSITIONS', 'BUY_READY row does not display stale BLOCK_MAX_POSITIONS');
assert.notEqual(buyReadyDisplay.whyLabel, 'MAX_POSITIONS_REACHED', 'BUY_READY row does not render stale max-position blocker');

const memoryLifecycle = read('src', 'core', 'diagnostics', 'memoryLifecycle.ts');
const app = read('src', 'App.tsx');
const topCandidates = read('src', 'components', 'trade-v4', 'TopCandidatesPanel.tsx');
const tradeAdapter = read('src', 'lib', 'air-scanner', 'tradeV4DataAdapter.ts');
const scanner = read('src', 'core', 'scanner', 'MarketScanner.ts');
const docs = read('docs', 'OVERNIGHT_OOM_ROOT_CAUSE.md');
const pkg = read('package.json');

assert.ok(memoryLifecycle.includes('formatMemoryPressureReasonAudit'), 'memory lifecycle exposes reason audit formatter');
assert.ok(memoryLifecycle.includes('formatMemoryBufferStatusAudit'), 'memory lifecycle exposes buffer status audit formatter');
assert.ok(memoryLifecycle.includes('formatMemoryGrowthReasonAudit'), 'memory lifecycle exposes growth reason audit formatter');
assert.ok(app.includes('formatMemoryPressureReasonAudit'), 'App emits memory pressure reason audit');
assert.ok(app.includes('formatMemoryBufferStatusAudit'), 'App emits memory buffer status audit');
assert.ok(app.includes('formatMemoryGrowthReasonAudit'), 'App emits memory growth reason audit');
assert.ok(app.includes('open_position_store_mismatch'), 'memory growth audit can identify open-position store mismatch as probable source');
assert.ok(app.includes('OVERNIGHT_STARTUP_GRACE_MS'), 'App uses startup grace for overnight pressure display');
assert.ok(topCandidates.includes("previousFinalNoBuyReason = isExecutableBuyReady(c) ? 'none'"), 'TopCandidates clears stale previous reason for BUY_READY rows');
assert.ok(tradeAdapter.includes('strategyAudit.finalExecutable === true && strategyAudit.buyAllowed === true'), 'TradeV4 adapter clears stale finalNoBuyReason for executable candidates');
assert.ok(scanner.includes('EXECUTION_SUBMIT_RESULT_AUDIT'), 'scanner emits execution submit result audit');
assert.ok(scanner.includes('EXECUTION_NO_SUBMIT_REASON_AUDIT'), 'scanner emits no-submit reason audit');

for (const field of [
  'scanId',
  'selectedCount',
  'submitAttemptedCount',
  'submittedSymbol',
  'notSubmittedSymbols',
  'reasonOnlyOneSubmitted',
  'buyPacingActive',
  'maxPositions',
  'openPositionsCount',
  'groupCaps',
  'executionResult',
  'orderId',
  'demoTradeId',
  'failureReason',
]) {
  assert.ok(scanner.includes(`${field}=`), `EXECUTION_SUBMIT_RESULT_AUDIT includes ${field}`);
}

for (const field of [
  'buyReadySymbols',
  'executionSelectedCount',
  'submitAttemptedCount',
  'openPositionsCount',
  'maxPositions',
  'buyPacingActive',
  'cooldownActive',
  'groupCapBlocked',
  'capitalBlocked',
  'duplicateBlocked',
  'finalNoSubmitReason',
]) {
  assert.ok(scanner.includes(`${field}=`), `EXECUTION_NO_SUBMIT_REASON_AUDIT includes ${field}`);
}

const loggerSource = read('src', 'utils', 'logger.ts');
const tradingEngine = read('src', 'core', 'trading', 'TradingEngine.ts');
const strategyAuditBuilder = read('src', 'core', 'strategy-audit', 'strategy-audit-builder.ts');
assert.ok(loggerSource.includes('trimCount'), 'logger stats expose trimCount');
assert.ok(topCandidates.includes('candidateAuditSigRef') && topCandidates.includes('debug_ui_audits'), 'TopCandidates audits are sampled by signature unless debug is enabled');
assert.ok(tradingEngine.includes('open_position_mark_price_update:') && tradingEngine.includes('open_position_unrealized_pnl_update:'), 'mark price and PnL audits are rate-limited');
assert.ok(strategyAuditBuilder.includes('debugUiAuditsEnabled()'), 'normal priority audits are debug-gated');
assert.ok(growthAudit.includes('MEMORY_GROWTH_REASON_AUDIT:') && growthAudit.includes('openPositionStoreCount=15') && growthAudit.includes('positionManagerOpenCount=11') && growthAudit.includes('probableGrowthSource=open_position_store_mismatch'), 'memory growth audit exposes stale open-position store mismatch');

assert.ok(docs.includes('Diagnostic root cause update'), 'root cause doc includes diagnostic update');
assert.ok(docs.includes('stale `BLOCK_MAX_POSITIONS`'), 'root cause doc describes stale max-position reason');
assert.ok(pkg.includes('test:memory-pressure-diagnostics'), 'package exposes memory pressure diagnostics test');

console.log('memory-pressure-diagnostics-and-stale-reason tests passed');
