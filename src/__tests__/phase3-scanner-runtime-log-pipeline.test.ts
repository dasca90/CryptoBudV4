import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { createDefaultAppSettings } from '../core/types';

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
const tradeV4PageSrc = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const tradingParamsSrc = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
const adapterSrc = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');
const strategyAuditLoggerSrc = readFileSync('src/core/strategy-audit/strategy-audit-logger.ts', 'utf8');
const loggerSrc = readFileSync('src/utils/logger.ts', 'utf8');

const defaults = createDefaultAppSettings();
assert.equal(defaults.scannerDiagnosticsLevel, 'normal', 'default diagnostics level is normal');
assert.ok(tradingParamsSrc.includes('Scanner Diagnostics Level'), 'UI exposes Scanner Diagnostics Level');
assert.ok(tradePageSrc.includes('scannerDiagnosticsLevel'), 'diagnostics level is persisted through TradePage');
assert.ok(scannerSrc.includes('setScannerDiagnosticsLevel'), 'MarketScanner accepts diagnostics level');

assert.ok(scannerSrc.includes('SCANNER_PERFORMANCE_BREAKDOWN_AUDIT'), 'per-scan performance breakdown audit exists');
assert.ok(scannerSrc.includes('slowestSymbols'), 'performance audit includes slowest symbols');
assert.ok(scannerSrc.includes('bottleneckReason'), 'performance audit includes bottleneck reason');
assert.ok(scannerSrc.includes('SCANNER_CACHE_HIT_RATE_AUDIT'), 'cache hit-rate audit exists');
assert.ok(scannerSrc.includes('staleRejectedCount'), 'cache audit tracks stale rejections');
assert.ok(scannerSrc.includes('`${symbol}_${this.scannerReferencePeriod}_${kc.interval}_${kc.limit}`'), 'cache key includes refPeriod interval and limit');
assert.ok(scannerSrc.includes('candleHash'), 'cache stores candle identity');

assert.ok(scannerSrc.includes('STRATEGY_SETUP_SUMMARY_AUDIT'), 'strategy setup summary audit exists');
assert.ok(scannerSrc.includes('REBOUND_FRESHNESS_SUMMARY_AUDIT'), 'rebound freshness summary audit exists');
assert.ok(scannerSrc.includes('REF_PERIOD_PARITY_SUMMARY_AUDIT'), 'ref-period parity summary audit exists');

assert.ok(scannerSrc.includes('if (this.shouldEmitPerSymbolAudit()) logger.info(`V3_REFERENCE_CONTRACT_AUDIT'), 'large normal scans suppress V3 reference per-symbol audit');
assert.ok(scannerSrc.includes('if (this.shouldEmitPerSymbolAudit()) logger.info(`ENTRY_CONFIRMATION_TRACE'), 'large normal scans suppress entry confirmation per-symbol audit');
assert.ok(scannerSrc.includes('currentScanSymbolCount <= 10'), 'small fixture scans keep detailed audit compatibility');
assert.ok(scannerSrc.includes('if (this.shouldEmitVerboseAudit()) for (const c of allRanked.slice(0, 20))'), 'verbose/debug keep detailed top-candidate audit path');
assert.ok(scannerSrc.includes("return this.scannerDiagnosticsLevel === 'debug'"), 'debug mode remains available');
assert.ok(adapterSrc.includes("index < 10 || c.status === 'BUY'"), 'adapter keeps full strategy audit for top/selected candidates');
assert.ok(adapterSrc.includes("'summary'"), 'adapter can suppress detailed per-symbol strategy audit for normal candidates');
assert.ok(strategyAuditLoggerSrc.includes('detailLevel') && strategyAuditLoggerSrc.includes('STRATEGY_METRIC_ROLE_AUDIT'), 'strategy metric role audit is detail-level controlled');

for (const token of [
  'scannerCandidates',
  'strategyEligibleCandidates',
  'entryGateEvaluatedCandidates',
  'entryGatePassedCandidates',
  'entryGateBlockedCandidates',
  'executionPoolCandidates',
  'selectedForExecutionCandidates',
  'adapterSubmittedCandidates',
  'positionsCreated',
]) {
  assert.ok(scannerSrc.includes(token), `canonical counter ${token} is emitted`);
}

assert.ok(tradeV4PageSrc.includes('UI_RUNTIME_PERFORMANCE_AUDIT'), 'UI runtime performance audit exists');
assert.ok(tradeV4PageSrc.includes('logsRendered') && tradeV4PageSrc.includes('logsTotal'), 'UI audit reports rendered and total logs');
assert.ok(loggerSrc.includes('export(') && loggerSrc.includes('this.logs.map'), 'log export still uses full logger buffer');

for (const forbidden of [
  'requiredConfidence =',
  'maxSpreadPct = 0.',
  'selectedStrategy =',
  'tp1Pct =',
  'takeProfit',
]) {
  assert.equal(scannerSrc.includes(`PHASE3_TRADING_LOGIC_CHANGE_${forbidden}`), false, `no marker for trading logic change: ${forbidden}`);
}

console.log('phase3-scanner-runtime-log-pipeline.test.ts passed');
