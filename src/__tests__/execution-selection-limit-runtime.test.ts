import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function gateAllow(): EntryGateOutput {
  return { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], explanation: 'allow', requiredNextActions: [] } as any;
}

function makeCandidate(symbol: string, rank: number): ScannerCandidate {
  return {
    candidateId: `cand_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.9 - rank * 0.001,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 10, quantity: 10, reason: 'runtime limit test' } } as any,
    entryGateDecision: gateAllow(),
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 10,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 2,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.7,
    m5Change: 0.6,
    m15Change: 0.7,
    h1Change: 0.8,
    change24h: 3,
    mlBadEntryRisk: false,
    mlWinProbability: 0.9,
    rank,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    autoStrategyDecision: { effectiveStrategy: 'momentum', strategySource: 'autobots', groupTrend: 'bullish', groupRecommendedStrategy: 'momentum', confidenceTier: 'high', reason: 'test' } as any,
    strategySource: 'autobots',
    groupTrend: 'bullish',
  } as unknown as ScannerCandidate;
}

function makeSnapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'selection_limit_runtime_scan',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'BINANCE_TOP_250',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: 'runtime selection limit test',
    diagnostics: {} as any,
  };
}

const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate(`COIN${i + 1}USDT`, i + 1));
const plan = buildExecutionPlan({
  scannerSnapshot: makeSnapshot(candidates),
  executionPool: candidates,
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 10000,
  usedCapital: 0,
  maxPositions: 20,
  maxSelectedPerScan: 10,
  maxEntriesPerCycle: 10,
  maxSelectedPerScanSource: 'ui_setting',
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { mid_caps: true },
});

const skippedByLimit = plan.skippedCandidates.filter((s) => s.reason.includes('Execution selection limit reached'));
ok(plan.executionPoolSize === 20, 'buyReadyCount/executionPoolSize is 20');
ok(plan.maxSelectedPerScan === 10, 'effective maxSelectedPerScan is 10');
ok(plan.selectedCandidates.length === 10, 'selectedCount is 10');
ok(skippedByLimit.length === 10, 'skippedBySelectionLimitCount is 10');
ok(!skippedByLimit.some((s) => s.reason.includes('maxSelectedPerScan=4')), 'selection limit audit/reason never reports maxSelectedPerScan=4');
ok(!plan.selectedCandidates.length || plan.selectedCandidates.length !== 4, 'selectedCount is not capped at 4');

const explicitFour = buildExecutionPlan({
  scannerSnapshot: makeSnapshot(candidates),
  executionPool: candidates,
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 10000,
  usedCapital: 0,
  maxPositions: 20,
  maxSelectedPerScan: 4,
  maxEntriesPerCycle: 4,
  maxSelectedPerScanSource: 'ui_setting',
  maxSelectedPerScanUserExplicit: true,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { mid_caps: true },
});
ok(explicitFour.selectedCandidates.length === 4 && explicitFour.maxSelectedPerScan === 4, 'selectedCount=4 only when canonical config explicitly says 4');

if (failed > 0) {
  console.error(`execution-selection-limit-runtime: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`execution-selection-limit-runtime: ${passed} passed, ${failed} failed`);
