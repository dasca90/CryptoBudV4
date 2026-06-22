import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { resolveProfessionalGateDecision, validateBalancedEntryContract } from '../core/strategy-audit/strategy-audit-builder';

const on = resolveAutoBotsRuntimeState({
  executionMode: 'paper_simulated',
  buildMode: 'production',
  tauriDetected: true,
  uiAutoBotsButtonState: true,
  strategySource: 'autobots',
  persistedAutoBotsEnabled: true,
  manualOverrideEnabled: false,
  scannerAutoEnabled: true,
  paperAutoExecutionEnabled: true,
  marketScannerPaperAutoEnabled: true,
  paperAutoBuyFnPresent: true,
});

assert.equal(on.resolvedAutoBotsEnabled, true, 'AutoBots ON resolves enabled');
assert.equal(on.uiAutoBotsOn, true, 'canonical runtime exposes UI AutoBots ON alias');
assert.equal(on.autoBotsResolvedOn, true, 'canonical runtime exposes resolved ON alias');
assert.equal(on.dynamicPerCoinStrategy, true, 'AutoBots ON enables dynamic per-coin strategy');
assert.notEqual(on.strategySourceResolved, 'DISABLED', 'AutoBots ON cannot resolve DISABLED');
assert.equal(on.strategySourceResolved, 'AUTOBOTS_DYNAMIC', 'AutoBots ON resolves dynamic strategy source');
assert.equal(on.canAttemptScannerAutoExecution, true, 'AutoBots ON demo can attempt execution when callback is wired');
assert.equal(on.invariantOk, true, 'AutoBots ON invariant holds');

const off = resolveAutoBotsRuntimeState({
  executionMode: 'paper_simulated',
  uiAutoBotsButtonState: false,
  strategySource: 'autobots',
  persistedAutoBotsEnabled: false,
  manualOverrideEnabled: false,
  paperAutoBuyFnPresent: true,
});

assert.equal(off.resolvedAutoBotsEnabled, false, 'AutoBots OFF resolves disabled');
assert.equal(off.strategySourceResolved, 'DISABLED', 'AutoBots OFF resolves DISABLED truthfully');
assert.equal(off.canAttemptScannerAutoExecution, false, 'AutoBots OFF cannot execute');

const dev = resolveAutoBotsRuntimeState({ ...on, buildMode: 'dev', tauriDetected: false });
const prod = resolveAutoBotsRuntimeState({ ...on, buildMode: 'production', tauriDetected: true });
assert.equal(dev.resolvedAutoBotsEnabled, prod.resolvedAutoBotsEnabled, 'dev/prod enabled parity');
assert.equal(dev.dynamicPerCoinStrategy, prod.dynamicPerCoinStrategy, 'dev/prod dynamic parity');
assert.equal(dev.strategySourceResolved, prod.strategySourceResolved, 'dev/prod strategy source parity');
assert.equal(dev.canAttemptScannerAutoExecution, prod.canAttemptScannerAutoExecution, 'dev/prod execution parity');

const reboundOk = validateBalancedEntryContract({
  finalExecutionStrategy: 'balanced',
  reboundAtEntry: 0.94,
  requiredReboundPctAtEntry: 0.4,
  reboundConfirmed: true,
  freshnessStatus: 'valid',
  priceFresh: true,
  momentumConfirmed: true,
  tpRoomOk: true,
  spreadOk: true,
  status: 'BUY',
  entryGateDecision: 'ALLOW',
});

assert.notEqual(reboundOk.contractViolationReason, 'rebound_below_required', 'rebound above required cannot fail as below required');
assert.equal(reboundOk.contractValid, true, 'balanced contract passes when required gates pass');

const staleRebound = validateBalancedEntryContract({
  finalExecutionStrategy: 'balanced',
  reboundAtEntry: 6.48,
  requiredReboundPctAtEntry: 0.4,
  reboundConfirmed: true,
  freshnessStatus: 'stale',
  priceFresh: true,
  momentumConfirmed: true,
  tpRoomOk: true,
  spreadOk: true,
  status: 'BUY',
  entryGateDecision: 'ALLOW',
});

assert.equal(staleRebound.primaryBlocker, 'rebound_stale', 'stale rebound uses stale blocker');
assert.notEqual(staleRebound.contractViolationReason, 'rebound_below_required', 'stale rebound is not mislabeled below required');

const professionalWait = validateBalancedEntryContract({
  finalExecutionStrategy: 'balanced',
  reboundAtEntry: 0.94,
  requiredReboundPctAtEntry: 0.4,
  reboundConfirmed: true,
  freshnessStatus: 'valid',
  priceFresh: true,
  momentumConfirmed: true,
  tpRoomOk: true,
  spreadOk: true,
  professionalGateHard: true,
  professionalVerdict: 'WAIT',
  status: 'BUY',
  entryGateDecision: 'ALLOW',
});

assert.equal(professionalWait.finalExecutable, true, 'Professional WAIT is external to Balanced contract');
assert.equal(professionalWait.primaryBlocker, 'none', 'Balanced contract does not report Professional WAIT as a strategy blocker');
const professionalHardGate = resolveProfessionalGateDecision({
  enabled: true,
  mode: 'hard_gate',
  score: 92,
  threshold: 80,
  verdict: 'WAIT',
});
assert.equal(professionalHardGate.allowed, false, 'Professional WAIT hard gate blocks execution');
assert.equal(professionalHardGate.blocker, 'PROFESSIONAL_VERDICT_WAIT', 'Professional WAIT blocker is exact');

const appSrc = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
const scannerSrc = readFileSync(`${process.cwd()}/src/core/scanner/MarketScanner.ts`, 'utf8');
const builderSrc = readFileSync(`${process.cwd()}/src/core/strategy-audit/strategy-audit-builder.ts`, 'utf8');
const ownershipSrc = readFileSync(`${process.cwd()}/src/core/trading/TradingTargetOwnership.ts`, 'utf8');
const engineSrc = readFileSync(`${process.cwd()}/src/core/trading/TradingEngine.ts`, 'utf8');

assert(appSrc.includes('settings.paperAutoExecutionEnabled ?? true'), 'scanner start uses fresh-install AutoBots ON default');
assert(scannerSrc.includes('RUNTIME_AUTOBOTS_STATE_INTEGRITY_FAILED'), 'runtime state invariant failure is logged');
assert(scannerSrc.includes('AUTOBOTS_RUNTIME_STATE_INTEGRITY_FAILED'), 'canonical AutoBots runtime state invariant failure is logged');
assert(scannerSrc.includes('PROFESSIONAL_GATE_AUDIT'), 'professional gate emits explicit audit');
assert(builderSrc.includes('ENTRY_CONTRACT_VALIDATION_AUDIT'), 'entry contract validation audit exists');
assert(builderSrc.includes('STRATEGY_DECISION_CONSUMER_INTEGRITY_AUDIT'), 'strategy decision consumer integrity audit exists');
assert(builderSrc.includes('HIDDEN_BALANCED_BLOCKER_BUG'), 'hidden balanced blocker guard exists');
assert(builderSrc.includes('UNKNOWN_FINAL_EXECUTABLE_BUG'), 'unknown final executable reason is guarded');
assert(ownershipSrc.includes('STRATEGY_TP1_HANDOFF_AUDIT'), 'TP1 strategy handoff audit exists');
assert(engineSrc.includes('STRATEGY_TP1_HANDOFF_INTEGRITY_FAILED'), 'TP1 strategy mismatch blocks before order submit');

console.log('autobots runtime contract root-cause tests passed');
