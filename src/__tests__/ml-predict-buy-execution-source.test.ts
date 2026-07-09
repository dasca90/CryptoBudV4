import { strict as assert } from 'assert';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

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
  };
}

function candidate(symbol: string, source: 'AutoBots' | 'ML_PREDICT_BUY'): ScannerCandidate {
  const mlFields = source === 'ML_PREDICT_BUY'
    ? {
        candidateSource: 'ML_PREDICT_BUY',
        executionSource: 'ML_PREDICT_BUY',
        mlPredictBuyPrediction: {
          symbol,
          predictedAction: 'BUY' as const,
          predictedWinProb: 0.74,
          badEntryRisk: 0.18,
          expectedPnlPct: 2.1,
          modelConfidence: 0.83,
          featureCompleteness: 1,
          rowsUsed: 160,
          sampleSizeOk: true,
          modelVersion: 'ml-test-v1',
          featureSchemaVersion: 'cryptobud-v4-ml-feature-schema-v1',
          reason: 'test',
        },
        mlPredictBuyDecision: {
          symbol,
          scanCycleId: 'scan_ml_test',
          predictedAction: 'BUY' as const,
          predictedWinProb: 0.74,
          badEntryRisk: 0.18,
          expectedPnlPct: 2.1,
          modelConfidence: 0.83,
          featureCompleteness: 1,
          rowsUsed: 160,
          sampleSizeOk: true,
          strategy: 'momentum',
          riskGroup: 'mid_caps',
          preMlGatePassed: true,
          mlGuardBlocked: false,
          postMlHardGatesPassed: true,
          entryGateApproved: true,
          finalDecision: 'BUY_READY' as const,
          blockedReason: null,
          failedGate: null,
          executionMode: 'demo' as const,
          executionAdapter: 'paper_simulated' as const,
          mode: 'AUTO_BUY' as const,
          source: 'ML_PREDICT_BUY' as const,
        },
      }
    : {};

  return {
    candidateId: `c_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.8,
    status: 'BUY',
    runtimeSnapshot: { invariantOk: true } as any,
    strategyDecision: { invariantOk: true, finalExecutionStrategy: 'momentum' } as any,
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
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 'test' } } as any,
    entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 'test' },
    entryGateDecision: gateAllow(),
    mainReason: 'ok',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 1000,
    spreadPct: 0.1,
    volumeRel: 1,
    tpRoomOk: true,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    minNotional: 10,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.9,
    m5Change: 0,
    m15Change: 0,
    h1Change: 0,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    ...mlFields,
  };
}

function snapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'scan_ml_source',
    startedAt: '',
    finishedAt: '',
    status: 'COOLDOWN',
    universeMode: 'TOP_50',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: '',
    diagnostics: {} as any,
  };
}

function planFor(c: ScannerCandidate) {
  return buildExecutionPlan({
    scannerSnapshot: snapshot([c]),
    executionPool: [c],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 5,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
    runtimeCanAttemptAutoExecution: true,
  });
}

const mlPlan = planFor(candidate('SOLUSDT', 'ML_PREDICT_BUY'));
assert.equal(mlPlan.selectedCandidates.length, 1);
assert.equal(mlPlan.selectedCandidates[0].scannerAutoEntryConfigSnapshot?.source, 'ML_PREDICT_BUY');
assert.equal(mlPlan.selectedCandidates[0].scannerAutoEntryConfigSnapshot?.modelVersionAtEntry, 'ml-test-v1');
assert.equal(mlPlan.selectedCandidates[0].mlPredictBuyDecision?.finalDecision, 'BUY_READY');

const autoBotsPlan = planFor(candidate('ETHUSDT', 'AutoBots'));
assert.equal(autoBotsPlan.selectedCandidates.length, 1);
assert.equal(autoBotsPlan.selectedCandidates[0].scannerAutoEntryConfigSnapshot?.source, 'AutoBots');

console.log('ml-predict-buy-execution-source.test.ts passed');
