import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeUnicornFinalBlockReason } from '../core/unicorn/unicornExecutionBlockers';

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
const blockersSrc = readFileSync('src/core/unicorn/unicornExecutionBlockers.ts', 'utf8');
const tradingEngineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
const candidatePanelSrc = readFileSync('src/components/trade-v4/CandidatePoolSummaryPanel.tsx', 'utf8');

assert.equal(normalizeUnicornFinalBlockReason('MAX_EXECUTION_QUEUE_REACHED'), 'MAX_EXECUTION_QUEUE_REACHED');
assert.equal(normalizeUnicornFinalBlockReason('GLOBAL_MAX_OPEN_POSITIONS_REACHED'), 'GLOBAL_MAX_OPEN_POSITIONS_REACHED');
assert.equal(normalizeUnicornFinalBlockReason('UNICORN_MAX_BUYS_PER_CYCLE_REACHED'), 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED');
assert.equal(normalizeUnicornFinalBlockReason('UNICORN_MAX_OPEN_POSITIONS_REACHED'), 'UNICORN_MAX_OPEN_POSITIONS_REACHED');
assert.equal(normalizeUnicornFinalBlockReason('UNICORN_MAX_TRADES_PER_DAY_REACHED'), 'UNICORN_MAX_TRADES_PER_DAY_REACHED');
assert.equal(normalizeUnicornFinalBlockReason('STRATEGY_HANDOFF_INTEGRITY_FAILED'), 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
assert.equal(normalizeUnicornFinalBlockReason('DIP_NOT_CONFIRMED'), 'DIP_NOT_CONFIRMED');
assert.equal(normalizeUnicornFinalBlockReason('BREAKOUT_NOT_CONFIRMED'), 'BREAKOUT_NOT_CONFIRMED');
assert.equal(normalizeUnicornFinalBlockReason('MOMENTUM_NOT_CONFIRMED'), 'MOMENTUM_NOT_CONFIRMED');

assert.ok(!blockersSrc.includes("lower.includes('max_execution_queue')\n    || lower.includes('block_max_execution_queue')\n    || lower.includes('max_capital')"), 'queue/capital blockers are not folded into Unicorn cycle budget');
assert.ok(scannerSrc.includes('const maxAutobotsSubmitsPerCycle = 1'), 'AutoBots has its own per-cycle submit budget');
assert.ok(scannerSrc.includes('maxUnicornSubmitsPerCycle = this.unicornHunterSettings.maxUnicornBuysPerCycle'), 'Unicorn has its own per-cycle submit budget');
assert.ok(scannerSrc.includes('AUTOBOTS_BUDGET_STATE_AUDIT'), 'AutoBots budget state audit is emitted');
assert.ok(scannerSrc.includes('UNICORN_BUDGET_STATE_AUDIT'), 'Unicorn budget state audit is emitted');
assert.ok(scannerSrc.includes('EXECUTION_SLOT_OWNERSHIP_AUDIT'), 'Execution slot ownership audit is emitted');
assert.ok(scannerSrc.includes('autoBotsBlockedReason') && scannerSrc.includes('unicornBlockedReason'), 'Slot ownership audit keeps AutoBots and Unicorn blockers separate');
assert.ok(scannerSrc.includes("sourcePresentation = '🦄 Unicorn Hunter'"), 'Unicorn candidates carry the required presentation owner field');
assert.ok(!scannerSrc.includes('autobots_slot_used'), 'Unicorn no-buy flow does not use autobots_slot_used as a blocker');

assert.ok(plannerSrc.includes('MAX_EXECUTION_QUEUE_PER_SCAN = 10'), 'Execution queue remains capped at 10 per scan');
assert.ok(plannerSrc.includes('fairnessApplied') && plannerSrc.includes('unicornAcceptedInQueue'), 'Execution queue audit exposes Unicorn fairness fields');
assert.ok(plannerSrc.includes('unicornReadyQueueIndexBeforeFairness'), 'Planner can lift READY Unicorn candidates into the capped queue');

assert.ok(tradingEngineSrc.includes('sourceOwner') && tradingEngineSrc.includes('candidateSource') && tradingEngineSrc.includes("sourcePresentation=${(candidate as any).sourcePresentation ?? '🦄 Unicorn Hunter'}"), 'Unicorn submit audit carries source ownership fields');
assert.ok(tradingEngineSrc.includes('tradeId=') && tradingEngineSrc.includes('positionOwner') && tradingEngineSrc.includes('journalSource') && tradingEngineSrc.includes('telegramSource'), 'Unicorn position source audit carries persistence source fields');

assert.ok(candidatePanelSrc.includes('AutoBots ready') && candidatePanelSrc.includes('Unicorn submit') && candidatePanelSrc.includes('Global queue'), 'UI separates AutoBots, Unicorn, and Global execution state');

console.log('unicorn-slot-separation-regression: all assertions passed');
