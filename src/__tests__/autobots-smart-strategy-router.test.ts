import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAutoBotsFinalStrategy, resolveAutoBotsSmartStrategy } from '../core/scanner/AutoStrategyRouter';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';

const runtime = {
  autoBotsOn: true,
  dynamicPerCoinStrategy: true,
  userSelectedRuntimeStrategy: 'balanced',
  manualOverrideActive: false,
};

function cake(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'scan-cake:CAKEUSDT',
    symbol: 'CAKEUSDT',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    groupTrend: 'sideways',
    groupRecommendedStrategy: 'wait',
    marketAnalyzerBestFit: 'wait',
    perCoinSelectedStrategy: null,
    autoStrategyDecision: {
      symbol: 'CAKEUSDT',
      effectiveStrategy: 'wait',
      groupRecommendedStrategy: 'wait',
      groupTrend: 'sideways',
      marketAnalyzerBestFit: 'wait',
      perCoinSelectedStrategy: null,
    },
    professionalAnalysis: {
      professionalScore: 81,
      professionalVerdict: 'STRONG_BUY',
      professionalBlockers: [],
    },
    dipPercent: 0,
    reboundPercent: 5.209,
    reboundConfirmed: true,
    reboundFreshnessStatus: 'valid',
    momentumConfirmed: false,
    spreadOk: true,
    tpRoomOk: true,
    priceFresh: true,
    bookFresh: true,
    mlBadEntryRisk: false,
    mlWinProbability: 0,
    blockReasons: [],
    ...overrides,
  } as any;
}

function legacyWaitSmartCandidate(overrides: Record<string, unknown> = {}) {
  return cake({
    autoStrategyDecision: {
      symbol: 'SMARTUSDT',
      effectiveStrategy: 'wait',
      groupRecommendedStrategy: 'wait',
      groupTrend: 'sideways',
      marketAnalyzerBestFit: 'wait',
      perCoinSelectedStrategy: null,
      strategySource: 'AutoBots_SafeFallback',
      strategySourceDetail: 'group_fallback',
    },
    selectedStrategy: 'balanced',
    effectiveStrategy: 'wait',
    perCoinSelectedStrategy: null,
    groupRecommendedStrategy: 'wait',
    marketAnalyzerBestFit: 'wait',
    ...overrides,
  });
}

function assertSmartHandoffSurvives(overrides: Record<string, unknown>, expected: string) {
  const resolution = resolveAutoBotsFinalStrategy(
    legacyWaitSmartCandidate(overrides),
    { marketBestFit: 'wait' },
    { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' },
    runtime,
  );
  assert.equal(resolution.selectedStrategy, expected);
  assert.equal(resolution.perCoinSelectedStrategy, expected);
  assert.equal(resolution.finalExecutionStrategy, expected);
  assert.equal(resolution.routerPath, 'smart_strategy_router');
  assert.equal(resolution.fallbackApplied, false);
  assert.equal(resolution.fallbackReason, null);
  assert.notEqual(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
  assert.equal(resolution.strategySourceResolved, 'AUTOBOTS_DYNAMIC');
}

// Test 1 - Smart STRONG_BUY with valid rebound setup selects an executable strategy.
{
  const resolution = resolveAutoBotsFinalStrategy(cake(), { marketBestFit: 'wait' }, { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' }, runtime);
  assert.notEqual(resolution.finalExecutionStrategy, 'wait');
  assert.notEqual(resolution.selectedStrategy, null);
  assert.notEqual(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
  assert(['dip_and_rebound', 'balanced', 'momentum', 'conservative'].includes(resolution.finalExecutionStrategy));
}

// Test 2 - STRONG_BUY with every strategy failing returns exact per-strategy trace.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    reboundPercent: 0,
    reboundConfirmed: false,
    momentumConfirmed: false,
    spreadOk: false,
    tpRoomOk: false,
  }), { marketBestFit: 'wait' }, { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.finalExecutionStrategy, 'wait');
  assert.equal(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
  assert.equal(resolution.evaluatedStrategies.length, 4);
  assert(resolution.evaluatedStrategies.every((s) => s.failedConditions.length > 0));
  assert(resolution.noValidStrategyTrace.some((t) => t.startsWith('balanced:') && t.includes('spreadOk=true')));
}

// Test 3 - ML shadow/advisory cannot block a valid Smart strategy.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    mlBadEntryRisk: true,
    mlWinProbability: 0.01,
    mlShadowDecision: 'HOLD',
  }), { marketBestFit: 'wait' }, { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.finalExecutionStrategy, 'balanced');
  assert.equal(resolution.fallbackReason, null);
}

// Test 4 - Professional WAIT hard gate blocks explicitly, not as no-valid-strategy.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    professionalGateMode: 'hard_gate',
    professionalAnalysis: { professionalScore: 81, professionalVerdict: 'WAIT', professionalBlockers: [] },
  }), { marketBestFit: 'balanced' }, { groupRecommendedStrategy: 'balanced', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.finalExecutionStrategy, 'wait');
  assert.equal(resolution.fallbackReason, 'PROFESSIONAL_VERDICT_WAIT');
  assert.notEqual(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
}

