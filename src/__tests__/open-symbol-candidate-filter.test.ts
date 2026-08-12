import { readFileSync } from 'node:fs';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { attachCandidateRuntimeSnapshot } from '../core/scanner/CandidateLifecycle';
import { PositionManager } from '../core/positions/PositionManager';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, message: string) => {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error('FAIL', message);
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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.9, required: 0.3, source: 'test' },
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
  const base = {
    candidateId: `cand_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'balanced',
    effectiveStrategy: 'balanced',
    finalExecutionStrategy: 'balanced',
    selectedPlaybook: null,
    confidence: 0.91,
    status: 'BUY',
    traderBrainDecision: {
      entryPlan: { side: 'BUY', price: 100, quantity: 1, reason: 'test' },
      ruleDecisionTrace: { unifiedSignal: { reasonCode: 'BUY_READY', definition: { buyRule: 'balanced' } } },
    } as any,
    entryGateDecision: gateAllow(),
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 100,
    priceAgeMs: 10,
    spreadPct: 0.05,
    volumeRel: 2,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 1.2,
    m5Change: 0.9,
    m15Change: 0.8,
    h1Change: 0.7,
    change24h: 6,
    mlBadEntryRisk: false,
    mlWinProbability: 0.82,
    bookFresh: true,
    priceFresh: true,
    autoStrategyDecision: {
      strategySource: 'autobots',
      effectiveStrategy: 'balanced',
      groupTrend: 'bullish',
      groupRecommendedStrategy: 'balanced',
      reason: 'test',
      warnings: [],
      confidenceTier: 'A_80_PLUS',
    } as any,
    tradingTargetOwnership: {
      strategySource: 'autobots',
      tp1Source: 'AutoBots dynamic per coin',
      tp1Value: 3,
      tp1Min: 2.5,
      tp1Max: 4,
      tp2Source: 'disabled',
      tp2Value: 0,
      slSource: 'user',
      slValue: 1.5,
      dynamicTrailingEnabled: false,
      trailingStartSource: 'tp1_rule',
      trailingStartsAt: 'TP1',
      trailPullbackSource: 'user',
      trailPullbackValue: 0.25,
      reason: 'test',
    } as any,
    finalExecutable: true,
    buyAllowed: true,
    ...overrides,
  } as ScannerCandidate;
  return attachCandidateRuntimeSnapshot({
    candidate: base,
    scanId: 'scan_open_symbol_filter',
    scannerCycleId: 'scan_open_symbol_filter',
    sourcePath: 'test_fixture',
    runtimeState: {
      uiAutoBotsOn: true,
      uiAutoBotsButtonState: true,
      autoBotsResolvedOn: true,
      resolvedAutoBotsEnabled: true,
      scannerAutoEnabled: true,
      paperAutoExecutionEnabled: true,
      manualOverrideRequested: false,
      manualOverrideEnabled: false,
      dynamicPerCoinStrategy: true,
      strategySourceResolved: 'AUTOBOTS_DYNAMIC',
      routerPath: 'test',
      runtimeStrategyDropdown: 'balanced',
      executionMode: 'demo_simulated',
      buildMode: 'test',
      tauriDetected: false,
      invariantOk: true,
      failureReason: 'none',
    } as any,
  });
}

function snapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'scan_open_symbol_filter',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'WATCHLIST',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.filter((c) => c.status === 'BUY').length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: 'test',
    diagnostics: {} as any,
  };
}

const openSol = candidate('SOLUSDT');
const openPlan = buildExecutionPlan({
  scannerSnapshot: snapshot([openSol]),
  executionPool: [openSol],
  watchPool: [],
  nearMissPool: [],
  openSymbols: ['SOLUSDT'],
  pendingOrderSymbols: [],
  capital: 1000,
  usedCapital: 100,
  maxPositions: 10,
  maxSelectedPerScan: 5,
  maxEntriesPerCycle: 5,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { mid_caps: true } as any,
});

ok(openPlan.executionPoolSize === 0, 'open symbol is removed from active execution pool count');
ok(openPlan.selectedCandidates.length === 0, 'open symbol does not reach ExecutionPlanner selected new buy');
ok(openPlan.noBuyReasons.includes('FILTERED_ALREADY_OPEN_POSITION'), 'open symbol gets exact filtered already-open reason');
ok(openPlan.skippedCandidates.some((candidate) => candidate.symbol === 'SOLUSDT' && candidate.finalNoBuyReason === 'FILTERED_ALREADY_OPEN_POSITION'), 'planner keeps diagnostic skipped record for filtered open symbol');

const newSui = candidate('SUIUSDT');
const newPlan = buildExecutionPlan({
  scannerSnapshot: snapshot([newSui]),
  executionPool: [newSui],
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 1000,
  usedCapital: 0,
  maxPositions: 10,
  maxSelectedPerScan: 5,
  maxEntriesPerCycle: 5,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { mid_caps: true } as any,
});

ok(newPlan.executionPoolSize === 1, 'non-open AutoBots candidate remains in active execution pool');
ok(!newPlan.noBuyReasons.includes('FILTERED_ALREADY_OPEN_POSITION'), 'non-open AutoBots candidate is not classified as already-open');

const pm = new PositionManager();
pm.addPosition('SOLUSDT', { coin: 'SOLUSDT', symbol: 'SOLUSDT', quantity: 1, avgEntryPrice: 100, currentPrice: 101, tradeId: 'open-sol' } as any);
ok(pm.hasOpenPosition('SOLUSDT'), 'open symbol still appears in PositionManager open positions');

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
const topSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');

ok(scannerSrc.includes('rankedEntryCandidates') && scannerSrc.includes('TOP_CANDIDATE_OPEN_SYMBOL_FILTER_AUDIT'), 'scanner builds active candidate list after PositionManager open-symbol filter');
ok(scannerSrc.includes('ENTRY_CANDIDATE_DUPLICATE_FILTER_AUDIT') && scannerSrc.includes('BUY_READY_COUNT_AFTER_DUPLICATE_FILTER_AUDIT'), 'scanner audits duplicate filtering before active counts');
ok(plannerSrc.includes('activeExecutionPool') && plannerSrc.includes('EXECUTION_POOL_OPEN_SYMBOL_EXCLUSION_AUDIT'), 'planner has backup open-symbol exclusion before selection');
ok(topSrc.includes('rawBuyStatusCount=') && topSrc.includes('uiBuyReadyCount='), 'Top Candidates buy-ready counts remain derived from active displayed rows');
ok(engineSrc.includes('for (const pos of this.positionManager.getOpenPositions())') && engineSrc.includes('EXIT_ENGINE_LIFECYCLE_AUDIT'), 'Exit Engine still evaluates PositionManager open positions');
console.log(`open-symbol-candidate-filter.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
