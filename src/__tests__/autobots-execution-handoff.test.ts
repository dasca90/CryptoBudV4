import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { revalidateCandidate } from '../core/scanner/PaperAutoExecutionController';
import { revalidateLiveCandidate } from '../core/scanner/BinanceLiveExecutionController';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

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

function cand(symbol: string): ScannerCandidate {
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
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 't' } } as any,
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
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0,
    m5Change: 0,
    m15Change: 0,
    h1Change: 0,
    change24h: 0,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
  };
}

const c1 = cand('BTCUSDT');
const snapshot: ScannerSnapshot = {
  scanId: 's1', startedAt: '', finishedAt: '', status: 'COOLDOWN', universeMode: 'TOP_50',
  universeSize: 1, scannedCount: 1, candidateCount: 1, buyCount: 1, waitCount: 0, blockCount: 0, avoidCount: 0,
  candidates: [c1], summary: '', diagnostics: {} as any,
};

// 1/6/7 selectedCount respects limits
{
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [c1, cand('ETHUSDT'), cand('SOLUSDT')],
    watchPool: [],
    nearMissPool: [],
    openSymbols: ['X1', 'X2'],
    pendingOrderSymbols: [],
    capital: 250,
    usedCapital: 0,
    maxPositions: 3,
    maxEntriesPerCycle: 5,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(plan.selectedCandidates.length === 1, 'selection limited by slots/capital');
}

// 5 pre-check does not count as executed
{
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [c1],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  const pr = revalidateCandidate({
    candidate: c1,
    planEntry: plan.selectedCandidates[0],
    openSymbols: [],
    pendingLockSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    executionAdapter: 'paper_simulated',
    paperAutoEnabled: true,
    scannerRunning: true,
    groupEnabled: true,
  });
  ok(pr.stage === 'PreCheckPassed', 'pre-check stage emitted');
  ok(pr.executed === false, 'pre-check is not executed');
}

// 8 duplicate symbol blocks
{
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [c1],
    watchPool: [],
    nearMissPool: [],
    openSymbols: ['BTCUSDT'],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(plan.selectedCandidates.length === 0, 'duplicate open symbol is skipped');
}

// 9 missing snapshot blocks
{
  const blocked = revalidateCandidate({
    candidate: c1,
    planEntry: { ...({} as any), symbol: c1.symbol, plannedAction: 'BUY', gateSnapshot: undefined },
    openSymbols: [],
    pendingLockSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    executionAdapter: 'paper_simulated',
    paperAutoEnabled: true,
    scannerRunning: true,
    groupEnabled: true,
  });
  ok(blocked.blocked, 'missing snapshot blocks');
}

// 10/11 paper-live parity and live no simulated fill
{
  const live = revalidateLiveCandidate({
    candidate: c1,
    planEntry: { ...({} as any), symbol: c1.symbol, plannedAction: 'BUY', gateSnapshot: c1.entryGateDecision?.snapshot },
    openSymbols: [],
    pendingLockSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    executionAdapter: 'binance_live',
    apiKeysConfigured: true,
    binanceConnected: false,
    scannerRunning: true,
    groupEnabled: true,
  });
  ok(live.executed === false, 'live path does not simulate fill');
  ok(live.blocked === true, 'live disconnected blocks safely');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

