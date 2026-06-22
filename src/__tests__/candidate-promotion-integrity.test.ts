import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { resolveAutoBotsFinalStrategy } from '../core/scanner/AutoStrategyRouter';
import {
  applyCandidatePromotionGuard,
  assertCandidateRuntimeReady,
  attachCandidateRuntimeSnapshot,
  buildCandidateExecutionPrecheckSnapshot,
  buildCandidateRuntimeSnapshot,
  buildCandidateStrategyDecisionSnapshot,
  revalidateCandidateForExecution,
} from '../core/scanner/CandidateLifecycle';
import { buildStrategyAuditSnapshotFromCandidate } from '../core/strategy-audit/strategy-audit-builder';
import { logger } from '../utils/logger';
import type { ScannerCandidate } from '../core/types';

const runtime = resolveAutoBotsRuntimeState({
  executionMode: 'paper_simulated',
  buildMode: 'production',
  tauriDetected: true,
  uiAutoBotsOn: true,
  strategySource: 'autobots',
  persistedAutoBotsOn: false,
  manualOverrideRequested: true,
  scannerAutoEnabled: true,
  paperAutoExecutionEnabled: true,
  marketScannerPaperAutoEnabled: true,
  paperAutoBuyFnPresent: true,
});
const runtimeSnapshot = buildCandidateRuntimeSnapshot({ scanId: 'scan_promotion', runtimeState: runtime });

function base(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  const now = new Date().toISOString();
  return {
    candidateId: 'cand_PROMOUSDT',
    symbol: 'PROMOUSDT',
    createdAt: now,
    updatedAt: now,
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    confidence: 0.9,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 'test' }, ruleDecisionTrace: {} as any } as any,
    entryGateDecision: { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], requiredNextActions: [], explanation: 'ok', snapshot: { decision: 'ALLOW', blockReasons: [] } as any } as any,
    mainReason: 'EntryGate ALLOW',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 100,
    priceFresh: true,
    bookFresh: true,
    spreadPct: 0.05,
    volumeRel: 1,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.9,
    reboundFreshnessStatus: 'valid',
    m5Change: 0.4,
    m15Change: 0.3,
    h1Change: 0.2,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    runtimeSnapshot,
    autoBotsRuntimeState: runtime,
    professionalGateMode: 'advisory',
    professionalAnalysis: { professionalScore: 50, professionalVerdict: 'WAIT', professionalReasons: [], professionalBlockers: [] } as any,
    ...overrides,
  } as ScannerCandidate;
}

function withDecision(candidate: ScannerCandidate, overrides: Record<string, unknown> = {}): ScannerCandidate {
  const resolution = resolveAutoBotsFinalStrategy({
    ...candidate,
    autoStrategyDecision: candidate.autoStrategyDecision,
    groupRecommendedStrategy: (overrides.groupRecommendedStrategy as string | undefined) ?? candidate.groupRecommendedStrategy ?? 'balanced',
    marketAnalyzerBestFit: (overrides.marketBestFit as string | undefined) ?? candidate.marketAnalyzerBestFit ?? 'balanced',
  } as any, {
    marketBestFit: (overrides.marketBestFit as any) ?? candidate.marketAnalyzerBestFit ?? 'balanced',
  }, {
    groupRecommendedStrategy: (overrides.groupRecommendedStrategy as any) ?? candidate.groupRecommendedStrategy ?? 'balanced',
    groupTrend: 'sideways',
  }, {
    autoBotsOn: runtime.resolvedAutoBotsEnabled,
    dynamicPerCoinStrategy: runtime.dynamicPerCoinStrategy,
    userSelectedRuntimeStrategy: 'balanced',
    manualOverrideActive: false,
  });
  return {
    ...candidate,
    strategyDecision: buildCandidateStrategyDecisionSnapshot({ scanId: 'scan_promotion', candidate, resolution }),
    finalExecutionStrategy: resolution.finalExecutionStrategy,
    effectiveStrategy: resolution.finalExecutionStrategy,
    selectedStrategy: resolution.finalExecutionStrategy,
    groupRecommendedStrategy: resolution.groupRecommendedStrategy ?? undefined,
    marketAnalyzerBestFit: resolution.marketBestFit,
    perCoinSelectedStrategy: resolution.perCoinSelectedStrategy,
  } as ScannerCandidate;
}

