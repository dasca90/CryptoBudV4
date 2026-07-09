import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { normalizeUnicornFinalBlockReason } from '../core/unicorn/unicornExecutionBlockers';

assert.equal(
  normalizeUnicornFinalBlockReason('DUPLICATE_OPEN_POSITION'),
  'UNICORN_BLOCK_DUPLICATE_POSITION',
  'Unicorn duplicate open position normalizes to the final Unicorn duplicate blocker',
);

assert.equal(
  normalizeUnicornFinalBlockReason('fresh_strategy_is_wait'),
  'UNICORN_BLOCK_WAITING_CONFIRMATION',
  'Entry-ready Unicorn candidates blocked before submit keep a final waiting-confirmation reason',
);

assert.equal(
  normalizeUnicornFinalBlockReason('MOMENTUM_BUILDING'),
  'STAGE_NOT_EXECUTABLE',
  'Unicorn watchlist lifecycle stages are not reported as handoff integrity failures',
);

assert.equal(
  normalizeUnicornFinalBlockReason('cooldown_active'),
  'UNICORN_COOLDOWN_ACTIVE',
  'Unicorn cooldown is distinct from the per-cycle submit cap',
);

assert.equal(
  normalizeUnicornFinalBlockReason('scanner_cycle_started'),
  'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE',
  'scanner_cycle_started is never a final Unicorn no-buy blocker',
);

assert.equal(
  normalizeUnicornFinalBlockReason('MAX_EXECUTION_QUEUE_REACHED'),
  'MAX_EXECUTION_QUEUE_REACHED',
  'Execution queue blocks stay distinct from the Unicorn cycle-budget reason',
);

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
const tradePageSrc = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const tradeTypesSrc = readFileSync('src/components/trade-v4/types.ts', 'utf8');
const paperControllerSrc = readFileSync('src/core/scanner/PaperAutoExecutionController.ts', 'utf8');

assert.ok(scannerSrc.includes('UNICORN_PIPELINE_AUDIT'), 'Unicorn pipeline audit exists');
assert.ok(scannerSrc.includes('UNICORN_EXECUTION_SELECTION_AUDIT'), 'Unicorn execution-selection audit exists');
assert.ok(scannerSrc.includes('UNICORN_NO_SUBMIT_REASON_AUDIT'), 'Unicorn no-submit reason audit exists');
assert.ok(scannerSrc.includes('UNICORN_SUBMIT_ATTEMPT_AUDIT'), 'Unicorn submit-attempt audit exists');
assert.ok(scannerSrc.includes("rawReasonIfSkipped === 'scanner_cycle_started' ? 'evaluating'"), 'scanner_cycle_started is sanitized out of displayed runtime reason');
assert.ok(scannerSrc.includes('lastUnicornAdapterCalled'), 'Scanner runtime persists Unicorn adapterCalled state');
assert.ok(scannerSrc.includes('recordPreAdapterBlocker(sc.symbol, \'fresh_strategy_not_executable\')'), 'entry-ready selected Unicorn candidates blocked before submit persist a final no-submit blocker');
assert.ok(scannerSrc.includes('selectedDecisionReason(unicornSelectedWithoutSubmit.symbol)'), 'selected-but-not-submitted Unicorn status reads the real per-symbol blocker');

assert.ok(plannerSrc.includes('isUnicornCandidate ? normalizeUnicornNoBuyReason'), 'Planner uses Unicorn-specific final blocker normalization only for Unicorn candidates');
assert.ok(plannerSrc.includes('duplicateOpenPosition') && plannerSrc.includes('DUPLICATE_OPEN_POSITION'), 'Existing AutoBots duplicate-position protection remains in the planner');
assert.ok(paperControllerSrc.includes('DUPLICATE_OPEN_POSITION'), 'Existing AutoBots paper controller duplicate-position protection remains');

assert.ok(tradeTypesSrc.includes('lastUnicornAdapterCalled: boolean'), 'UI model exposes real Unicorn adapterCalled state');
assert.ok(tradePageSrc.includes('unicorn candidate') && tradePageSrc.includes('unicorn adapter'), 'Trade UI shows Unicorn candidate and adapterCalled state');

console.log('unicorn-blocked-reason-propagation tests passed');
