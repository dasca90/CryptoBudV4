import { readFileSync } from 'node:fs';
import { buildExecutableCandidateSet } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
};

function gateAllow(): EntryGateOutput {
  return {
    decision: 'ALLOW',
    primaryReason: null,
    blockReasons: [],
    warnings: [],
    explanation: 'ok',
    requiredNextActions: [],
    snapshot: {
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      requiredNextActions: [],
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.91, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null },
      priceFreshnessResult: { status: 'PASS', reason: null },
      tpRoomResult: { status: 'PASS', reason: null },
      marketSafetyResult: { status: 'PASS', reason: null },
      exposureCapitalResult: { status: 'PASS', reason: null },
      duplicateSymbolResult: { status: 'PASS', reason: null },
      timestamp: new Date().toISOString(),
      source: 'entry_gate_canonical',
    },
  } as any;
}

function buyReadyCandidate(overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  const now = new Date().toISOString();
  return {
    candidateId: 'candidate_OPGUSDT',
    symbol: 'OPGUSDT',
    createdAt: now,
    updatedAt: now,
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'conservative',
    effectiveStrategy: 'conservative',
    confidence: 0.91,
    status: 'BUY',
    entryGateDecision: gateAllow(),
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1.23,
    priceAgeMs: 100,
    priceFresh: true,
    spreadPct: 0.05,
    volumeRel: 1.5,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -2.5,
    reboundPercent: 1.2,
    reboundFreshnessStatus: 'valid',
    reboundTimestamp: now,
    dipLowTimestamp: new Date(Date.now() - 20_000).toISOString(),
    reboundAgeMs: 10_000,
    maxAllowedReboundAgeMs: 180_000,
    m5Change: 0.4,
    m15Change: 0.2,
    h1Change: 0.1,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.82,
    bookFresh: true,
    autoStrategyDecision: {
      strategySource: 'autobots',
      effectiveStrategy: 'conservative',
      groupTrend: 'neutral',
      groupRecommendedStrategy: 'conservative',
      reason: 'test',
      warnings: [],
      confidenceTier: 'high',
    } as any,
    tradingTargetOwnership: {
      tp1Value: 1.2,
      tp2Value: 0,
      slValue: 1.5,
      dynamicTrailingEnabled: false,
      trailingStartsAt: 'TP1',
      trailPullbackValue: 0.25,
      tp1Source: 'AutoBots dynamic per coin',
    } as any,
    traderBrainDecision: {
      entryPlan: { side: 'BUY', price: 1.23, quantity: 10, reason: 'BUY_READY' },
      ruleDecisionTrace: { unifiedSignal: { reasonCode: 'CONSERVATIVE_OK', definition: { buyRule: 'conservative' } } },
    } as any,
    ...overrides,
  } as any;
}

function snapshot(candidate: ScannerCandidate): ScannerSnapshot {
  return {
    scanId: 'scan_opg',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'TOP_50',
    universeSize: 1,
    scannedCount: 1,
    candidateCount: 1,
    buyCount: 1,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates: [candidate],
    summary: 'test',
    diagnostics: {} as any,
  };
}

const baseRisk = {
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 1000,
  usedCapital: 0,
  capitalPerTrade: 100,
  maxPositions: 10,
  maxSpreadPct: 0.35,
};

const ready = buildExecutableCandidateSet({
  scanSnapshot: snapshot(buyReadyCandidate()),
  runtimeState: { canAttemptScannerAutoExecution: true },
  riskState: baseRisk,
});
ok(ready.uiBuyReadySymbols.includes('OPGUSDT'), 'BUY_READY candidate is counted from the canonical scanner snapshot');
ok(ready.executableCandidates.map((c) => c.symbol).includes('OPGUSDT'), 'BUY_READY candidate is executable when runtime/risk gates pass');
ok(ready.selectedCandidateForExecution === 'OPGUSDT', 'canonical set selects the BUY_READY candidate for execution');
ok(ready.noExecutionReason === 'none', 'canonical set does not invent a no-execution reason for executable BUY_READY');

const disabled = buildExecutableCandidateSet({
  scanSnapshot: snapshot(buyReadyCandidate()),
  runtimeState: { canAttemptScannerAutoExecution: false },
  riskState: baseRisk,
});
ok(disabled.skippedCandidates[0]?.finalNoBuyReason === 'AUTO_EXECUTION_DISABLED', 'runtime OFF produces exact AUTO_EXECUTION_DISABLED skip reason');

const duplicate = buildExecutableCandidateSet({
  scanSnapshot: snapshot(buyReadyCandidate()),
  runtimeState: { canAttemptScannerAutoExecution: true },
  riskState: { ...baseRisk, openSymbols: ['OPGUSDT'] },
});
ok(duplicate.skippedCandidates[0]?.finalNoBuyReason === 'DUPLICATE_OPEN_POSITION', 'duplicate open symbol produces exact duplicate skip reason');

const plannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const executionPlannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
const topCandidatesSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
ok(!plannerSrc.includes('scannerSnapshot: { scanId } as ScannerSnapshot'), 'MarketScanner no longer hands ExecutionPlanner a scanId-only snapshot');
ok(plannerSrc.includes('candidates: rankedCandidatesToAnnotate'), 'MarketScanner planner snapshot contains the ranked candidate list');
ok(executionPlannerSrc.includes('EXECUTION_SELECTION_INTEGRITY_AUDIT'), 'ExecutionPlanner emits selection integrity audit');
ok(topCandidatesSrc.includes('UNKNOWN_EXECUTION_SELECTION_BUG'), 'TopCandidatesPanel treats missing execution trigger reason as an integrity bug');

console.log(`buy-ready-execution-handoff-root-cause.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
