import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { buildCandidateExecutionPrecheckSnapshot, buildCandidateRuntimeSnapshot, buildCandidateStrategyDecisionSnapshot } from '../core/scanner/CandidateLifecycle';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function gateAllow(): EntryGateOutput {
  return { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], explanation: 'allow', requiredNextActions: [] } as any;
}

function makeCandidate(symbol: string, rank: number): ScannerCandidate {
  const runtimeState = resolveAutoBotsRuntimeState({
    executionMode: 'paper_simulated',
    buildMode: 'production',
    tauriDetected: true,
    uiAutoBotsOn: true,
    strategySource: 'autobots',
    persistedAutoBotsOn: true,
    scannerAutoEnabled: true,
    paperAutoExecutionEnabled: true,
    marketScannerPaperAutoEnabled: true,
    paperAutoBuyFnPresent: true,
  });
  const candidate = {
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
    runtimeSnapshot: buildCandidateRuntimeSnapshot({ scanId: 'selection_limit_runtime_scan', runtimeState }),
    autoBotsRuntimeState: runtimeState,
    finalExecutionStrategy: 'momentum',
    effectiveStrategy: 'momentum',
    buyAllowed: true,
    finalExecutable: true,
    tradingTargetOwnership: {
      strategySource: 'autobots',
      tp1Source: 'AutoBots dynamic per coin',
      tp1Value: 1.8,
      tp2Source: 'disabled',
      tp2Value: 0,
      slSource: 'user',
      slValue: 1.5,
      dynamicTrailingEnabled: false,
      trailingStartsAt: 'TP1',
      trailPullbackValue: 0.25,
      reason: 'test',
    },
  } as unknown as ScannerCandidate;
  candidate.strategyDecision = buildCandidateStrategyDecisionSnapshot({
    scanId: 'selection_limit_runtime_scan',
    candidate,
    resolution: {
      symbol,
      riskGroup: 'mid_caps',
      groupTrend: 'bullish',
      groupRecommendedStrategy: 'momentum',
      groupConfidence: 0.9,
      marketBestFit: 'momentum',
      userSelectedRuntimeStrategy: 'momentum',
      dynamicPerCoinStrategy: true,
      perCoinSelectedStrategy: 'momentum',
      finalExecutionStrategy: 'momentum',
      strategySourceResolved: 'AUTOBOTS_DYNAMIC',
      fallbackApplied: false,
      fallbackType: 'NONE',
      fallbackReason: null,
      overrideApplied: false,
      overrideReason: null,
      mismatchAllowed: true,
      mismatchReason: 'unchanged',
      routerPath: 'smart_strategy_router',
      strategyDecisionTrace: ['source=autobots'],
      evaluatedStrategies: [],
      selectedStrategy: 'momentum',
      selectionReason: 'runtime_limit_test',
      noValidStrategyReason: null,
      noValidStrategyTrace: [],
      fallbackCanSubmitBuy: true,
      fallbackSubmitGuardReason: 'runtime_limit_test',
    } as any,
  });
  candidate.executionPrecheckSnapshot = buildCandidateExecutionPrecheckSnapshot({
    candidate,
    priceFresh: true,
    bookFresh: true,
    spreadOk: true,
    tpRoomOk: true,
    riskGroupResolved: true,
    professionalGateResolved: true,
    entryContractResolved: true,
    entryContractValid: true,
    capitalAvailable: true,
    duplicateChecked: true,
    pendingOrderChecked: true,
  });
  return candidate;
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

const skippedByLimit = plan.skippedCandidates.filter((s) => s.gate === 'ExecutionPlannerLimit');
ok(plan.executionPoolSize === 20, 'buyReadyCount/executionPoolSize is 20');
ok(plan.maxSelectedPerScan === 10, 'effective maxSelectedPerScan is 10');
ok(plan.selectedCandidates.length === 10, 'selectedCount is capped at maxSelectedPerScan=10');
ok(skippedByLimit.length === 0, 'no inspected candidate skipped when maxSelectedPerScan matches round-robin pool size');
ok(plan.noBuyReasons.length === 0, 'no buy reasons when all inspected candidates are selected');
ok(!plan.selectedCandidates.some((c) => c.reason?.includes('selection_limit_reached')), 'no candidate blocked by selection_limit_reached');
ok(!plan.skippedCandidates.some((s) => s.reason?.includes('selection_limit')), 'no skipped reason contains selection limit');
const selected = plan.selectedCandidates.map((c) => c.symbol);
ok(selected.length === 10, 'first 10 round-robin candidates selected when slots available and maxSelectedPerScan=10');

const explicitFour = buildExecutionPlan({
  scannerSnapshot: makeSnapshot(candidates),
  executionPool: candidates,
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 10000,
  usedCapital: 0,
  maxPositions: 4,
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
ok(explicitFour.selectedCandidates.length === 4 && explicitFour.maxSelectedPerScan === 4, 'selectedCount=4 when maxPositions and maxSelectedPerScan are both 4');
ok(explicitFour.skippedCandidates.length === 6, 'remaining inspected candidates are skipped after effective selection limit is reached');
ok(explicitFour.skippedCandidates.every((s) => s.gate === 'ExecutionPlannerLimit'), 'skipped reasons use ExecutionPlannerLimit labels');

if (failed > 0) {
  console.error(`execution-selection-limit-runtime: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`execution-selection-limit-runtime: ${passed} passed, ${failed} failed`);
