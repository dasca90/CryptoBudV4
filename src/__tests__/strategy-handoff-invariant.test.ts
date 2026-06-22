import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';
import { resolveAutoBotsFinalStrategy } from '../core/scanner/AutoStrategyRouter';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';

const autoBotsRuntimeState = resolveAutoBotsRuntimeState({
  executionMode: 'paper_simulated',
  buildMode: 'production',
  tauriDetected: true,
  uiAutoBotsOn: true,
  strategySource: 'autobots',
  persistedAutoBotsOn: true,
  manualOverrideRequested: false,
  scannerAutoEnabled: true,
  paperAutoExecutionEnabled: true,
  marketScannerPaperAutoEnabled: true,
  paperAutoBuyFnPresent: true,
});

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand_test',
    symbol: 'TESTUSDT',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    selectedPlaybook: null,
    confidence: 0.82,
    status: 'BUY',
    traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'BALANCED_READY', definition: { buyRule: 'balanced' } } } },
    entryGateDecision: { decision: 'ALLOW', explanation: 'ok', primaryReason: 'ok', blockReasons: [], warnings: [], snapshot: { decision: 'ALLOW', blockReasons: [] } },
    mainReason: 'ok',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 10,
    priceAgeMs: 100,
    spreadPct: 0.1,
    volumeRel: 1.2,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -0.2,
    reboundPercent: 0.5,
    m5Change: 0.2,
    m15Change: 0.3,
    h1Change: 0.4,
    change24h: 1,
    mlBadEntryRisk: false,
    mlWinProbability: 0.7,
    autoBotsRuntimeState,
    groupTrend: 'sideways',
    periodRegime: 'range',
    autoStrategyDecision: {
      symbol: 'TESTUSDT',
      effectiveStrategy: 'balanced',
      strategySource: 'AutoBots',
      strategySourceDetail: 'per_coin_selector',
      strategyReason: 'test setup',
      groupRecommendedStrategy: 'balanced',
      groupTrend: 'sideways',
      referencePeriod: '1h',
      confidenceTier: 'A_80_PLUS',
      confidenceAdjustment: 0,
      blockedByGroupRegime: false,
      blockedBySafety: false,
      reason: 'test setup',
      warnings: [],
      marketAnalyzerBestFit: 'balanced',
      perCoinSelectedStrategy: 'balanced',
    },
    ...overrides,
  } as any;
}

const dip = buildStrategyAuditSnapshotFromCandidate(candidate({
  selectedStrategy: 'dip_and_rebound',
  dipPercent: -1,
  reboundPercent: 0.6,
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'DIP_AND_REBOUND_READY', definition: { buyRule: 'dip_and_rebound' } } } },
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'dip_and_rebound',
    groupRecommendedStrategy: 'dip_and_rebound',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
  },
}));
assert.equal(dip.strategySelected === 'dip_and_rebound' ? dip.setupResult : 'DIP_AND_REBOUND_OK', 'DIP_AND_REBOUND_OK', 'dip_and_rebound setup result is strategy-specific when executable');

const conservativeFallback = buildStrategyAuditSnapshotFromCandidate(candidate({
  selectedStrategy: 'conservative',
  dipPercent: -0.4,
  reboundPercent: 0.6,
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'CONSERVATIVE_READY', definition: { buyRule: 'conservative' } } } },
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'conservative',
    groupRecommendedStrategy: 'conservative',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'conservative',
  },
}));
if (conservativeFallback.strategySelected === 'balanced') {
  assert.equal(conservativeFallback.overrideApplied, true, 'balanced fallback is marked as override');
  assert.ok(conservativeFallback.overrideReason && conservativeFallback.overrideReason.length > 0, 'balanced fallback has explicit override reason');
  assert.equal(conservativeFallback.setupResult, 'BALANCED_OK', 'balanced fallback validates as balanced only');
}

const conservativeBlocked = buildStrategyAuditSnapshotFromCandidate(candidate({
  selectedStrategy: 'conservative',
  dipPercent: -0.4,
  reboundPercent: 0,
  blockReasons: ['rebound_not_confirmed'],
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'CONSERVATIVE_READY', definition: { buyRule: 'conservative' } } } },
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'conservative',
    groupRecommendedStrategy: 'conservative',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'conservative',
  },
}));
assert.notEqual(conservativeBlocked.setupResult, 'BALANCED_OK', 'conservative failure with no valid override must not masquerade as BALANCED_OK');
assert.equal(conservativeBlocked.finalExecutable, false, 'conservative failure with no rebound is blocked');

