import { strict as assert } from 'node:assert';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';
import { MarketDataFeed } from '../utils/MarketDataFeed';

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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 90, required: 0.3, source: 'test' },
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

function candidate(symbol: string, overrides: Partial<ScannerCandidate> & Record<string, unknown> = {}): ScannerCandidate {
  MarketDataFeed.getInstance().setManualPrice(symbol, 1);
  return {
    candidateId: `queue_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    finalExecutionStrategy: 'balanced',
    selectedPlaybook: null,
    confidence: 90,
    rawScore: 90,
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
    mlWinProbability: 90,
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
      confidence: 90,
      score: 90,
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
      strategySource: 'autobots',
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

function snapshot(candidates: ScannerCandidate[], scanId = 'queue_scan'): ScannerSnapshot {
  return {
    scanId,
    startedAt: '',
    finishedAt: '',
    status: 'COOLDOWN',
    universeMode: 'TOP_50',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.filter((row) => row.status === 'BUY').length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: '',
    diagnostics: {} as any,
  };
}

function plan(candidates: ScannerCandidate[], overrides: Record<string, unknown> = {}) {
  return buildExecutionPlan({
    scannerSnapshot: snapshot(candidates, String(overrides.scanId ?? 'queue_scan')),
    executionPool: candidates,
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 100000,
    usedCapital: 0,
    maxPositions: 24,
    maxEntriesPerCycle: 10,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
    ...overrides,
  } as any);
}

{
  const candidates = Array.from({ length: 24 }, (_, index) => candidate(`Q${index + 1}USDT`, { rank: index + 1 }));
  const result = plan(candidates);
  assert.equal(result.maxExecutionQueuePerScan, 10, 'queue cap is fixed at 10');
  assert.equal(result.queueAcceptedCount, 10, '24 valid candidates accept 10 into queue');
  assert.equal(result.deferredByQueueLimitCount, 14, '24 valid candidates defer 14');
  assert.equal(result.skippedCandidates.filter((row) => row.finalNoBuyReason === 'MAX_EXECUTION_QUEUE_REACHED').length, 14, 'only deferred candidates use queue cap reason');
}

{
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(`B${index + 1}USDT`, { rank: index + 1 }));
  const result = plan(candidates);
  assert.equal(result.queueAcceptedCount, 8, '8 valid candidates all enter queue');
  assert.equal(result.deferredByQueueLimitCount, 0, '8 valid candidates have no queue deferrals');
  assert.equal(result.skippedCandidates.some((row) => row.finalNoBuyReason === 'MAX_EXECUTION_QUEUE_REACHED'), false, 'below cap has no queue cap reason');
}

{
  const valid = Array.from({ length: 10 }, (_, index) => candidate(`V${index + 1}USDT`, { rank: index + 1 }));
  const invalid = Array.from({ length: 5 }, (_, index) => candidate(`HFAIL${index + 1}USDT`, {
    rank: index + 11,
    momentumConfirmed: undefined as any,
  }));
  const result = plan([...valid, ...invalid]);
  assert.equal(result.queueAcceptedCount, 10, 'handoff-failed candidates do not consume queue slots');
  assert.equal(result.deferredByQueueLimitCount, 0, 'invalid handoff candidates are not queue-deferred');
  assert.equal(result.skippedCandidates.filter((row) => row.finalNoBuyReason === 'STRATEGY_HANDOFF_INTEGRITY_FAILED').length, 5, 'invalid handoff candidates are blocked separately');
}

{
  const candidates = Array.from({ length: 24 }, (_, index) => candidate(`P${index + 1}USDT`, { rank: index + 1 }));
  const result = plan(candidates, {
    openSymbols: Array.from({ length: 15 }, (_, index) => `OPEN${index + 1}`),
    maxPositions: 24,
  });
  assert.equal(result.queueAcceptedCount, 10, 'open positions 15/24 do not lower queue accepted count');
  assert.equal(result.deferredByQueueLimitCount, 14, 'queue deferrals still reflect only the 10-per-scan cap');
  assert.equal(result.availableSlots, 9, 'open position slots remain a separate safety count');
}

{
  const scanN = Array.from({ length: 11 }, (_, index) => candidate(`R${index + 1}USDT`, { rank: index + 1 }));
  const resultN = plan(scanN, { scanId: 'scan_n' });
  const deferred = resultN.deferredByQueueLimitSymbols?.[0];
  assert.ok(deferred, 'scan N has a deferred candidate');
  const resultNext = plan([candidate(deferred, { rank: 1 })], { scanId: 'scan_n_plus_1' });
  assert.equal(resultNext.queueAcceptedSymbols?.includes(deferred), true, 'queue-deferred candidate can be reevaluated next scan');
}

{
  const autoBots = Array.from({ length: 20 }, (_, index) => candidate(`AUTO${index + 1}USDT`, { rank: index + 2, confidence: 80, rawScore: 80 }));
  const unicorn = candidate('UNICORNREADYUSDT', {
    rank: 1,
    riskGroup: 'very_high_risk',
    confidence: 95,
    rawScore: 95,
    sourceOwner: 'Unicorn Hunter' as any,
    ownerType: 'unicorn' as any,
    candidateSource: 'unicorn_hunter' as any,
    source: 'unicorn_hunter' as any,
    executionSource: 'unicorn_hunter' as any,
    strategySource: 'unicorn_hunter' as any,
    ownerName: 'Unicorn Hunter' as any,
    autoStrategyDecision: { strategySource: 'unicorn_hunter', effectiveStrategy: 'momentum', groupTrend: 'bullish', groupRecommendedStrategy: 'momentum', reason: 'unicorn ready', warnings: [], confidenceTier: 'high' } as any,
    tradingTargetOwnership: {
      strategySource: 'unicorn_hunter',
      tp1Value: 7,
      tp1Source: 'Unicorn dynamic per coin',
      tp1Min: 5,
      tp1Max: 10,
      tp2Value: 0,
      slValue: 1.5,
      dynamicTrailingEnabled: false,
      trailingStartsAt: 'TP1',
      trailPullbackValue: 0.25,
    } as any,
  });
  const result = plan([unicorn, ...autoBots]);
  assert.equal(result.queueAcceptedSymbols?.includes('UNICORNREADYUSDT'), true, 'READY Unicorn enters the queue despite AutoBots volume');
}

console.log('execution-queue-per-scan-regression: all assertions passed');