// Test 5 - Professional STRONG_BUY advisory allows strategy contract evaluation.
{
  const smart = resolveAutoBotsSmartStrategy(cake({ professionalGateMode: 'advisory' }), {},);
  assert.equal(smart.professionalMode, 'advisory');
  assert.equal(smart.professionalVerdict, 'STRONG_BUY');
  assert.equal(smart.evaluatedStrategies.length, 4);
  assert.equal(smart.selectedStrategy, 'balanced');
}

// Test 6 - wait remains non-executable in execution decision semantics.
{
  const decision = resolveExecutionDecision({
    symbol: 'WAITUSDT',
    scanId: 'scan-wait',
    candidateRank: 1,
    status: 'WAIT',
    finalExecutable: false,
    buyAllowed: false,
    setupResult: 'WAITING_FOR_SETUP',
    finalExecutionStrategy: 'wait',
    riskGroup: 'mid_caps',
    groupName: 'mid_caps',
    groupRecommendedStrategy: 'wait',
    groupOpenCount: 0,
    groupMaxOpen: 10,
    groupExposure: 0,
    groupMaxExposure: 100,
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
  });
  assert.equal(decision.selectedForExecution, false);
  assert.equal(decision.submitAttempted, false);
  assert.equal(decision.positionCreated, false);
  assert.equal(decision.finalDecision, 'SKIP');
}

// Test 7 - perCoinSelectedStrategy=n/a wait cannot happen without an evaluation trace.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    reboundPercent: 0,
    reboundConfirmed: false,
    momentumConfirmed: false,
  }), { marketBestFit: 'wait' }, { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.finalExecutionStrategy, 'wait');
  assert(resolution.evaluatedStrategies.length > 0);
  assert(resolution.noValidStrategyTrace.length >= 4);
}

// Test 8 - existing valid balanced-style fixture remains valid.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    symbol: 'MEGAUSDT',
    candidateId: 'scan-mega:MEGAUSDT',
    professionalAnalysis: { professionalScore: 88, professionalVerdict: 'BUY', professionalBlockers: [] },
    reboundPercent: 1.1,
    momentumConfirmed: true,
  }), { marketBestFit: 'balanced' }, { groupRecommendedStrategy: 'balanced', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.finalExecutionStrategy, 'balanced');
}

// Test 9 - Smart balanced contract beats stale legacy conservative fallback.
{
  const resolution = resolveAutoBotsFinalStrategy(cake({
    autoStrategyDecision: {
      symbol: 'CAKEUSDT',
      effectiveStrategy: 'conservative',
      groupRecommendedStrategy: 'conservative',
      groupTrend: 'sideways',
      marketAnalyzerBestFit: 'balanced',
      perCoinSelectedStrategy: 'conservative',
      strategySource: 'AutoBots_SafeFallback',
      strategySourceDetail: 'fallback_conservative',
    },
    groupRecommendedStrategy: 'conservative',
    marketAnalyzerBestFit: 'balanced',
    perCoinSelectedStrategy: 'conservative',
    reboundPercent: 0.9,
    momentumConfirmed: false,
  }), { marketBestFit: 'balanced' }, { groupRecommendedStrategy: 'conservative', groupTrend: 'sideways' }, runtime);
  assert.equal(resolution.selectedStrategy, 'balanced');
  assert.equal(resolution.finalExecutionStrategy, 'balanced');
  assert.equal(resolution.routerPath, 'smart_strategy_router');
  assert.equal(resolution.overrideReason, 'smart_strategy_router_overrode_legacy_conservative');
}

// Test 10 - Smart dip_and_rebound survives a legacy wait/no-per-coin handoff.
assertSmartHandoffSurvives({
  symbol: 'DIPUSDT',
  candidateId: 'scan-dip:DIPUSDT',
  dipPercent: -1.4,
  reboundPercent: 0.7,
  reboundConfirmed: true,
  momentumConfirmed: false,
}, 'dip_and_rebound');

// Test 11 - Smart balanced survives when dip_and_rebound is not eligible.
assertSmartHandoffSurvives({
  symbol: 'BALSMARTUSDT',
  candidateId: 'scan-bal:BALSMARTUSDT',
  dipPercent: 0,
  reboundPercent: 0.7,
  reboundConfirmed: true,
  momentumConfirmed: false,
}, 'balanced');

