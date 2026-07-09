import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.8, required: 0.3, source: 'test' },
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

function candidate(symbol: string, overrides: Partial<ScannerCandidate> = {}): ScannerCandidate {
  return {
    candidateId: `cap_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    finalExecutionStrategy: 'balanced',
    selectedPlaybook: null,
    confidence: 0.82,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 100, quantity: 1, reason: 'balanced_entry' } } as any,
    entryGateDecision: gateAllow(),
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 100,
    livePrice: 100,
    referencePrice: 99,
    priceAgeMs: 100,
    spreadPct: 0.1,
    volumeRel: 1,
    tpRoomOk: true,
    reboundConfirmed: true,
    reboundFreshnessStatus: 'fresh',
    momentumConfirmed: true,
    dipPercent: 0.25,
    reboundPercent: 0.8,
    m5Change: 0.4,
    m15Change: 0.4,
    h1Change: 0.4,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    rank: 1,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    minNotional: 10,
    sourceOwner: 'AutoBots' as any,
    ownerType: 'scanner' as any,
    candidateSource: 'AutoBots' as any,
    autoStrategyDecision: { strategySource: 'autobots', effectiveStrategy: 'balanced', groupTrend: 'bullish', groupRecommendedStrategy: 'balanced', reason: 'test', warnings: [], confidenceTier: 'high' } as any,
    runtimeSnapshot: {
      invariantOk: true,
      sourceOwner: 'AutoBots',
      symbol,
      price: 100,
      livePrice: 100,
      referencePrice: 99,
      spreadPct: 0.1,
      tpRoomOk: true,
      strategy: 'balanced',
      finalExecutionStrategy: 'balanced',
      entryRule: 'BUY_READY',
      riskGroup: 'mid_caps',
      confidence: 0.82,
      score: 82,
      dipPercent: 0.25,
      reboundPercent: 0.8,
      momentumPct: 0.4,
      freshnessStatus: 'fresh',
    } as any,
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
    tradingTargetOwnership: {
      tp1Value: 2.8,
      tp1Source: 'AutoBots dynamic per coin',
      tp2Value: 0,
      slValue: 1.5,
      dynamicTrailingEnabled: false,
      trailingStartsAt: 'TP1',
      trailPullbackValue: 0.25,
    } as any,
    ...overrides,
  } as any;
}

const snapshot: ScannerSnapshot = {
  scanId: 'cap_handoff_scan',
  startedAt: '',
  finishedAt: '',
  status: 'COOLDOWN',
  universeMode: 'TOP_50',
  universeSize: 1,
  scannedCount: 1,
  candidateCount: 1,
  buyCount: 1,
  waitCount: 0,
  blockCount: 0,
  avoidCount: 0,
  candidates: [],
  summary: '',
  diagnostics: {} as any,
};

const baseInput = {
  scannerSnapshot: snapshot,
  executionPool: [] as ScannerCandidate[],
  watchPool: [] as ScannerCandidate[],
  nearMissPool: [] as ScannerCandidate[],
  openSymbols: [] as string[],
  pendingOrderSymbols: [] as string[],
  capital: 1000,
  usedCapital: 0,
  maxPositions: 24,
  maxEntriesPerCycle: 5,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified' as const,
  executionAdapter: 'paper_simulated' as const,
  enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true, mid_caps_alt: true },
};

{
  const plan = buildExecutionPlan({
    ...baseInput,
    executionPool: [candidate('ROOM14AUSDT'), candidate('ROOM14BUSDT')],
    openSymbols: Array.from({ length: 14 }, (_, i) => `OPEN${i}`),
    maxPositions: 24,
  });
  ok(plan.availableSlots === 10, 'available slots are 10 for 14/24');
  ok(!plan.noBuyReasons.includes('MAX_EXECUTION_SAFETY_CAP_REACHED'), 'no false safety cap below max positions');
}

{
  const plan = buildExecutionPlan({
    ...baseInput,
    executionPool: [candidate('QUEUEAUSDT'), candidate('QUEUEBUSDT')],
    capital: 100,
    capitalPerTrade: 100,
    maxPositions: 24,
  });
  ok(plan.selectedCandidates.length === 1, 'queue accepts first candidate');
  ok(!plan.skippedCandidates.some((c) => c.finalNoBuyReason === 'MAX_EXECUTION_QUEUE_REACHED'), 'capital cap is not reported as execution queue cap');
  ok(plan.skippedCandidates.some((c) => c.finalNoBuyReason === 'MAX_OPEN_POSITION_SLOTS_THIS_SCAN_REACHED' || c.finalNoBuyReason === 'MAX_CAPITAL_ALLOCATION_REACHED'), 'later candidate is blocked by real submit safety, not queue');
  ok(!plan.noBuyReasons.includes('MAX_EXECUTION_SAFETY_CAP_REACHED'), 'queue cap is not safety cap');
}

{
  const broken = candidate('HANDOFFMISSUSDT', {
    momentumConfirmed: undefined as any,
  });
  const plan = buildExecutionPlan({
    ...baseInput,
    executionPool: [broken],
  });
  ok(plan.selectedCandidates.length === 0, 'missing handoff field is not selected');
  ok(plan.skippedCandidates.some((c) => c.finalNoBuyReason === 'STRATEGY_HANDOFF_INTEGRITY_FAILED'), 'missing handoff field gets strategy handoff blocker');
}

{
  const plan = buildExecutionPlan({
    ...baseInput,
    executionPool: [candidate('VALIDHANDOFFUSDT')],
  });
  ok(plan.selectedCandidates.length === 1, 'complete handoff candidate is selectable');
  ok(!plan.skippedCandidates.some((c) => c.symbol === 'VALIDHANDOFFUSDT'), 'complete handoff candidate is not skipped');
}

console.log(`execution-cap-and-handoff-integrity.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
