import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    confidence: 0.86,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 10, quantity: 10, reason: 'test' } } as any,
    entryGateDecision: gateAllow(),
    mainReason: 'MOMENTUM_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 10,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 1.5,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.5,
    m5Change: 0.4,
    m15Change: 0.5,
    h1Change: 0.6,
    change24h: 2,
    mlBadEntryRisk: false,
    mlWinProbability: 0.86,
    rank,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
  } as ScannerCandidate;
}

function makeSnapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'multi_handoff_scan',
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
    summary: 'multi handoff test',
    diagnostics: {} as any,
  };
}

const candidates = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'SOLUSDT'].map((symbol, i) => makeCandidate(symbol, i + 1));
const plan = buildExecutionPlan({
  scannerSnapshot: makeSnapshot(candidates),
  executionPool: candidates,
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 10000,
  usedCapital: 0,
  maxPositions: 10,
  maxSelectedPerScan: 10,
  maxEntriesPerCycle: 10,
  capitalPerTrade: 100,
  maxSpreadPct: 0.5,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { mid_caps: true },
});

ok(plan.selectedCandidates.length === candidates.length, 'ExecutionPlanner can select more than four candidates when maxSelectedPerScan allows it');
ok(plan.selectedCandidates.every((c) => c.plannedAction === 'BUY'), 'all selected candidates are BUY actions');

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
ok(!scannerSrc.includes('buyableCandidates[0]'), 'MarketScanner no longer hard-selects only buyableCandidates[0]');
ok(scannerSrc.includes('for (const firstCandidate of buyableCandidates)'), 'MarketScanner iterates all selected buyable candidates');
ok(scannerSrc.includes('attemptedSymbols.push(sc.symbol)'), 'MarketScanner records each controller-received symbol');
ok(scannerSrc.includes('controllerReceivedCount = attemptedSymbols.length'), 'controllerReceivedCount uses real attempted symbol count');
ok(scannerSrc.includes('MULTI_BUY_HANDOFF_AUDIT'), 'MarketScanner emits MULTI_BUY_HANDOFF_AUDIT');
ok(scannerSrc.includes('this.executionOpenSymbolsFn?.()') && scannerSrc.includes('this.executionUsedCapitalFn?.()'), 'handoff revalidates against current open positions and used capital inside the loop');
ok(scannerSrc.includes('positionCreatedCount++'), 'handoff aggregates created positions across selected candidates');

if (failed > 0) {
  console.error(`multi-selected-candidates-handoff: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`multi-selected-candidates-handoff: ${passed} passed, ${failed} failed`);
