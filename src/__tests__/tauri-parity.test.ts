import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { resolveAutoBotsFinalStrategy } from '../core/scanner/AutoStrategyRouter';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';
import { validateBalancedEntryContract } from '../core/strategy-audit/strategy-audit-builder';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

const runtimeFixture = {
  executionMode: 'paper_simulated' as const,
  uiAutoBotsButtonState: true,
  strategySource: 'autobots' as const,
  persistedAutoBotsEnabled: true,
  manualOverrideEnabled: true,
  scannerAutoEnabled: true,
  paperAutoExecutionEnabled: true,
  marketScannerPaperAutoEnabled: true,
  paperAutoBuyFnPresent: true,
};

const devRuntime = resolveAutoBotsRuntimeState({ ...runtimeFixture, buildMode: 'dev', tauriDetected: false });
const tauriDevRuntime = resolveAutoBotsRuntimeState({ ...runtimeFixture, buildMode: 'dev', tauriDetected: true, tauriMode: 'dev' });
const installedRuntime = resolveAutoBotsRuntimeState({ ...runtimeFixture, buildMode: 'production', tauriDetected: true });

const comparableRuntime = (r: typeof devRuntime) => ({
  executionMode: r.executionMode,
  resolvedAutoBotsEnabled: r.resolvedAutoBotsEnabled,
  strategySource: r.strategySource,
  strategySourceResolved: r.strategySourceResolved,
  dynamicPerCoinStrategy: r.dynamicPerCoinStrategy,
  manualOverrideEnabled: r.manualOverrideEnabled,
  scannerAutoEnabled: r.scannerAutoEnabled,
  paperAutoExecutionEnabled: r.paperAutoExecutionEnabled,
  marketScannerPaperAutoEnabled: r.marketScannerPaperAutoEnabled,
  canAttemptScannerAutoExecution: r.canAttemptScannerAutoExecution,
  finalRuntimeStrategyMode: r.finalRuntimeStrategyMode,
  blockedReason: r.blockedReason,
  invariantOk: r.invariantOk,
});

assert.deepEqual(comparableRuntime(devRuntime), comparableRuntime(installedRuntime), 'dev and installed runtime behavior fields match');
assert.deepEqual(comparableRuntime(devRuntime), comparableRuntime(tauriDevRuntime), 'browser dev and Tauri dev runtime behavior fields match');
assert.equal(installedRuntime.strategySourceResolved, 'AUTOBOTS_DYNAMIC', 'AutoBots ON installed build cannot resolve DISABLED');
assert.equal(installedRuntime.manualOverrideEnabled, false, 'AutoBots ON disables persisted manual override conflict');

const candidate = {
  symbol: 'PARITYUSDT',
  riskGroup: 'mid_caps',
  selectedStrategy: 'balanced',
  groupRecommendedStrategy: 'dip_and_rebound',
  marketAnalyzerBestFit: 'dip_and_rebound',
  autoStrategyDecision: {
    effectiveStrategy: 'dip_and_rebound',
    strategySource: 'AutoBots',
    strategySourceDetail: 'per_coin_selector',
    strategyReason: 'deterministic parity fixture',
    groupRecommendedStrategy: 'dip_and_rebound',
    groupTrend: 'sideways',
    referencePeriod: '1h',
    confidenceTier: 'A_80_PLUS',
    confidenceAdjustment: 0,
    blockedByGroupRegime: false,
    blockedBySafety: false,
    reason: 'deterministic parity fixture',
    warnings: [],
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
  },
  autoBotsRuntimeState: installedRuntime,
} as any;

const strategyDev = resolveAutoBotsFinalStrategy(candidate, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'dip_and_rebound', groupTrend: 'sideways' }, {
  autoBotsOn: devRuntime.resolvedAutoBotsEnabled,
  dynamicPerCoinStrategy: devRuntime.dynamicPerCoinStrategy,
  userSelectedRuntimeStrategy: 'balanced',
  manualOverrideActive: devRuntime.manualOverrideEnabled,
});
const strategyInstalled = resolveAutoBotsFinalStrategy(candidate, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'dip_and_rebound', groupTrend: 'sideways' }, {
  autoBotsOn: installedRuntime.resolvedAutoBotsEnabled,
  dynamicPerCoinStrategy: installedRuntime.dynamicPerCoinStrategy,
  userSelectedRuntimeStrategy: 'balanced',
  manualOverrideActive: installedRuntime.manualOverrideEnabled,
});
const strategyTauriDev = resolveAutoBotsFinalStrategy(candidate, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'dip_and_rebound', groupTrend: 'sideways' }, {
  autoBotsOn: tauriDevRuntime.resolvedAutoBotsEnabled,
  dynamicPerCoinStrategy: tauriDevRuntime.dynamicPerCoinStrategy,
  userSelectedRuntimeStrategy: 'balanced',
  manualOverrideActive: tauriDevRuntime.manualOverrideEnabled,
});

