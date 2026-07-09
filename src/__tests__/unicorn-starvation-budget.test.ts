import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { autoBuyQueue } from '../core/trading/AutoBuyExecutionQueue';

autoBuyQueue.reset();
autoBuyQueue.recordBuySubmitted('SOLUSDT', 'autobots');

const unicornAfterAutobots = autoBuyQueue.blockIfCooldownActive('LDOUSDT', 'unicorn_hunter');
assert.equal(unicornAfterAutobots.blocked, false, 'Unicorn has an independent cooldown/budget window after an AutoBots submit');

const autobotsAfterAutobots = autoBuyQueue.blockIfCooldownActive('ETHUSDT', 'autobots');
assert.equal(autobotsAfterAutobots.blocked, true, 'AutoBots still respects its own cooldown after an AutoBots submit');

autoBuyQueue.recordBuySubmitted('LDOUSDT', 'unicorn_hunter');
const secondUnicorn = autoBuyQueue.blockIfCooldownActive('QNTUSDT', 'unicorn_hunter');
assert.equal(secondUnicorn.blocked, true, 'Unicorn cannot exceed its own safe cooldown window');

autoBuyQueue.reset();

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const queueSrc = readFileSync('src/core/trading/AutoBuyExecutionQueue.ts', 'utf8');
const blockersSrc = readFileSync('src/core/unicorn/unicornExecutionBlockers.ts', 'utf8');
const tradePageSrc = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const topCandidatesSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const coreTypesSrc = readFileSync('src/core/types/index.ts', 'utf8');

assert.ok(queueSrc.includes('lastBuyAtByModule'), 'AutoBuyQueue persists per-module cooldown accounting');
assert.ok(scannerSrc.includes('autobotsSubmitAttemptedThisCycle'), 'MarketScanner tracks AutoBots submit attempts per cycle');
assert.ok(scannerSrc.includes('unicornSubmitAttemptedThisCycle'), 'MarketScanner tracks Unicorn submit attempts per cycle');
assert.ok(scannerSrc.includes('globalSubmitAttemptedThisCycle'), 'MarketScanner tracks global submit attempts per cycle');
assert.ok(scannerSrc.includes('maxUnicornSubmitsPerCycle = this.unicornHunterSettings.maxUnicornBuysPerCycle'), 'MarketScanner uses the Unicorn-specific per-cycle budget');
assert.ok(scannerSrc.includes('unicornSelectedExecutableCount'), 'MarketScanner tracks selected executable Unicorn candidates');
assert.ok(scannerSrc.includes('unicornSelectedButNotSubmittedReason'), 'MarketScanner tracks exact Unicorn selected-but-not-submitted reason');
assert.ok(scannerSrc.includes("autoBuyQueue.blockIfCooldownActive(sc.symbol, executionModule)"), 'Main handoff uses module-scoped cooldown');
assert.ok(scannerSrc.includes("autoBuyQueue.recordBuySubmitted(sc.symbol, executionModule)"), 'Main handoff records module-scoped submits');
assert.ok(scannerSrc.includes('EXECUTION_BUDGET_ALLOCATION_AUDIT'), 'Execution budget allocation audit exists');
assert.ok(scannerSrc.includes('UNICORN_BUDGET_STATE_AUDIT'), 'Unicorn budget state audit exists');
assert.ok(scannerSrc.includes('EXECUTION_BUDGET_PARITY_AUDIT'), 'Execution budget parity audit exists');
assert.ok(scannerSrc.includes('UNICORN_EXECUTION_BUDGET_AUDIT'), 'Unicorn execution budget audit exists');
assert.ok(scannerSrc.includes('AUTOBOTS_EXECUTION_BUDGET_AUDIT'), 'AutoBots execution budget audit exists');
assert.ok(scannerSrc.includes('UNICORN_SLOT_OWNERSHIP_AUDIT'), 'Unicorn slot ownership audit exists');
assert.ok(scannerSrc.includes('UNICORN_SUBMIT_ELIGIBILITY_AUDIT'), 'Unicorn submit eligibility audit exists');
assert.ok(scannerSrc.includes('UNICORN_BUY_SUBMIT_AUDIT'), 'Unicorn submit audit exists');
assert.ok(scannerSrc.includes('selectedNoSubmitReasonForDecision'), 'Selected-but-not-submitted decisions get exact final reasons');
assert.ok(blockersSrc.includes('UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED'), 'Unicorn cycle-budget blocker is canonical');
assert.ok(blockersSrc.includes('UNICORN_BLOCK_COOLDOWN_ACTIVE'), 'Unicorn cooldown blocker is canonical');
assert.equal(scannerSrc.includes('UNICORN_BLOCK_GLOBAL_BUY_BUDGET_TAKEN_BY_AUTOBOTS'), false, 'MarketScanner does not block Unicorn because AutoBots used a slot');
assert.equal(blockersSrc.includes('UNICORN_BLOCK_GLOBAL_BUY_BUDGET_TAKEN_BY_AUTOBOTS'), false, 'Unicorn AutoBots-taken budget blocker was removed');
assert.equal(topCandidatesSrc.includes('UNICORN_BLOCK_GLOBAL_BUY_BUDGET_TAKEN_BY_AUTOBOTS'), false, 'UI no longer maps AutoBots-taken Unicorn budget blocker');
assert.ok(tradePageSrc.includes('unicorn executable') && tradePageSrc.includes('maxUnicornBuysPerCycle'), 'Trade UI exposes Unicorn execution budget state');
assert.ok(coreTypesSrc.includes('unicornSelectedExecutableCount?: number'), 'ExecutionPlan type exposes Unicorn budget counters');
assert.ok(coreTypesSrc.includes('maxUnicornBuysPerCycle?: number'), 'ExecutionPlan type exposes max Unicorn cycle budget');

console.log('unicorn-starvation-budget: all assertions passed');