function withPrecheck(candidate: ScannerCandidate, overrides: Partial<Parameters<typeof buildCandidateExecutionPrecheckSnapshot>[0]> = {}): ScannerCandidate {
  return {
    ...candidate,
    executionPrecheckSnapshot: buildCandidateExecutionPrecheckSnapshot({
      candidate,
      priceFresh: candidate.priceFresh !== false,
      bookFresh: candidate.bookFresh !== false,
      spreadOk: candidate.spreadPct < 0.5,
      tpRoomOk: candidate.tpRoomOk !== false,
      riskGroupResolved: Boolean(candidate.riskGroup),
      professionalGateResolved: true,
      entryContractResolved: true,
      entryContractValid: true,
      ...overrides,
    }),
  };
}

// Test 1/2 - AutoBots ON with missing autoStrategyDecision or unknown source does not resolve DISABLED.
{
  const c = base({ autoStrategyDecision: undefined, strategySource: 'unknown' as any });
  const snap = buildStrategyAuditSnapshotFromCandidate(c);
  assert.notEqual(snap.strategySource, 'DISABLED', 'builder must not infer AutoBots OFF from missing autoStrategyDecision');
  assert.notEqual(snap.routerPath, 'runtime_strategy', 'builder must not fall back to runtime dropdown when runtime AutoBots is ON');
  assert.equal(snap.finalExecutable, false, 'missing strategy decision cannot be executable');
  assert.equal(snap.finalBlocker, 'STRATEGY_DECISION_MISSING');
  assert.equal(c.runtimeSnapshot?.autoBotsResolvedOn, true, 'runtime snapshot still shows AutoBots ON');
}

// Test 3 - executable Smart handoff remains AutoBots and dynamic.
{
  const c = base({
    autoStrategyDecision: { effectiveStrategy: 'wait', strategySource: 'AutoBots_SafeFallback', groupRecommendedStrategy: 'balanced', groupTrend: 'sideways', perCoinSelectedStrategy: null, marketAnalyzerBestFit: 'momentum' } as any,
    groupRecommendedStrategy: 'balanced',
    marketAnalyzerBestFit: 'momentum',
  });
  const resolution = resolveAutoBotsFinalStrategy(c as any, { marketBestFit: 'momentum' }, { groupRecommendedStrategy: 'balanced', groupTrend: 'sideways' }, {
    autoBotsOn: true,
    dynamicPerCoinStrategy: true,
    userSelectedRuntimeStrategy: 'balanced',
    manualOverrideActive: false,
  });
  assert.equal(resolution.dynamicPerCoinStrategy, true);
  assert.equal(resolution.strategySourceResolved, 'AUTOBOTS_DYNAMIC');
  assert.equal(resolution.finalExecutionStrategy, 'balanced');
}

// Test 4 - stale candidate cannot remain BUY.
{
  const c = withPrecheck(withDecision(base({ priceFresh: false })), { priceFresh: false });
  const guarded = applyCandidatePromotionGuard({ candidate: c, scanId: 'scan_promotion', requestedNextStatus: 'BUY' });
  assert.equal(guarded.status, 'WAIT_PRICE_FRESHNESS');
  assert.equal(guarded.lifecycleStatus, 'WAIT_PRICE_FRESHNESS');
  assert.equal(guarded.finalExecutable, false);
  assert.equal(guarded.promotionAudit?.canPromoteToBuy, false);
}

// Test 5 - missing risk group cannot remain BUY.
{
  const c = withPrecheck(withDecision(base({ riskGroup: undefined })), { riskGroupResolved: false });
  const guarded = applyCandidatePromotionGuard({ candidate: c, scanId: 'scan_promotion', requestedNextStatus: 'BUY' });
  assert.equal(guarded.status, 'WAIT_RISK_GROUP');
  assert.equal(guarded.lifecycleStatus, 'WAIT_RISK_GROUP');
  assert.equal(guarded.finalNoBuyReason, 'MISSING_RISK_GROUP');
}

