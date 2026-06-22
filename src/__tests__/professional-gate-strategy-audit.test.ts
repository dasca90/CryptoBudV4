import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { buildStrategyAuditSnapshotFromCandidate, resolveProfessionalGateDecision, validateBalancedEntryContract } from '../core/strategy-audit/strategy-audit-builder';
import type { ScannerCandidate, EntryGateOutput } from '../core/types';

const autoBotsRuntimeState = resolveAutoBotsRuntimeState({
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

function candidate(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  const now = new Date().toISOString();
  return {
    candidateId: 'scan_1:BALUSDT',
    symbol: 'BALUSDT',
    createdAt: now,
    updatedAt: now,
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    selectedPlaybook: null,
    effectiveStrategy: 'balanced',
    confidence: 0.91,
    status: 'BUY',
    entryGateDecision: {
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      explanation: 'ok',
      snapshot: { decision: 'ALLOW', primaryReason: null, blockReasons: [], requiredNextActions: [] } as any,
    } as EntryGateOutput,
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    price: 1.23,
    priceAgeMs: 100,
    priceFresh: true,
    spreadPct: 0.05,
    volumeRel: 1.5,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.96,
    reboundFreshnessStatus: 'valid',
    reboundTimestamp: now,
    dipLowTimestamp: now,
    reboundAgeMs: 1000,
    maxAllowedReboundAgeMs: 180000,
    m5Change: 0.5,
    m15Change: 0.3,
    h1Change: 0.2,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.82,
    bookFresh: true,
    groupRecommendedStrategy: 'balanced',
    marketAnalyzerBestFit: 'momentum',
    autoBotsRuntimeState,
    autoStrategyDecision: {
      symbol: 'BALUSDT',
      effectiveStrategy: 'balanced',
      strategySource: 'AutoBots',
      strategySourceDetail: 'per_coin_selector',
      strategyReason: 'test',
      groupRecommendedStrategy: 'balanced',
      groupTrend: 'bullish',
      referencePeriod: '1h',
      confidenceTier: 'A_80_PLUS',
      confidenceAdjustment: 0,
      blockedByGroupRegime: false,
      blockedBySafety: false,
      reason: 'test',
      warnings: [],
      marketAnalyzerBestFit: 'momentum',
      perCoinSelectedStrategy: 'balanced',
      fallbackUsed: false,
      fallbackReason: null,
    } as any,
    tradingTargetOwnership: {} as any,
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1.23, quantity: 10, reason: 'BUY_READY' }, ruleDecisionTrace: {} as any } as any,
    professionalAnalysis: {
      professionalScore: 92,
      professionalVerdict: 'WAIT',
      professionalReasons: ['advisory_wait'],
      professionalBlockers: [],
      riskLabel: 'medium',
      anchorSettingEnabled: false,
      anchorDecision: 'UNAVAILABLE',
      anchorBlockApplied: false,
    } as any,
    ...overrides,
  } as ScannerCandidate;
}

// Test 1 - Balanced visible requirements pass, professional advisory does not block.
{
  const snap = buildStrategyAuditSnapshotFromCandidate(candidate({ professionalGateMode: 'advisory' } as any));
  assert.equal(snap.strategyContractValid, true, 'Balanced strategy contract passes visible requirements');
  assert.equal(snap.professionalGateValid, true, 'Professional advisory gate is valid');
  assert.equal(snap.finalExecutable, true, 'Balanced + advisory professional gate remains executable');
  assert.notEqual(snap.finalBlocker, 'strategy_setup_not_met', 'No strategy_setup_not_met when visible Balanced requirements pass');
}

// Test 2 - Balanced-valid setup blocked by explicit Professional WAIT hard gate.
{
  const snap = buildStrategyAuditSnapshotFromCandidate(candidate({ professionalGateMode: 'hard_gate' } as any));
  assert.equal(snap.strategyContractValid, true, 'Hard professional gate does not invalidate strategy contract');
  assert.equal(snap.professionalGateValid, false, 'Professional WAIT hard gate is invalid');
  assert.equal(snap.professionalGateBlocker, 'PROFESSIONAL_VERDICT_WAIT');
  assert.equal(snap.finalExecutable, false);
  assert.equal(snap.finalBlocker, 'PROFESSIONAL_VERDICT_WAIT');
  assert.equal(snap.finalBlockerSource, 'professional_gate');
  assert.notEqual(snap.strategyContractBlocker, 'strategy_setup_not_met');
}