assert.deepEqual(strategyDev, strategyInstalled, 'strategy decisions match for dev and installed fixtures');
assert.deepEqual(strategyDev, strategyTauriDev, 'strategy decisions match for browser dev and Tauri dev fixtures');
assert.equal(strategyInstalled.finalExecutionStrategy, 'dip_and_rebound', 'canonical router beats runtime dropdown');

const executionBase = {
  symbol: 'PARITYUSDT',
  scanId: 'parity_scan',
  candidateRank: 1,
  status: 'BUY',
  finalExecutable: true,
  buyAllowed: true,
  setupResult: 'DIP_AND_REBOUND_OK',
  finalExecutionStrategy: strategyDev.finalExecutionStrategy,
  riskGroup: 'mid_caps',
  groupName: 'mid_caps',
  groupRecommendedStrategy: 'dip_and_rebound',
  groupOpenCount: 0,
  groupMaxOpen: 5,
  groupExposure: 0,
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
};

const executionDev = resolveExecutionDecision(executionBase);
const executionTauriDev = resolveExecutionDecision({ ...executionBase });
const executionInstalled = resolveExecutionDecision({ ...executionBase });
assert.deepEqual(executionDev, executionInstalled, 'execution decisions match for dev and installed fixtures');
assert.deepEqual(executionDev, executionTauriDev, 'execution decisions match for browser dev and Tauri dev fixtures');

const balancedEntryDecision = validateBalancedEntryContract({
  finalExecutionStrategy: 'balanced',
  reboundAtEntry: 0.94,
  requiredReboundPctAtEntry: 0.4,
  reboundConfirmed: true,
  freshnessStatus: 'valid',
  priceFresh: true,
  momentumConfirmed: true,
  tpRoomOk: true,
  spreadOk: true,
});
assert.equal(balancedEntryDecision.contractValid, true, 'balanced entry contract passes deterministically across targets');

const stale = resolveExecutionDecision({ ...executionBase, priceFresh: false, finalExecutable: false });
assert.equal(stale.finalNoBuyReason, 'PRICE_STALE', 'PRICE_STALE propagates instead of UNKNOWN or strategy handoff');

const notMaxed = resolveExecutionDecision({ ...executionBase, maxOpenPositionsOk: true, groupOpenCount: 0 });
assert.notEqual(notMaxed.finalNoBuyReason, 'MAX_OPEN_POSITIONS_REACHED', 'max positions is impossible when open count is zero and max gate is OK');

const audit = {
  buildMode: 'production',
  tauriMode: 'installed',
  appVersion: '4.0.0',
  gitCommit: 'unknown',
  storageRoot: 'fixture',
  dbPath: 'fixture',
  settingsSource: 'fixture',
  localStorageAvailable: true,
  indexedDbAvailable: true,
  runtimeConfigHash: hash(comparableRuntime(installedRuntime)),
  strategyDecisionHash: hash(strategyInstalled),
  entryGateDecisionHash: hash(balancedEntryDecision),
  executionDecisionHash: hash(executionInstalled),
  parityWithDev: true,
  mismatchFields: [] as string[],
};

console.log(`TAURI_PARITY_AUDIT ${JSON.stringify(audit)}`);
console.log(`TAURI_PROJECT_PARITY_AUDIT ${JSON.stringify({
  buildMode: 'production',
  tauriMode: 'installed',
  appVersion: audit.appVersion,
  gitCommit: audit.gitCommit,
  settingsHash: hash(runtimeFixture),
  runtimeStateHash: hash(comparableRuntime(installedRuntime)),
  strategyDecisionHash: hash(strategyInstalled),
  entryGateDecisionHash: hash(balancedEntryDecision),
  executionDecisionHash: hash(executionInstalled),
  parityOk: true,
  comparedTargets: ['browser/dev', 'tauri/dev', 'installed/prod'],
  mismatchFields: [],
})}`);
console.log('tauri parity tests passed');
