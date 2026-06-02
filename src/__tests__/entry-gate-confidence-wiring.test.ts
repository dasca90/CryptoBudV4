import { EntryGate, buildCanonicalEntryGateSnapshot } from '../core/entry-gate/EntryGate';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { EntryGateInput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function gateInput(overrides?: Partial<EntryGateInput>): EntryGateInput {
  return {
    coin: 'PORTALUSDT',
    side: 'BUY',
    price: 1,
    quantity: 100,
    mode: 'AUTO',
    mlConfidence: 0.789,
    strategyConfidence: 0.789,
    prediction: 'momentum',
    currentPositions: 0,
    maxPositions: 10,
    recentLoss: false,
    spreadOk: true,
    volumePass: true,
    priceFresh: true,
    btcDumping: false,
    marketRegimeUnsafe: false,
    reboundConfirmed: true,
    momentumConfirmed: true,
    tpRoomOk: true,
    isVeryHighRisk: false,
    isLive: false,
    requiredConfidence: 0.3,
    confidenceSource: 'test',
    allowStrategyConfidenceFallback: true,
    ...overrides,
  };
}

const gate = new EntryGate();

// 1. buyConfidence=78.9 required=30 -> pass
{
  const r = gate.evaluate(gateInput({ mlConfidence: 0.789 }));
  ok(r.snapshot?.confidenceResult.pass === true, '78.9 confidence passes 30 requirement');
}

// 2. missing ML does not become 0 silently
{
  const r = gate.evaluate(gateInput({ mlConfidence: null, strategyConfidence: 0.81 }));
  ok(r.snapshot?.confidenceResult.input === 0.81, 'missing ML uses strategy fallback, not zero');
}

// 3. missing all confidence -> BLOCK_CONFIDENCE_UNAVAILABLE
{
  const r = gate.evaluate(gateInput({ mlConfidence: null, strategyConfidence: null }));
  ok(r.blockReasons.includes('BLOCK_CONFIDENCE_UNAVAILABLE'), 'missing confidence blocks unavailable');
  ok(!r.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), 'missing confidence is not too low');
}

// 4/5. gateConfidenceInput equals snapshot confidence.input and no contradiction pattern
{
  const r = gate.evaluate(gateInput({ mlConfidence: null, strategyConfidence: 0.82 }));
  const gateInputValue = r.snapshot?.confidenceResult.input;
  const buyConfidence = 0.82;
  ok(gateInputValue === buyConfidence, 'snapshot confidence input equals canonical gate input');
  ok(!(buyConfidence > 0.3 && gateInputValue === 0), 'no buyConfidence high + gate input zero contradiction');
}

// 6. confidencePass true proceeds to next blocker
{
  const r = gate.evaluate(gateInput({ mlConfidence: 0.8, tpRoomOk: false }));
  ok(r.blockReasons.includes('BLOCK_NO_TP_ROOM'), 'next real blocker remains active');
  ok(!r.blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW'), 'confidence not mis-blocked when high');
}

// 7. all passes reaches execution pool (planner select)
{
  const candidate: ScannerCandidate = {
    candidateId: 'c1',
    symbol: 'HOMEUSDT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.8,
    status: 'BUY',
    traderBrainDecision: {} as any,
    entryGateDecision: gate.evaluate(gateInput({ coin: 'HOMEUSDT', mlConfidence: 0.8 })),
    mainReason: 'ok',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 1000,
    spreadPct: 0.05,
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
  const snap: ScannerSnapshot = {
    scanId: 's1', startedAt: '', finishedAt: '', status: 'COOLDOWN', universeMode: 'TOP_50',
    universeSize: 1, scannedCount: 1, candidateCount: 1, buyCount: 1, waitCount: 0, blockCount: 0, avoidCount: 0, candidates: [candidate], summary: '', diagnostics: {} as any,
  };
  const plan = buildExecutionPlan({
    scannerSnapshot: snap,
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
    maxSpreadPct: 0.3,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(plan.executionPoolSize > 0 && plan.selectedCandidates.length === 1, 'all pass reaches execution pool');
}

// 8. paper/live parity input-independent canonical snapshot preserved
{
  const c = {
    candidateId: 'c2',
    symbol: 'PORTALUSDT',
    confidence: 0.8,
    spreadPct: 0.05,
    tpRoomOk: true,
    priceFresh: true,
    blockReasons: [],
    entryGateDecision: gate.evaluate(gateInput({ mlConfidence: 0.8 })),
  } as unknown as ScannerCandidate;
  const s = buildCanonicalEntryGateSnapshot(c, {
    openSymbols: [],
    pendingOrderSymbols: [],
    capitalAvailable: 1000,
    currentPositions: 0,
    maxPositions: 10,
    maxSpreadPct: 0.3,
    minConfidence: 0.3,
    groupEnabled: true,
  });
  ok(s.confidenceResult.input === 0.8, 'canonical snapshot confidence is stable for both adapters');
}

// 9/10. no fake BUY and no EntryGate bypass on missing confidence
{
  const r = gate.evaluate(gateInput({ mlConfidence: null, strategyConfidence: null }));
  ok(r.decision === 'BLOCK', 'missing confidence does not fake BUY');
  ok(r.primaryReason === 'BLOCK_CONFIDENCE_UNAVAILABLE', 'EntryGate still enforces confidence availability');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);


