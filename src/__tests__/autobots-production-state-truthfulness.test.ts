import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAutoBotsCanonicalState } from '../core/runtime/autobots-state';

const prodOn = resolveAutoBotsCanonicalState({
  executionMode: 'paper_simulated',
  uiAutoBotsButtonState: true,
  strategySource: 'autobots',
  persistedAutoBotsEnabled: true,
  manualOverrideEnabled: false,
  scannerAutoEnabled: true,
  paperAutoExecutionEnabled: true,
  marketScannerPaperAutoEnabled: true,
  paperAutoBuyFnPresent: true,
});

assert.equal(prodOn.resolvedAutoBotsEnabled, true, 'DEMO/paper AutoBots ON resolves AutoBots enabled');
assert.equal(prodOn.manualOverrideEnabled, false, 'AutoBots strategy source clears manual override');
assert.equal(prodOn.canAttemptScannerAutoExecution, true, 'DEMO/paper AutoBots ON can attempt scanner auto execution when callback is wired');
assert.equal(prodOn.finalBlockedReason, 'none', 'DEMO/paper AutoBots ON has no blocker with callback wired');

const manualConflict = resolveAutoBotsCanonicalState({
  executionMode: 'paper_simulated',
  uiAutoBotsButtonState: true,
  strategySource: 'autobots',
  persistedAutoBotsEnabled: true,
  manualOverrideEnabled: true,
  paperAutoBuyFnPresent: true,
});

assert.equal(manualConflict.strategySource, 'autobots', 'AutoBots ON owns strategy source over persisted manual override');
assert.equal(manualConflict.manualOverrideEnabled, false, 'Manual override is disabled/read-only while AutoBots is ON');
assert.equal(manualConflict.manualOverrideRequested, true, 'Manual override conflict is still auditable');
assert.equal(manualConflict.canAttemptScannerAutoExecution, true, 'Manual override conflict does not disable scanner auto execution when AutoBots owns strategy');
assert.equal(manualConflict.finalBlockedReason, 'none', 'AutoBots ON conflict is resolved canonically, not blocked as manual');

const prodOff = resolveAutoBotsCanonicalState({
  executionMode: 'paper_simulated',
  uiAutoBotsButtonState: false,
  strategySource: 'manual_override',
  persistedAutoBotsEnabled: false,
  manualOverrideEnabled: true,
  paperAutoBuyFnPresent: true,
});

assert.equal(prodOff.resolvedAutoBotsEnabled, false, 'AutoBots OFF stays disabled');
assert.equal(prodOff.canAttemptScannerAutoExecution, false, 'AutoBots OFF cannot attempt scanner auto execution');

const repoRoot = process.cwd();
const scannerSrc = readFileSync(`${repoRoot}/src/core/scanner/MarketScanner.ts`, 'utf8');
const engineSrc = readFileSync(`${repoRoot}/src/core/trading/TradingEngine.ts`, 'utf8');
const cardSrc = readFileSync(`${repoRoot}/src/components/trade-v4/TradingParametersCard.tsx`, 'utf8');
const tradePageSrc = readFileSync(`${repoRoot}/src/ui/pages/TradePage.tsx`, 'utf8');

assert(scannerSrc.includes('AUTO_EXECUTION_CANONICAL_STATE_AUDIT'), 'Scanner emits canonical AutoBots state audit');
assert(scannerSrc.includes('strategySourceRaw') && scannerSrc.includes('strategySourceResolved'), 'Safe fallback logs include raw and resolved strategy source');
assert(scannerSrc.includes('fallbackApplied') && scannerSrc.includes('finalStrategySource'), 'Safe fallback logs expose fallback and final strategy source');
assert(engineSrc.includes('BUY_DECISION_CHAIN_AUDIT'), 'Engine emits full buy decision chain audit before order submission');
assert(engineSrc.indexOf('BUY_DECISION_CHAIN_AUDIT') < engineSrc.indexOf('this.adapter.submitOrder(req)'), 'Buy decision chain audit is emitted before adapter submit');
assert(engineSrc.includes('BUY_ORDER_LIFECYCLE_AUDIT'), 'Engine emits buy order lifecycle audit after persistence');
assert(engineSrc.includes('PRICE_TIMESTAMP_ORDER_AUDIT'), 'Exit audit diagnoses future timestamps before clamping age');
assert(cardSrc.includes('AutoBots active — manual setup is read-only.'), 'Manual setup UI has exact AutoBots read-only copy');
assert(cardSrc.includes('AutoBots scan only — auto BUY execution disabled.'), 'UI warns when runtime cannot auto buy');
assert(tradePageSrc.includes('getCanonicalAutoExecutionState'), 'Trade page reads canonical runtime state');

console.log('autobots production state truthfulness tests passed');