// Test 3 - ML advisory cannot block strategy audit.
{
  const snap = buildStrategyAuditSnapshotFromCandidate(candidate({
    mlBadEntryRisk: true,
    autoStrategyDecision: { ...(candidate().autoStrategyDecision as any), warnings: ['ML_BAD_ENTRY_RISK'] } as any,
    professionalGateMode: 'advisory',
  } as any));
  assert.equal(snap.finalExecutable, true, 'ML advisory warning does not change finalExecutable');
  assert.equal(snap.buyAllowed, true, 'ML advisory warning does not change buyAllowed');
  assert.equal(snap.warningReasons.includes('ML_BAD_ENTRY_RISK'), true, 'ML advisory remains visible as warning');
}

// Test 4 - strategy_setup_not_met only for real strategy failures.
{
  const contract = validateBalancedEntryContract({
    finalExecutionStrategy: 'balanced',
    reboundAtEntry: 0.2,
    requiredReboundPctAtEntry: 0.4,
    reboundConfirmed: false,
    freshnessStatus: 'valid',
    priceFresh: true,
    momentumConfirmed: true,
    tpRoomOk: true,
    spreadOk: true,
  });
  assert.equal(contract.contractValid, false);
  assert.equal(contract.primaryBlocker, 'rebound_not_confirmed');
}

// Test 5 - Executable Smart strategy beats stale group fallback while keeping dynamicPerCoinStrategy=true.
{
  const snap = buildStrategyAuditSnapshotFromCandidate(candidate({
    autoStrategyDecision: {
      ...(candidate().autoStrategyDecision as any),
      effectiveStrategy: 'wait',
      perCoinSelectedStrategy: null,
      strategySource: 'AutoBots_SafeFallback',
      strategySourceDetail: 'group_fallback',
      groupRecommendedStrategy: 'balanced',
      fallbackUsed: true,
      fallbackReason: 'router_missing_per_coin_strategy_used_group_recommendation',
    } as any,
    effectiveStrategy: 'wait',
    selectedStrategy: 'balanced',
    groupRecommendedStrategy: 'balanced',
  } as any));
  assert.equal(snap.strategySource, 'AUTOBOTS_DYNAMIC');
  assert.equal(snap.dynamicPerCoinStrategy, true);
  assert.equal(snap.finalExecutionStrategy, 'balanced');
}

// Test 6 - no hidden blocker when visible requirements pass.
{
  const snap = buildStrategyAuditSnapshotFromCandidate(candidate({ professionalGateMode: 'advisory' } as any));
  assert.equal(snap.strategyContractValid, true);
  assert.equal(snap.strategyContractBlocker, 'none');
  assert.equal(snap.finalBlocker, 'none');
}

{
  const builderSrc = readFileSync(`${process.cwd()}/src/core/strategy-audit/strategy-audit-builder.ts`, 'utf8');
  assert(builderSrc.includes('STRATEGY_AUDIT_CONSUMER_INTEGRITY_AUDIT'), 'strategy audit consumer integrity audit exists');
  assert(builderSrc.includes('STRATEGY_DECISION_CONSUMER_INTEGRITY_AUDIT'), 'canonical strategy decision consumer integrity audit exists');
  assert(builderSrc.includes('dynamicPerCoinStrategy=${String(resolution.dynamicPerCoinStrategy)}'), 'final strategy audit uses canonical dynamic flag');
  assert(!builderSrc.includes('dynamicPerCoinStrategy=${String(strategyRequested !== strategySelected)}'), 'final strategy audit no longer derives dynamic flag independently');
}

{
  const professionalAdvisory = resolveProfessionalGateDecision({ enabled: true, mode: 'advisory', score: 10, threshold: 80, verdict: 'AVOID' });
  assert.equal(professionalAdvisory.allowed, true, 'Professional advisory mode always allows');
  assert.equal(professionalAdvisory.blocker, 'none');
}

console.log('professional gate strategy audit tests passed');
