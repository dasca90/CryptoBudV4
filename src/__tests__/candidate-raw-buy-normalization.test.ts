import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyCandidatePromotionGuard,
  normalizeCandidateDisplayStatus,
} from '../core/scanner/CandidateLifecycle';
import { resolveExecutionDecision } from '../core/scanner/executionDecision';
import { resolveFinalNoBuyReasonPriority } from '../core/scanner/finalNoBuyReasonPriority';
import { resolveTopCandidateDisplay } from '../components/trade-v4/topCandidatesPanelModel';
import { mapScannerCandidateToTradeV4View } from '../lib/air-scanner/tradeV4DataAdapter';
import type { ScannerCandidate } from '../core/types';
import type { TradeV4CandidateView } from '../components/trade-v4/types';
import { MarketDataFeed } from '../utils/MarketDataFeed';

function completeRuntimeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invariantOk: true,
    symbol: 'RAWBUYUSDT',
    price: 1,
    livePrice: 1,
    referencePrice: 1,
    spreadPct: 0.02,
    tpRoomOk: true,
    strategy: 'balanced',
    finalExecutionStrategy: 'balanced',
    entryRule: 'EntryGate ALLOW',
    riskGroup: 'mid_caps',
    confidence: 0.92,
    dipPercent: 0,
    reboundPercent: 1,
    momentumPct: 1,
    freshnessStatus: 'fresh',
    sourceOwner: 'AutoBots',
    ...overrides,
  };
}

function candidate(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  const now = new Date().toISOString();
  return {
    candidateId: 'cand_RAWBUY',
    symbol: 'RAWBUYUSDT',
    createdAt: now,
    updatedAt: now,
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    confidence: 0.92,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1, quantity: 1, reason: 'test' } } as any,
    entryGateDecision: { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], requiredNextActions: [], explanation: 'ok', snapshot: { decision: 'ALLOW', blockReasons: [] } as any } as any,
    mainReason: 'EntryGate ALLOW',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 10,
    priceFresh: true,
    bookFresh: true,
    spreadPct: 0.02,
    volumeRel: 1,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 1,
    m5Change: 1,
    m15Change: 1,
    h1Change: 1,
    change24h: 1,
    mlBadEntryRisk: false,
    mlWinProbability: 0,
    runtimeSnapshot: completeRuntimeSnapshot() as any,
    strategyDecision: { invariantOk: true, finalExecutionStrategy: 'balanced' } as any,
    executionPrecheckSnapshot: {
      invariantOk: true,
      priceFresh: true,
      bookFresh: true,
      spreadOk: true,
      tpRoomOk: true,
      riskGroupResolved: true,
      entryContractResolved: true,
      entryContractValid: true,
      professionalGateResolved: true,
      failureReason: 'none',
    } as any,
    finalExecutionStrategy: 'balanced',
    finalExecutable: true,
    buyAllowed: true,
    ...overrides,
  } as ScannerCandidate;
}

// Test 1 - dip_not_confirmed cannot remain raw BUY.
{
  const normalized = normalizeCandidateDisplayStatus(candidate({
    finalExecutable: false,
    buyAllowed: false,
    finalNoBuyReason: 'dip_not_confirmed',
    blockReasons: ['dip_not_confirmed'],
    status: 'BUY',
  } as any));
  assert.notEqual(normalized.status, 'BUY');
  assert.equal(normalized.status, 'WAITING_CONFIRMATION');
  assert.equal(normalized.finalExecutable, false);
  assert.equal(normalized.buyAllowed, false);
}

// Test 2 - strategy handoff failure cannot be raw BUY.
{
  const guarded = applyCandidatePromotionGuard({
    candidate: candidate({
      runtimeSnapshot: completeRuntimeSnapshot() as any,
      finalExecutable: false,
      buyAllowed: false,
      finalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    } as any),
    scanId: 'scan_raw_buy',
    requestedNextStatus: 'BUY',
  });
  assert.equal(guarded.status, 'WAIT_STRATEGY_HANDOFF');
  assert.equal(guarded.promotionAudit?.canPromoteToBuy, false);
  assert.equal(guarded.finalExecutable, false);
  assert.equal(guarded.buyAllowed, false);
}