// Test 12 - Momentum eligibility cannot become NO_VALID_AUTOBOTS_STRATEGY.
{
  const resolution = resolveAutoBotsFinalStrategy(
    legacyWaitSmartCandidate({
      symbol: 'MOMUSDT',
      candidateId: 'scan-mom:MOMUSDT',
      dipPercent: 0,
      reboundPercent: 1.0,
      reboundConfirmed: true,
      momentumConfirmed: true,
    }),
    { marketBestFit: 'wait' },
    { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' },
    runtime,
  );
  assert(['balanced', 'momentum'].includes(resolution.finalExecutionStrategy));
  assert.equal(resolution.perCoinSelectedStrategy, resolution.finalExecutionStrategy);
  assert.equal(resolution.fallbackApplied, false);
  assert.notEqual(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
}

// Test 13 - NO_VALID_AUTOBOTS_STRATEGY only when every Smart strategy is ineligible.
{
  const resolution = resolveAutoBotsFinalStrategy(
    legacyWaitSmartCandidate({
      symbol: 'NOVALIDUSDT',
      candidateId: 'scan-none:NOVALIDUSDT',
      dipPercent: 0,
      reboundPercent: 0,
      reboundConfirmed: false,
      momentumConfirmed: false,
      spreadOk: false,
      tpRoomOk: false,
      priceFresh: false,
      bookFresh: false,
    }),
    { marketBestFit: 'wait' },
    { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' },
    runtime,
  );
  assert.equal(resolution.finalExecutionStrategy, 'wait');
  assert.equal(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
  assert(resolution.evaluatedStrategies.every(s => s.eligible === false));
}

// Test 13b - legacy group fallback after Smart no-valid is diagnostics-only until EntryGate revalidates.
{
  const resolution = resolveAutoBotsFinalStrategy(
    legacyWaitSmartCandidate({
      symbol: 'GUARDFALLBACKUSDT',
      candidateId: 'scan-guard:GUARDFALLBACKUSDT',
      dipPercent: 0,
      reboundPercent: 0,
      reboundConfirmed: false,
      momentumConfirmed: false,
      spreadOk: false,
      tpRoomOk: false,
      priceFresh: false,
      bookFresh: false,
      groupRecommendedStrategy: 'balanced',
    }),
    { marketBestFit: 'wait' },
    { groupRecommendedStrategy: 'balanced', groupTrend: 'sideways' },
    runtime,
  );
  assert.equal(resolution.finalExecutionStrategy, 'balanced');
  assert.equal(resolution.fallbackApplied, true);
  assert.equal(resolution.fallbackCanSubmitBuy, false);
  assert.equal(resolution.fallbackSubmitGuardReason, 'ENTRY_GATE_REVALIDATION_REQUIRED_AFTER_NO_VALID_SMART_STRATEGY');
}

// Test 14 - WLFIUSDT fixture: eligible dip_and_rebound cannot become wait.
assertSmartHandoffSurvives({
  symbol: 'WLFIUSDT',
  candidateId: 'scan-wlfi:WLFIUSDT',
  dipPercent: -1.6,
  reboundPercent: 0.75,
  reboundConfirmed: true,
  momentumConfirmed: true,
}, 'dip_and_rebound');

// Test 15 - ICPUSDT fixture: all executable contracts eligible cannot become wait.
{
  const resolution = resolveAutoBotsFinalStrategy(
    legacyWaitSmartCandidate({
      symbol: 'ICPUSDT',
      candidateId: 'scan-icp:ICPUSDT',
      dipPercent: -2.4,
      reboundPercent: 1.2,
      reboundConfirmed: true,
      momentumConfirmed: true,
    }),
    { marketBestFit: 'wait' },
    { groupRecommendedStrategy: 'wait', groupTrend: 'sideways' },
    runtime,
  );
  assert.equal(resolution.finalExecutionStrategy, 'dip_and_rebound');
  assert.equal(resolution.perCoinSelectedStrategy, 'dip_and_rebound');
  assert.equal(resolution.fallbackApplied, false);
  assert.equal(resolution.fallbackReason, null);
  assert.notEqual(resolution.fallbackReason, 'NO_VALID_AUTOBOTS_STRATEGY');
  assert(resolution.evaluatedStrategies.every(s => s.eligible === true));
}

{
  const routerSrc = readFileSync(`${process.cwd()}/src/core/scanner/AutoStrategyRouter.ts`, 'utf8');
  assert(routerSrc.includes('AUTOBOTS_SMART_STRATEGY_EVALUATION_AUDIT'));
  assert(routerSrc.includes('SMART_STRATEGY_HANDOFF_AUDIT'));
  assert(routerSrc.includes('SMART_EXECUTABLE_STRATEGY_LOST_BEFORE_RESOLUTION'));
  assert(routerSrc.includes('WAIT_STRATEGY_NON_EXECUTABLE_AUDIT'));
  assert(routerSrc.includes('fallbackCanSubmitBuy'));
  assert(routerSrc.includes('ENTRY_GATE_REVALIDATION_REQUIRED_AFTER_NO_VALID_SMART_STRATEGY'));
  const builderSrc = readFileSync(`${process.cwd()}/src/core/strategy-audit/strategy-audit-builder.ts`, 'utf8');
  assert(builderSrc.includes('fallbackCanSubmitBuy=') && builderSrc.includes('fallbackSubmitGuardReason='));
  assert(builderSrc.includes('entry_gate_revalidated_professional_freshness_spread_tp_room'));
}

console.log('autobots smart strategy router tests passed');