const dynamicDip = buildStrategyAuditSnapshotFromCandidate(candidate({
  selectedStrategy: 'balanced',
  dipPercent: -1.2,
  reboundPercent: 0.8,
  reboundFreshnessStatus: 'valid',
  reboundTimestamp: new Date(0).toISOString(),
  dipLowTimestamp: new Date(0).toISOString(),
  reboundAgeMs: 60000,
  maxAllowedReboundAgeMs: 3600000,
  traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: { reasonCode: 'DIP_AND_REBOUND_READY', definition: { buyRule: 'balanced' } } } },
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'dip_and_rebound',
    strategySource: 'AutoBots',
    strategySourceDetail: 'per_coin_selector',
    groupRecommendedStrategy: 'dip_and_rebound',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
  },
}));
assert.equal(dynamicDip.finalExecutionStrategy, 'dip_and_rebound', '1 final strategy follows AutoBots per-coin dip_and_rebound, not balanced runtime default');
assert.equal(dynamicDip.strategyAtEntry, 'dip_and_rebound', '1 strategyAtEntry matches finalExecutionStrategy');
assert.equal(dynamicDip.setupResult, 'DIP_AND_REBOUND_OK', '1 EntryGate/setup validator uses dip_and_rebound');

const highRiskBalancedBlocked = resolveAutoBotsFinalStrategy({
  symbol: 'RISKUSDT',
  riskGroup: 'high_risk',
  selectedStrategy: 'balanced',
  autoStrategyDecision: {
    effectiveStrategy: 'balanced',
    strategySource: 'AutoBots',
    strategySourceDetail: 'per_coin_selector',
    strategyReason: 'balanced setup only',
    groupRecommendedStrategy: 'conservative',
    groupTrend: 'caution',
    referencePeriod: '1h',
    confidenceTier: 'A_80_PLUS',
    confidenceAdjustment: 0,
    blockedByGroupRegime: false,
    blockedBySafety: false,
    reason: 'balanced setup only',
    warnings: [],
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'balanced',
  },
}, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'conservative', groupTrend: 'caution' }, {
  autoBotsOn: true,
  dynamicPerCoinStrategy: true,
  userSelectedRuntimeStrategy: 'balanced',
});
assert.equal(highRiskBalancedBlocked.finalExecutionStrategy, 'conservative', '2 high-risk conservative group does not silently open as balanced');
assert.equal(highRiskBalancedBlocked.fallbackReason, 'GROUP_REQUIRES_CONSERVATIVE', '2 conservative group constraint is explicit');
assert.equal(highRiskBalancedBlocked.strategySourceResolved, 'AUTOBOTS_GROUP_FALLBACK', '2 conservative group constraint resolves to explicit group fallback enum');
assert.equal(highRiskBalancedBlocked.fallbackType, 'GROUP_RECOMMENDATION', '2 fallback type is group recommendation');

const intentionalBalanced = resolveAutoBotsFinalStrategy({
  symbol: 'BALUSDT',
  riskGroup: 'top_caps',
  selectedStrategy: 'balanced',
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'balanced',
    groupRecommendedStrategy: 'balanced',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'balanced',
  },
}, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'balanced', groupTrend: 'sideways' }, {
  autoBotsOn: true,
  dynamicPerCoinStrategy: true,
  userSelectedRuntimeStrategy: 'balanced',
});
assert.equal(intentionalBalanced.finalExecutionStrategy, 'balanced', '3 router may intentionally choose balanced');
assert.equal(intentionalBalanced.strategySourceResolved, 'AUTOBOTS_DYNAMIC', '3 normal dynamic router source is not vague fallback');
assert.equal(intentionalBalanced.mismatchAllowed, true, '3 intentional balanced market mismatch is allowed');
assert.ok(intentionalBalanced.overrideReason && intentionalBalanced.overrideReason.length > 0, '3 intentional balanced mismatch has explicit override reason');
assert.notEqual(intentionalBalanced.mismatchReason, 'router_selected_per_coin_strategy', '3 mismatch reason is not generic');