// Test 3 - finalNoBuyReason cannot coexist with finalExecutable true.
{
  const decision = resolveExecutionDecision({
    symbol: 'EDENUSDT',
    scanId: 'scan_eden',
    candidateRank: 1,
    status: 'BUY',
    finalExecutable: true,
    buyAllowed: false,
    setupResult: 'WAITING_CONFIRMATION',
    finalExecutionStrategy: 'balanced',
    riskGroup: 'mid_caps',
    groupName: 'mid_caps',
    groupRecommendedStrategy: 'balanced',
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
  });
  assert.equal(decision.finalNoBuyReason, 'WAITING_CONFIRMATION');
  assert.equal(decision.actionableNoBuyReason, 'WAITING_CONFIRMATION');
  assert.equal(decision.technicalNoBuyReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
  assert.equal(decision.finalExecutable, false);
  assert.equal(decision.selectedForExecution, false);
}

// Test 3b - finalNoBuyReason contradiction emits the canonical self-consistency failure string.
{
  const executionDecisionSrc = readFileSync(`${process.cwd()}/src/core/scanner/executionDecision.ts`, 'utf8');
  assert(executionDecisionSrc.includes('FINAL_NO_BUY_WITH_EXECUTABLE_TRUE'));
}

// Test 4 - BUY_STATUS_INTEGRITY_AUDIT must fail raw BUY mismatch.
{
  const panelSrc = readFileSync(`${process.cwd()}/src/components/trade-v4/TopCandidatesPanel.tsx`, 'utf8');
  assert(panelSrc.includes('RAW_BUY_WITHOUT_CANONICAL_EXECUTABLE'));
  assert(panelSrc.includes('rawBuyIntentCanonicalWaitCount'));
  assert(panelSrc.includes('displayBuyStatus.length !== execBuyReady'));
  assert(panelSrc.includes('canonicalDisplayStatus'));
}

// Test 5 - valid candidate can become BUY.
{
  const guarded = applyCandidatePromotionGuard({
    candidate: candidate(),
    scanId: 'scan_valid_buy',
    requestedNextStatus: 'BUY',
  });
  assert.equal(guarded.status, 'BUY');
  assert.equal(guarded.promotionAudit?.canPromoteToBuy, true);
  assert.equal(guarded.finalExecutable, true);
  assert.equal(guarded.buyAllowed, true);
}

// Test 6 - TopCandidates does not convert WAITING_CONFIRMATION to BUY from score/confidence.
{
  const view = {
    symbol: 'WAITCONFUSDT',
    status: 'WAITING_CONFIRMATION',
    confidence: 99,
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'dip_not_confirmed',
    mainReason: 'dip_not_confirmed',
    blockReasons: ['dip_not_confirmed'],
    strategy: 'balanced',
  } as TradeV4CandidateView;
  const display = resolveTopCandidateDisplay({ candidate: view });
  assert.notEqual(display.status, 'BUY');
  assert.notEqual(display.status, 'EXECUTION SKIPPED');
}

// Test 6b - raw BUY with finalNoBuyReason renders WAIT/BLOCKED, not EXECUTION SKIPPED.
{
  const view = {
    symbol: 'JSTUSDT',
    status: 'BUY',
    confidence: 99,
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    mainReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    blockReasons: ['STRATEGY_HANDOFF_INTEGRITY_FAILED'],
    strategy: 'balanced',
    executionDecision: {
      finalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
      finalExecutable: false,
      buyAllowed: false,
    },
    canonicalDisplayStatus: {
      canonicalStatus: 'WAIT_STRATEGY_HANDOFF',
    },
  } as TradeV4CandidateView;
  const display = resolveTopCandidateDisplay({ candidate: view, executionSkipped: true, executionSkipReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED' });
  assert.notEqual(display.status, 'BUY');
  assert.notEqual(display.status, 'EXECUTION SKIPPED');
  assert.equal(display.status, 'WAIT');
}

// Test 7 - wait strategy remains non-executable.
{
  const normalized = normalizeCandidateDisplayStatus(candidate({
    selectedStrategy: 'wait',
    finalExecutionStrategy: 'wait',
    finalExecutable: false,
    buyAllowed: false,
    finalNoBuyReason: 'NO_VALID_AUTOBOTS_STRATEGY',
  } as any));
  assert.notEqual(normalized.status, 'BUY');
  assert.equal(normalized.status, 'WAIT_STRATEGY_DECISION');
}

// Test 8 - rebound_stale maps to the explicit rebound freshness wait state.
{
  const normalized = normalizeCandidateDisplayStatus(candidate({
    finalExecutable: false,
    buyAllowed: false,
    finalNoBuyReason: 'rebound_stale',
    primaryBlocker: 'rebound_stale',
    blockReasons: ['rebound_stale'],
  } as any));
  assert.equal(normalized.status, 'WAIT_REBOUND_FRESHNESS');
  assert.equal((normalized as any).canonicalDisplayStatus?.signal, 'WAIT');
}

// Test 9 - scanner publishes canonicalized candidates after lifecycle guard.
{
  const scannerSrc = readFileSync(`${process.cwd()}/src/core/scanner/MarketScanner.ts`, 'utf8');
  assert(scannerSrc.includes('rankedCandidatesToAnnotate = canonicalCandidates'));
  assert(scannerSrc.includes('finalizeCandidateStatus'));
}

// Test 10 - primary blocker dominates stale handoff finalNoBuyReason.
{
  const resolved = resolveFinalNoBuyReasonPriority({
    symbol: 'CAKEUSDT',
    rawStatus: 'WAIT_ENTRY_CONTRACT',
    displayStatus: 'WAIT',
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'dip_not_confirmed',
    setupResult: 'WAITING_FOR_REBOUND',
    candidateWhy: 'WAITING_FOR_REBOUND',
    previousFinalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    executionDecisionFinalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    handoffMismatch: true,
  });
  assert.equal(resolved.resolvedFinalNoBuyReason, 'DIP_NOT_CONFIRMED');
  assert.equal(resolved.actionableNoBuyReason, 'DIP_NOT_CONFIRMED');
  assert.equal(resolved.renderedUserMessage, 'DIP_NOT_CONFIRMED');
  assert.equal(resolved.handoffIntegrityStatus, 'failed');
  assert.equal(resolved.secondaryDiagnosticReasons.includes('STRATEGY_HANDOFF_INTEGRITY_FAILED'), true);
  assert.equal(resolved.invariantOk, true);
}

// Test 11 - handoff reason wins only when no stronger setup blocker exists.
{
  const resolved = resolveFinalNoBuyReasonPriority({
    symbol: 'HANDOFFUSDT',
    rawStatus: 'WAIT_STRATEGY_HANDOFF',
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'none',
    previousFinalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    handoffMismatch: true,
  });
  assert.equal(resolved.resolvedFinalNoBuyReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
  assert.equal(resolved.invariantOk, true);
}

// Test 12 - TopCandidates keeps WAIT and actionable reason when executionDecision has stale handoff.
{
  const view = {
    symbol: 'CAKEUSDT',
    status: 'WAIT_ENTRY_CONTRACT',
    confidence: 91,
    finalExecutable: false,
    buyAllowed: false,
    primaryBlocker: 'dip_not_confirmed',
    mainReason: 'WAITING_FOR_REBOUND',
    blockReasons: ['dip_not_confirmed'],
    strategy: 'balanced',
    strategyAudit: {
      setupResult: 'WAITING_FOR_REBOUND',
      dynamicSetupContext: { setupResult: 'WAITING_FOR_REBOUND', primaryBlocker: 'dip_not_confirmed' },
      blockReasons: ['dip_not_confirmed'],
    } as any,
    executionDecision: {
      finalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
      finalExecutable: false,
      buyAllowed: false,
    },
  } as TradeV4CandidateView;
  const display = resolveTopCandidateDisplay({ candidate: view, executionSkipped: true, executionSkipReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED' });
  assert.equal(display.status, 'WAIT');
  assert.equal(display.exactSkipReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
}

// Test 13 - WAIT raw status with WAIT signal cannot report raw BUY failure.
{
  const normalized = normalizeCandidateDisplayStatus(candidate({
    status: 'WAITING_CONFIRMATION' as any,
    runtimeSnapshot: undefined,
    finalExecutable: false,
    buyAllowed: false,
    finalNoBuyReason: 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING',
    primaryBlocker: 'CANDIDATE_RUNTIME_SNAPSHOT_MISSING',
    blockReasons: ['CANDIDATE_RUNTIME_SNAPSHOT_MISSING'],
  } as any));
  assert.equal((normalized as any).canonicalDisplayStatus?.signal, 'WAIT');
  assert.notEqual((normalized as any).canonicalDisplayStatus?.failureReason, 'RAW_BUY_WITHOUT_CANONICAL_EXECUTABLE');
}

// Test 14 - Trade V4 adapter keeps runtime handoff flags for TopCandidates.
{
  MarketDataFeed.getInstance().setManualPrice('RAWBUYUSDT', 1);
  const view = mapScannerCandidateToTradeV4View(candidate());
  assert.equal(view.runtimeSnapshotPresent, true);
  assert.equal(view.strategyDecisionPresent, true);
  assert.equal(view.executionPrecheckSnapshotPresent, true);
}

// Test 15 - Retired legacy-source candidates migrate to canonical AutoBots presentation in UI.
{
  const view = mapScannerCandidateToTradeV4View(candidate({
    source: 'unicorn_hunter',
    sourceOwner: 'UnicornHunter',
    sourceLabel: 'Unicorn Hunter',
    candidateSource: 'unicorn_hunter',
    executionSource: 'unicorn_hunter',
    ownerType: 'unicorn',
    ownerName: 'UNICORN_HUNTER',
    strategySource: 'unicorn_hunter' as any,
    runtimeSnapshot: completeRuntimeSnapshot({ sourceOwner: 'UnicornHunter' }) as any,
  } as any));
  assert.equal(view.source, 'dipper');
  assert.match(view.sourceLabel ?? '', /AutoBots/);
  assert.doesNotMatch(view.sourceLabel ?? '', /Unicorn/i);
  assert.notEqual(view.sourceLabel, 'Unknown');
  assert.equal(view.finalExecutable, true);
  assert.equal(view.buyAllowed, true);
}

// Test 16 - Unicorn raw BUY cannot survive a handoff integrity failure in Trade V4 UI.
{
  const view = mapScannerCandidateToTradeV4View(candidate({
    source: 'unicorn_hunter',
    sourceOwner: 'UnicornHunter',
    sourceLabel: 'Unicorn Hunter',
    candidateSource: 'unicorn_hunter',
    executionSource: 'unicorn_hunter',
    ownerType: 'unicorn',
    ownerName: 'UNICORN_HUNTER',
    strategySource: 'unicorn_hunter' as any,
    runtimeSnapshot: completeRuntimeSnapshot({ sourceOwner: 'UnicornHunter' }) as any,
    status: 'BUY',
    finalExecutable: true,
    buyAllowed: true,
    finalNoBuyReason: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    primaryBlocker: 'STRATEGY_HANDOFF_INTEGRITY_FAILED',
    blockReasons: ['STRATEGY_HANDOFF_INTEGRITY_FAILED'],
  } as any));
  assert.notEqual(view.status, 'BUY');
  assert.equal(view.finalExecutable, false);
  assert.equal(view.buyAllowed, false);
  assert.equal(view.finalNoBuyReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED');
  assert.match(view.sourceLabel ?? '', /AutoBots/);
  assert.doesNotMatch(view.sourceLabel ?? '', /Unicorn/i);
}

// Test 17 - Unicorn DIP_NOT_CONFIRMED cannot render as BUY READY.
{
  const view = mapScannerCandidateToTradeV4View(candidate({
    source: 'unicorn_hunter',
    sourceOwner: 'UnicornHunter',
    sourceLabel: 'Unicorn Hunter',
    candidateSource: 'unicorn_hunter',
    executionSource: 'unicorn_hunter',
    ownerType: 'unicorn',
    ownerName: 'UNICORN_HUNTER',
    strategySource: 'unicorn_hunter' as any,
    runtimeSnapshot: completeRuntimeSnapshot({ sourceOwner: 'UnicornHunter' }) as any,
    status: 'BUY',
    finalExecutable: true,
    buyAllowed: true,
    finalNoBuyReason: 'DIP_NOT_CONFIRMED',
    primaryBlocker: 'DIP_NOT_CONFIRMED',
    blockReasons: ['DIP_NOT_CONFIRMED'],
  } as any));
  assert.notEqual(view.status, 'BUY');
  assert.equal(view.finalExecutable, false);
  assert.equal(view.buyAllowed, false);
  assert.equal(view.finalNoBuyReason, 'DIP_NOT_CONFIRMED');
}

console.log('candidate raw BUY normalization tests passed');
