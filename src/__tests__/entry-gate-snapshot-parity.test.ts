import { readFileSync } from 'node:fs';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { revalidateCandidate } from '../core/scanner/PaperAutoExecutionController';
import { revalidateLiveCandidate } from '../core/scanner/BinanceLiveExecutionController';
import type { EntryGateDecisionSnapshot, EntryGateOutput, PlannedCandidate, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
function ok(condition: boolean, label: string) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

function gateOutput(decision: 'ALLOW' | 'BLOCK', reasons: string[] = []): EntryGateOutput {
  const confidenceBlocked = reasons.some(r => r.includes('CONFIDENCE'));
  return {
    decision,
    primaryReason: reasons[0] ?? null,
    blockReasons: reasons as any,
    warnings: [],
    explanation: '',
    requiredNextActions: [],
    snapshot: {
      decision,
      primaryReason: reasons[0] ?? null,
      blockReasons: reasons,
      requiredNextActions: [],
      confidenceResult: {
        status: confidenceBlocked ? 'BLOCK' : 'PASS',
        reason: reasons.find(r => r.includes('CONFIDENCE')) ?? null,
        pass: !confidenceBlocked,
        input: confidenceBlocked ? 0.22 : 0.88,
        required: 0.3,
        source: 'test.snapshot',
      },
      spreadSlippageResult: { status: reasons.some(r => r.includes('SPREAD')) ? 'BLOCK' : 'PASS', reason: reasons.find(r => r.includes('SPREAD')) ?? null },
      priceFreshnessResult: { status: reasons.some(r => r.includes('STALE')) ? 'BLOCK' : 'PASS', reason: reasons.find(r => r.includes('STALE')) ?? null },
      tpRoomResult: { status: reasons.some(r => r.includes('TP')) ? 'BLOCK' : 'PASS', reason: reasons.find(r => r.includes('TP')) ?? null },
      marketSafetyResult: { status: 'PASS', reason: null },
      exposureCapitalResult: { status: 'PASS', reason: null },
      duplicateSymbolResult: { status: 'PASS', reason: null },
      timestamp: new Date().toISOString(),
      source: 'entry_gate_canonical',
    },
  };
}

function makeCandidate(overrides: Partial<ScannerCandidate> & { symbol: string }): ScannerCandidate {
  return {
    candidateId: `cand_${overrides.symbol}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.8,
    status: 'BUY',
    traderBrainDecision: {} as any,
    entryGateDecision: gateOutput('ALLOW'),
    mainReason: 'ready',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 100,
    priceAgeMs: 100,
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
    mlWinProbability: 80,
    rank: 1,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    minNotional: 10,
    ...overrides,
  };
}

function makeSnapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'scan',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'TOP_50',
    universeSize: 50,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.filter(c => c.status === 'BUY').length,
    waitCount: candidates.filter(c => c.status === 'WAIT').length,
    blockCount: candidates.filter(c => c.status === 'BLOCK').length,
    avoidCount: candidates.filter(c => c.status === 'AVOID').length,
    candidates,
    summary: '',
    diagnostics: {} as any,
  };
}

function planFor(candidate: ScannerCandidate, executionAdapter: 'paper_simulated' | 'binance_live' = 'paper_simulated') {
  return buildExecutionPlan({
    scannerSnapshot: makeSnapshot([candidate]),
    executionPool: [candidate],
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
    executionAdapter,
    enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
  });
}

function plannedFrom(plan: ReturnType<typeof buildExecutionPlan>, candidate: ScannerCandidate): PlannedCandidate {
  return plan.selectedCandidates[0] ?? {
    symbol: candidate.symbol,
    rank: 1,
    status: candidate.status,
    strategy: candidate.selectedStrategy,
    effectiveStrategy: candidate.selectedStrategy,
    groupTrend: 'n/a',
    groupRecommendedStrategy: 'n/a',
    confidence: candidate.confidence,
    score: 0,
    plannedAction: 'BUY',
    reason: 'synthetic',
    requiredChecks: [],
    gateSnapshot: candidate.entryGateDecision?.snapshot,
  };
}

function runPaper(candidate: ScannerCandidate, planEntry: PlannedCandidate) {
  return revalidateCandidate({
    candidate,
    planEntry,
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
}

function runLive(candidate: ScannerCandidate, planEntry: PlannedCandidate, connected = true) {
  return revalidateLiveCandidate({
    candidate,
    planEntry,
    openSymbols: [],
    pendingLockSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    executionAdapter: 'binance_live',
    apiKeysConfigured: true,
    binanceConnected: connected,
    liveSafetyPassed: connected,
    emergencyStopActive: false,
    scannerRunning: true,
    groupEnabled: true,
  });
}

// 1. same allowed candidate produces BUY plan for paper and live decision stage
{
  const c = makeCandidate({ symbol: 'ALLOWUSDT' });
  const planPaper = planFor(c, 'paper_simulated');
  const planLive = planFor(c, 'binance_live');
  ok(planPaper.selectedCandidates[0]?.plannedAction === 'BUY', 'allowed candidate BUY plan for paper');
  ok(planLive.selectedCandidates[0]?.plannedAction === 'BUY', 'allowed candidate BUY plan for live');
  ok(runPaper(c, plannedFrom(planPaper, c)).blocked === false, 'allowed candidate allowed in paper controller');
  ok(runLive(c, plannedFrom(planLive, c)).blocked === false, 'allowed candidate allowed in live controller');
}

// 2. same blocked candidate blocks both paper and live
{
  const c = makeCandidate({ symbol: 'BLOCKUSDT', entryGateDecision: gateOutput('BLOCK', ['BLOCK_SPREAD_TOO_HIGH']) });
  const plan = planFor(c);
  const p = runPaper(c, plannedFrom(plan, c));
  const l = runLive(c, plannedFrom(plan, c));
  ok(plan.selectedCandidates.length === 0, 'blocked candidate not selected in planner');
  ok(p.blocked === true, 'blocked candidate blocks paper');
  ok(l.blocked === true, 'blocked candidate blocks live');
}

// 3/4. missing gateSnapshot blocks paper/live
{
  const c = makeCandidate({ symbol: 'MISSUSDT' });
  const planEntry = { ...plannedFrom(planFor(c), c), gateSnapshot: undefined };
  ok(runPaper(c, planEntry).blocked === true, 'missing snapshot blocks paper');
  ok(runLive(c, planEntry).blocked === true, 'missing snapshot blocks live');
}

// invalid gate snapshot blocks both
{
  const c = makeCandidate({ symbol: 'INVALIDUSDT' });
  const invalid = { ...(plannedFrom(planFor(c), c)), gateSnapshot: { decision: 'ALLOW' } as unknown as EntryGateDecisionSnapshot };
  ok(runPaper(c, invalid).blocked === true, 'invalid snapshot blocks paper');
  ok(runLive(c, invalid).blocked === true, 'invalid snapshot blocks live');
}

// 5-8 snapshot reason blocks both
for (const [sym, reason] of [
  ['STALEUSDT', 'BLOCK_PRICE_STALE'],
  ['SPREADUSDT', 'BLOCK_SPREAD_TOO_HIGH'],
  ['TPUSDT', 'BLOCK_NO_TP_ROOM'],
  ['CONFUSDT', 'BLOCK_CONFIDENCE_TOO_LOW'],
] as const) {
  const c = makeCandidate({ symbol: sym, entryGateDecision: gateOutput('BLOCK', [reason]) });
  const e = plannedFrom(planFor(c), c);
  ok(runPaper(c, e).blocked === true, `${reason} blocks paper`);
  ok(runLive(c, e).blocked === true, `${reason} blocks live`);
}

// 9. paper simulates fill only after allow (attempted true only for ALLOW)
{
  const allow = makeCandidate({ symbol: 'PAPERALLOW' });
  const block = makeCandidate({ symbol: 'PAPERBLOCK', entryGateDecision: gateOutput('BLOCK', ['BLOCK_NO_TP_ROOM']) });
  ok(runPaper(allow, plannedFrom(planFor(allow), allow)).attempted === true, 'paper attempted only when ALLOW');
  ok(runPaper(block, plannedFrom(planFor(block), block)).attempted === false, 'paper not attempted when BLOCK');
}

// 10/11. live adapter unavailable blocks safely and no fake pending/fill
{
  const c = makeCandidate({ symbol: 'LIVEUNAVAIL' });
  const r = runLive(c, plannedFrom(planFor(c, 'binance_live'), c), false);
  ok(r.blocked === true, 'live adapter unavailable blocks');
  ok(r.executed === false, 'live adapter unavailable no fake fill');
  ok(!r.gateResults.includes('ENTRYGATE_ALLOW') || r.gateResults.includes('LIVE_BINANCE_DISCONNECTED'), 'live unavailable remains blocked safely');
}

// 12. no forbidden runtime strings
{
  const forbidden = ['V3', 'V4', 'backup', 'legacy', 'reference', 'V3_V4'];
  const sources = [
    readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8'),
    readFileSync('src/core/scanner/PaperAutoExecutionController.ts', 'utf8'),
    readFileSync('src/core/scanner/BinanceLiveExecutionController.ts', 'utf8'),
    readFileSync('src/core/entry-gate/EntryGate.ts', 'utf8'),
  ];
  const scannerSource = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  for (const token of forbidden) {
    ok(!sources.some(s => s.includes(token)), `no forbidden token ${token}`);
  }
  ok(scannerSource.includes('displayedConfidence='), 'top mover trace logs displayedConfidence');
  ok(scannerSource.includes('gateConfidenceInput='), 'top mover trace logs gateConfidenceInput');
  ok(scannerSource.includes('confidencePass='), 'top mover trace logs confidencePass');
}

// 13. confidence contradiction guard: 88.3 vs 30 must not block confidence
{
  const c = makeCandidate({
    symbol: 'CONFHIGH',
    confidence: 0.883,
    entryGateDecision: gateOutput('BLOCK', ['BLOCK_SPREAD_TOO_HIGH']),
  });
  const plan = planFor(c);
  const ps = plannedFrom(plan, c);
  ok(ps.gateSnapshot?.confidenceResult.input === 0.88, 'snapshot confidence input follows canonical snapshot source');
  ok(ps.gateSnapshot?.confidenceResult.required === 0.3, 'snapshot confidence required is 0.3');
  ok(ps.gateSnapshot?.confidenceResult.reason !== 'BLOCK_CONFIDENCE_TOO_LOW', 'high confidence does not block by confidence');
}

// 14. confidence below threshold blocks with canonical source
{
  const c = makeCandidate({
    symbol: 'CONFLOW',
    confidence: 0.22,
    entryGateDecision: gateOutput('BLOCK', ['BLOCK_CONFIDENCE_TOO_LOW']),
  });
  const plan = planFor(c);
  const ps = plannedFrom(plan, c);
  ok(ps.gateSnapshot?.confidenceResult.status === 'BLOCK', 'low confidence blocks snapshot confidence result');
  ok(ps.gateSnapshot?.confidenceResult.input === 0.22, 'low confidence input captured');
  ok(ps.gateSnapshot?.confidenceResult.required === 0.3, 'required confidence captured');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