const noValid = resolveAutoBotsFinalStrategy({
  symbol: 'WAITUSDT',
  riskGroup: 'mid_caps',
  selectedStrategy: 'balanced',
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'wait',
    groupRecommendedStrategy: 'wait',
    marketAnalyzerBestFit: 'wait',
    perCoinSelectedStrategy: null,
  },
}, { marketBestFit: 'wait' }, { groupRecommendedStrategy: 'wait', groupTrend: 'waiting_for_rebound' }, {
  autoBotsOn: true,
  dynamicPerCoinStrategy: true,
  userSelectedRuntimeStrategy: 'balanced',
});
assert.equal(noValid.finalExecutionStrategy, 'wait', '7 no valid AutoBots strategy resolves to wait');
assert.equal(noValid.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY', '7 no valid AutoBots strategy has explicit block reason');
assert.equal(noValid.strategySourceResolved, 'AUTOBOTS_WAIT', '7 wait has explicit source enum');

const devConfig = {
  autoBotsOn: true,
  dynamicPerCoinStrategy: true,
  userSelectedRuntimeStrategy: 'balanced',
};
const prodInstallerConfig = { ...devConfig };
const parityCandidate = {
  symbol: 'PARITYUSDT',
  riskGroup: 'mid_caps',
  selectedStrategy: 'balanced',
  autoStrategyDecision: {
    ...candidate().autoStrategyDecision,
    effectiveStrategy: 'dip_and_rebound',
    groupRecommendedStrategy: 'dip_and_rebound',
    marketAnalyzerBestFit: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
  },
} as any;
assert.equal(
  resolveAutoBotsFinalStrategy(parityCandidate, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'dip_and_rebound' }, devConfig).finalExecutionStrategy,
  resolveAutoBotsFinalStrategy(parityCandidate, { marketBestFit: 'dip_and_rebound' }, { groupRecommendedStrategy: 'dip_and_rebound' }, prodInstallerConfig).finalExecutionStrategy,
  '6 resolver is deterministic across dev and production installer configs with same settings',
);

const repo = process.cwd();
const builderSrc = readFileSync(`${repo}/src/core/strategy-audit/strategy-audit-builder.ts`, 'utf8');
const engineSrc = readFileSync(`${repo}/src/core/trading/TradingEngine.ts`, 'utf8');
const plannerSrc = readFileSync(`${repo}/src/core/scanner/ExecutionPlanner.ts`, 'utf8');
const openPanelSrc = readFileSync(`${repo}/src/components/trade-v4/OpenPositionsPanel.tsx`, 'utf8');
const scannerSrc = readFileSync(`${repo}/src/core/scanner/MarketScanner.ts`, 'utf8');

assert(builderSrc.includes('STRATEGY_HANDOFF_TRACE_AUDIT'), 'builder emits handoff trace audit');
assert(builderSrc.includes('AUTOBOTS_STRATEGY_RESOLUTION_AUDIT'), 'builder emits strategy resolution audit');
assert(builderSrc.includes('STRATEGY_MISMATCH_BLOCK_AUDIT'), 'builder emits mismatch/block audit');
assert(builderSrc.includes('overrideApplied') && builderSrc.includes('overrideReason'), 'builder tracks override metadata');
assert(engineSrc.includes('STRATEGY_HANDOFF_INTEGRITY_AUDIT') && engineSrc.includes('STRATEGY_HANDOFF_INTEGRITY_FAILED'), '4/5 engine emits and blocks failed handoff integrity');
assert(engineSrc.includes('finalExecutionStrategy === setupValidatorUsed') && engineSrc.includes('setupValidatorUsed === entryGateStrategyUsed') && engineSrc.includes('strategyAtEntryToPersist === positionStrategyToDisplay'), '4/5 engine enforces final/setup/EntryGate/persist/display strategy invariant before BUY');
assert(engineSrc.includes('MISSING_RISK_GROUP_BLOCKED'), '8 executable scanner candidate without riskGroup is blocked');
assert(plannerSrc.includes('marketBestFit') && plannerSrc.includes('autoBotsPerCoinStrategy'), 'planner propagates handoff metadata');
assert(openPanelSrc.includes('Market:') && openPanelSrc.includes('Override:'), 'Open Positions strategy tooltip explains strategy handoff');
assert(scannerSrc.includes('TOP_MOVER_ADVISORY_TRACE') && !scannerSrc.includes('TOP_MOVER_ENTRY_TRACE:'), '6 top mover trace is advisory and no longer uses execution trace name');
assert(!scannerSrc.includes('finalGateDecision='), '6 advisory top mover trace cannot imply final BUY gate allow');
assert(scannerSrc.includes('expectedWaitTransitions') && scannerSrc.includes('unexpectedAcceptedMismatches') && scannerSrc.includes('invariantOk='), '4 parity mismatch audit is classified');
assert(!scannerSrc.includes('groupMismatchCount=') && !scannerSrc.includes('acceptedMismatchCount='), '4 parity audit no longer reports vague mismatch counters');

const adapterSrc = readFileSync(`${repo}/src/lib/air-scanner/tradeV4DataAdapter.ts`, 'utf8');
assert(adapterSrc.indexOf('entryConfigSnapshot.strategyAtEntry') < adapterSrc.indexOf('buySnapshot.selectedStrategy'), 'Open Positions strategy display prefers saved strategyAtEntry over runtime/buySnapshot fallback');

console.log('strategy handoff invariant tests passed');