// Test 6 - missing runtime snapshot cannot reach BUY.
{
  const c = withPrecheck(withDecision(base({
    runtimeSnapshot: undefined,
    autoBotsRuntimeState: undefined,
    blockReasons: ['BLOCK_MOMENTUM_NOT_CONFIRMED', 'ENTRY_CONTRACT_INVALID'],
    entryGateDecision: {
      decision: 'BLOCK',
      primaryReason: 'ENTRY_CONTRACT_INVALID',
      blockReasons: ['ENTRY_CONTRACT_INVALID'],
      warnings: [],
      requiredNextActions: [],
      explanation: 'blocked',
      snapshot: { decision: 'BLOCK', blockReasons: ['ENTRY_CONTRACT_INVALID'] } as any,
    } as any,
  })));
  const guarded = applyCandidatePromotionGuard({ candidate: c, scanId: 'scan_promotion', requestedNextStatus: 'BUY' });
  assert.equal(guarded.status, 'WAIT_RUNTIME_STATE');
  assert.equal(guarded.lifecycleStatus, 'WAIT_RUNTIME_STATE');
  assert.equal(guarded.finalNoBuyReason, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
  assert.equal(guarded.primaryBlocker, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
  assert.equal(guarded.finalExecutable, false);
  assert.equal(guarded.buyAllowed, false);
  assert.deepEqual(guarded.blockReasons, ['CANDIDATE_RUNTIME_SNAPSHOT_MISSING']);
  assert(guarded.suppressedSecondaryBlockers?.includes('ENTRY_CONTRACT_INVALID'), 'secondary EntryGate blocker is preserved but not primary');
  assert(guarded.suppressedSecondaryBlockers?.includes('BLOCK_MOMENTUM_NOT_CONFIRMED'), 'secondary momentum blocker is preserved but not primary');
}

// Test 6b - runtime guard stops missing runtime before EntryGate/final executable evaluation.
{
  const logs: string[] = [];
  const unsubscribe = logger.subscribe((entry) => logs.push(entry.message));
  try {
    const c = base({
      runtimeSnapshot: undefined,
      autoBotsRuntimeState: undefined,
      blockReasons: ['BLOCK_BREAKOUT_NOT_CONFIRMED', 'ENTRY_CONTRACT_INVALID'],
      entryGateDecision: {
        decision: 'BLOCK',
        primaryReason: 'ENTRY_CONTRACT_INVALID',
        blockReasons: ['ENTRY_CONTRACT_INVALID'],
        warnings: [],
        requiredNextActions: [],
        explanation: 'blocked',
        snapshot: { decision: 'BLOCK', blockReasons: ['ENTRY_CONTRACT_INVALID'] } as any,
      } as any,
      finalExecutable: true,
      buyAllowed: true,
    });
    const result = assertCandidateRuntimeReady({
      candidate: c,
      scanId: 'scan_promotion',
      sourcePath: 'test_runtime_guard',
      blockedBeforeEntryGate: true,
    });
    assert.equal(result.ready, false);
    if (!result.ready) {
      assert.equal(result.candidate.status, 'WAIT_RUNTIME_STATE');
      assert.equal(result.candidate.entryGateDecision, null);
      assert.equal(result.candidate.finalNoBuyReason, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
      assert.equal(result.candidate.primaryBlocker, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
      assert.equal(result.candidate.finalExecutable, false);
      assert.equal(result.candidate.buyAllowed, false);
      assert.deepEqual(result.candidate.blockReasons, ['CANDIDATE_RUNTIME_SNAPSHOT_MISSING']);
      assert(result.candidate.suppressedSecondaryBlockers?.includes('ENTRY_CONTRACT_INVALID'));
      assert.equal(result.audit.sourcePath, 'test_runtime_guard');
      assert.equal(result.audit.blockedBeforeEntryGate, true);
    }
    assert(logs.some((line) => line.includes('CANDIDATE_RUNTIME_SNAPSHOT_GUARD_AUDIT') && line.includes('sourcePath=test_runtime_guard')));
  } finally {
    unsubscribe();
  }
}

// Test 6c - valid runtime attached at birth passes runtime guard.
{
  const candidate = attachCandidateRuntimeSnapshot({
    candidate: base({
      runtimeSnapshot: undefined,
      autoBotsRuntimeState: undefined,
      status: 'WAIT_RUNTIME_STATE' as any,
      blockReasons: ['CANDIDATE_RUNTIME_SNAPSHOT_MISSING', 'ENTRY_CONTRACT_INVALID'],
      finalNoBuyReason: 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING',
      primaryBlocker: 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING',
    }),
    scanId: 'scan_promotion',
    runtimeState: runtime,
    sourcePath: 'test_candidate_birth',
  });
  const result = assertCandidateRuntimeReady({
    candidate,
    scanId: 'scan_promotion',
    sourcePath: 'test_candidate_birth',
  });
  assert.equal(result.ready, true);
  assert.equal(result.candidate.runtimeSnapshot?.invariantOk, true);
  assert.equal(result.candidate.candidateBirthSource, 'test_candidate_birth');
  assert(!result.candidate.blockReasons.includes('CANDIDATE_RUNTIME_SNAPSHOT_MISSING'));
  assert(result.candidate.blockReasons.includes('ENTRY_CONTRACT_INVALID'));
  assert.notEqual(result.candidate.finalNoBuyReason, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
}

// Test 7 - BUY_READY requires all snapshots valid.
{
  const c = withPrecheck(withDecision(base({
    autoStrategyDecision: { effectiveStrategy: 'balanced', strategySource: 'AutoBots', groupRecommendedStrategy: 'balanced', groupTrend: 'sideways', perCoinSelectedStrategy: 'balanced', marketAnalyzerBestFit: 'balanced' } as any,
    finalExecutable: true,
    buyAllowed: true,
  })));
  const guarded = applyCandidatePromotionGuard({ candidate: c, scanId: 'scan_promotion', requestedNextStatus: 'BUY' });
  assert.equal(guarded.status, 'BUY');
  assert.equal(guarded.lifecycleStatus, 'BUY_READY');
  assert.equal(guarded.promotionAudit?.canPromoteToBuy, true);
}

// Test 8 - revalidation demotes stale candidate before execution.
{
  const c = withPrecheck(withDecision(base({ priceFresh: false })), { priceFresh: false });
  const revalidated = revalidateCandidateForExecution(c);
  assert.equal(revalidated.status, 'WAIT_PRICE_FRESHNESS');
  assert.equal(revalidated.lifecycleStatus, 'WAIT_PRICE_FRESHNESS');
  assert.notEqual(revalidated.finalNoBuyReason, 'UNKNOWN_EXECUTION_SELECTION_BUG');
}

// Test 9 - Smart Router and AutoBots resolution preserve runtime snapshots.
{
  const smartCandidate = base({
    symbol: 'WLFIUSDT',
    selectedStrategy: 'dip_and_rebound',
    dipPercent: 1.2,
    reboundPercent: 0.9,
    autoStrategyDecision: {
      effectiveStrategy: 'dip_and_rebound',
      strategySource: 'AutoBots',
      groupRecommendedStrategy: 'balanced',
      groupTrend: 'sideways',
      perCoinSelectedStrategy: 'dip_and_rebound',
      marketAnalyzerBestFit: 'dip_and_rebound',
      strategyReason: 'dip_and_rebound_contract_satisfied',
    } as any,
    groupRecommendedStrategy: 'balanced',
    marketAnalyzerBestFit: 'dip_and_rebound',
  });
  const resolved = withDecision(smartCandidate, { marketBestFit: 'dip_and_rebound', groupRecommendedStrategy: 'balanced' });
  assert.equal(resolved.runtimeSnapshot?.invariantOk, true);
  assert.equal(resolved.autoBotsRuntimeState?.resolvedAutoBotsEnabled, true);
  assert.equal(resolved.strategyDecision?.invariantOk, true);
  assert.equal(resolved.finalExecutionStrategy, 'dip_and_rebound');
}

// Test 10 - WLFIUSDT/ICPUSDT fixture-like candidates do not reach lifecycle missing runtime.
{
  for (const fixture of [
    { symbol: 'WLFIUSDT', strategy: 'dip_and_rebound' },
    { symbol: 'ICPUSDT', strategy: 'balanced' },
  ] as const) {
    const c = withPrecheck(withDecision(base({
      symbol: fixture.symbol,
      selectedStrategy: fixture.strategy,
      finalExecutionStrategy: fixture.strategy,
      dipPercent: fixture.strategy === 'dip_and_rebound' ? 1.2 : 0,
      reboundPercent: fixture.strategy === 'dip_and_rebound' ? 0.9 : 0.9,
      autoStrategyDecision: {
        effectiveStrategy: fixture.strategy,
        strategySource: 'AutoBots',
        groupRecommendedStrategy: 'balanced',
        groupTrend: 'sideways',
        perCoinSelectedStrategy: fixture.strategy,
        marketAnalyzerBestFit: fixture.strategy,
        strategyReason: `${fixture.strategy}_contract_satisfied`,
      } as any,
      groupRecommendedStrategy: 'balanced',
      marketAnalyzerBestFit: fixture.strategy,
    }), { marketBestFit: fixture.strategy, groupRecommendedStrategy: 'balanced' }));
    const guarded = applyCandidatePromotionGuard({ candidate: c, scanId: 'scan_promotion', requestedNextStatus: 'BUY' });
    assert.equal(guarded.promotionAudit?.runtimeSnapshotPresent, true, `${fixture.symbol} runtime snapshot present`);
    assert.equal(guarded.promotionAudit?.strategyDecisionPresent, true, `${fixture.symbol} strategy decision present`);
    assert.equal(guarded.promotionAudit?.executionPrecheckSnapshotPresent, true, `${fixture.symbol} precheck snapshot present`);
    assert.notEqual(guarded.finalNoBuyReason, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
    assert.notEqual(guarded.primaryBlocker, 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING');
  }
}

// Test 9/10 - source checks and parity audit hooks exist in code.
{
  const builderSrc = readFileSync(`${process.cwd()}/src/core/strategy-audit/strategy-audit-builder.ts`, 'utf8');
  const scannerSrc = readFileSync(`${process.cwd()}/src/core/scanner/MarketScanner.ts`, 'utf8');
  const plannerSrc = readFileSync(`${process.cwd()}/src/core/scanner/ExecutionPlanner.ts`, 'utf8');
  assert(!builderSrc.includes("|| !!auto"), 'builder no longer infers AutoBots ON/OFF from !!auto');
  assert(scannerSrc.includes('CANDIDATE_PROMOTION_INTEGRITY_AUDIT'), 'scanner emits candidate promotion integrity audit');
  assert(scannerSrc.includes('CANDIDATE_RUNTIME_HANDOFF_AUDIT'), 'scanner emits runtime handoff audit');
  assert(scannerSrc.includes('scanner_before_smart_router'), 'scanner hydrates before Smart Router');
  assert(scannerSrc.includes('scanner_before_candidate_lifecycle'), 'scanner audits before CandidateLifecycle');
  assert(scannerSrc.includes('beforeSmartRouterRuntimeSnapshotPresent'), 'runtime handoff audit includes before Smart Router field');
  assert(scannerSrc.includes('strategyDecisionPresent'), 'runtime handoff audit includes strategyDecisionPresent');
  assert(scannerSrc.includes('executionPrecheckSnapshotPresent'), 'runtime handoff audit includes executionPrecheckSnapshotPresent');
  assert(plannerSrc.includes('revalidateCandidateForExecution'), 'execution planner revalidates before selection');
}

console.log('candidate promotion integrity tests passed');
