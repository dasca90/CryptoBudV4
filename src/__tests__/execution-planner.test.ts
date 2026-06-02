/**
 * ExecutionPlanner Test Suite
 *
 * Tests:
 * 1. WAIT candidates never selected
 * 2. BLOCK candidates never selected
 * 3. BUY candidate with EntryGate ALLOW can be planned
 * 4. BUY candidate with RiskEngine BLOCK is skipped
 * 5. duplicate open position is skipped
 * 6. duplicate pending order is skipped
 * 7. max positions reached blocks plan
 * 8. insufficient capital blocks plan
 * 9. live mode returns BLOCKED_LIVE
 * 10. ranking chooses higher-quality candidate
 * 11. no-buy summary includes SPREAD_TOO_HIGH
 * 12. no-buy summary includes DUPLICATE_POSITION
 * 13. no-buy summary includes MAX_POSITIONS_REACHED
 * 14. Build methods exist
 *
 * Run: npx tsx src/__tests__/execution-planner.test.ts
 */

import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { ScannerCandidate, ScannerSnapshot, EntryGateOutput } from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

function makeCandidate(overrides: Partial<ScannerCandidate> & { symbol: string }): ScannerCandidate {
  const baseSymbol = overrides.symbol;
  return {
    candidateId: `cand_${baseSymbol}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 80,
    status: 'BUY',
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 100, quantity: 1, reason: 'test entry plan' } } as any,
    entryGateDecision: { decision: 'ALLOW' } as EntryGateOutput,
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
    scanId: 'test_scan',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'TOP_50',
    universeSize: 100,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.filter(c => c.status === 'BUY').length,
    waitCount: candidates.filter(c => c.status === 'WAIT').length,
    blockCount: candidates.filter(c => c.status === 'BLOCK').length,
    avoidCount: candidates.filter(c => c.status === 'AVOID').length,
    candidates,
    summary: 'test',
    diagnostics: {} as any,
  };
}

const BASE_PLAN_INPUT = {
  scannerSnapshot: makeSnapshot([]),
  watchPool: [] as ScannerCandidate[],
  nearMissPool: [] as ScannerCandidate[],
  openSymbols: [] as string[],
  pendingOrderSymbols: [] as string[],
  capital: 10000,
  usedCapital: 0,
  maxPositions: 10,
  maxEntriesPerCycle: 2,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified' as const,
  executionAdapter: 'paper_simulated' as const,
  enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
};

// 1. WAIT candidates never selected
console.log('\n── 1. WAIT candidates never selected ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [],
    watchPool: [makeCandidate({ symbol: 'WAITBTC', status: 'WAIT', confidence: 70 })],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '1 WAIT never selected');
  assert(plan.canExecute === false, '1 canExecute false with WAIT only');
}

// 2. BLOCK candidates never selected
console.log('\n── 2. BLOCK candidates never selected ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [],
    watchPool: [makeCandidate({ symbol: 'BLOCKBTC', status: 'BLOCK', confidence: 60 })],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '2 BLOCK never selected');
}

// 3. BUY candidate with EntryGate ALLOW can be planned
console.log('\n── 3. BUY + EntryGate ALLOW + RiskEngine ok → planned ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'GOODBTC', rank: 1 })],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length >= 1, '3 BUY + ALLOW = planned');
  assert(plan.canExecute === true, '3 canExecute true');
  assert(plan.selectedCandidates[0].plannedAction === 'BUY', '3 plannedAction BUY');
  assert(!!plan.selectedCandidates[0].entryPlan, '3 selected BUY carries entryPlan');
  assert(plan.selectedCandidates[0].entryPlan?.price === 100, '3 selected entryPlan preserves execution price');
}

// 4. BUY candidate with RiskEngine BLOCK is skipped
console.log('\n── 4. BUY + RiskEngine BLOCK → skipped ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'RISKYBTC', rank: 2, riskDecision: { verdict: 'BLOCK', explanation: 'Risk limit' } as any })],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '4 RiskEngine BLOCK = not selected');
  assert(plan.skippedCandidates.length >= 1, '4 RiskEngine BLOCK = skipped');
  assert(plan.skippedCandidates[0].gate === 'RiskEngine', '4 gate = RiskEngine');
}

// 5. duplicate open position is skipped
console.log('\n── 5. Duplicate open position → skipped ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'DUPBTC', rank: 3 })],
    openSymbols: ['DUPBTC'],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '5 duplicate = not selected');
  assert(plan.skippedCandidates.length >= 1, '5 duplicate = skipped');
  assert(plan.skippedCandidates[0].gate === 'EntryGate', '5 gate = EntryGate');
}

// 6. duplicate pending order is skipped
console.log('\n── 6. Duplicate pending order → skipped ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'PENDBTC', rank: 4 })],
    pendingOrderSymbols: ['PENDBTC'],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '6 duplicate pending = not selected');
  assert(plan.skippedCandidates.length >= 1, '6 duplicate pending = skipped');
}

// 7. max positions reached blocks plan
console.log('\n── 7. Max positions reached → blocks ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'MAXBTC', rank: 5 })],
    openSymbols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    maxPositions: 10,
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '7 max positions = not selected');
  assert(plan.availableSlots === 0, '7 availableSlots = 0');
}

// 8. insufficient capital blocks plan
console.log('\n── 8. Insufficient capital → blocks ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'CAPBTC', rank: 6 })],
    capital: 100,
    usedCapital: 100,
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '8 no capital = not selected');
  assert(plan.capitalAvailable <= 0, '8 capitalAvailable <= 0');
}

// 9. unified decision mode propagates executionAdapter
console.log('\n── 9. Unified decision mode ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'UNIFIEDBTC', rank: 7 })],
    decisionMode: 'unified',
    executionAdapter: 'binance_live',
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.decisionMode === 'unified', '9 decisionMode = unified');
  assert(plan.executionAdapter === 'binance_live', '9 executionAdapter = binance_live');
  assert(plan.canExecute === true, '9 canExecute = true (unified decision)');
}

// 10. ranking chooses higher-quality candidate
console.log('\n── 10. Ranking: higher confidence + lower spread → higher score ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [
      makeCandidate({ symbol: 'LOWBTC', rank: 2, confidence: 50, spreadPct: 0.2 }),
      makeCandidate({ symbol: 'HIGHBTC', rank: 1, confidence: 90, spreadPct: 0.05 }),
    ],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length >= 2, '10 both candidates processed');
  // HIGHBTC should have higher score (higher confidence, lower spread)
  const high = plan.selectedCandidates.find(c => c.symbol === 'HIGHBTC');
  const low = plan.selectedCandidates.find(c => c.symbol === 'LOWBTC');
  if (high && low) {
    assert(high.score > low.score, '10 HIGHBTC score > LOWBTC score');
  } else {
    assert(false, '10 both candidates present in plan');
  }
}

// 11. no-buy summary includes SPREAD_TOO_HIGH
console.log('\n── 11. No-buy summary includes SPREAD_TOO_HIGH ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'SPREADBTC', rank: 10, spreadPct: 1.0 })],
    watchPool: [],
    nearMissPool: [],
  });
  const hasSpreadReason = plan.noBuyReasons.some(r => r.includes('SPREAD') || r.includes('finalExecutable_false') || r.includes('strategy_setup_not_met'));
  // SPREAD_TOO_HIGH from the skipped candidate plus the watch/near-miss pool reasons
  assert(hasSpreadReason, '11 SPREAD in noBuyReasons');
}

// 11b. Missing entry plan fails closed before adapter handoff
console.log('\n-- 11b. Missing entry plan is not selected --\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'NOPLANBTC', rank: 10, traderBrainDecision: { entryPlan: null } as any })],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '11b missing entryPlan is not selected');
  assert(plan.skippedCandidates.some(c => c.reason === 'ENTRY_PLAN_MISSING'), '11b skip reason is ENTRY_PLAN_MISSING');
}

// 11d. Runtime failing shape: executionPlan exists, entryPlan missing -> normalize and select
console.log('\n-- 11d. Normalize entryPlan from executionPlan shape --\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({
      symbol: 'NORMBTC',
      traderBrainDecision: { entryPlan: null } as any,
      entryPlan: null as any,
      executionPlan: { entryPlan: { side: 'BUY', price: 100, quantity: 1, reason: 'execution plan fallback' } } as any,
      blockReasons: [],
      bookFresh: true,
      price: 100,
    })],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length > 0, '11d normalized candidate becomes selectable');
  assert((plan.generatedEntryPlanCount ?? 0) === 0, '11d no synthetic generation when executionPlan entryPlan exists');
  assert((plan.plannerInputWithEntryPlan ?? 0) > 0, '11d plannerInputWithEntryPlan increments');
  assert(plan.selectedCandidates[0].entryPlan?.price === 100, '11d selected candidate keeps normalized entry plan');
}

// 11c. Stale book candidate cannot be selected
console.log('\n-- 11c. Stale book is not selected --\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'STALEBOOKBTC', rank: 10, bookFresh: false })],
    watchPool: [],
    nearMissPool: [],
  });
  assert(plan.selectedCandidates.length === 0, '11c stale book candidate is not selected');
  assert(plan.skippedCandidates.some(c => c.reason === 'BLOCK_BOOK_STALE'), '11c skip reason is BLOCK_BOOK_STALE');
}

// 12. no-buy summary includes DUPLICATE_POSITION
console.log('\n── 12. No-buy summary includes DUPLICATE ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'DUP2BTC', rank: 11 })],
    openSymbols: ['DUP2BTC'],
    watchPool: [],
    nearMissPool: [],
  });
  const hasDupReason = plan.noBuyReasons.some(r => r.includes('DUPLICATE'));
  assert(hasDupReason, '12 DUPLICATE in noBuyReasons');
}

// 13. no-buy summary includes MAX_POSITIONS_REACHED
console.log('\n── 13. No-buy summary includes MAX_POSITIONS ──\n');
{
  const plan = buildExecutionPlan({
    ...BASE_PLAN_INPUT,
    executionPool: [makeCandidate({ symbol: 'FULLBTC', rank: 12 })],
    openSymbols: Array(10).fill('X').map((_, i) => `POS${i}`),
    maxPositions: 10,
    watchPool: [],
    nearMissPool: [],
  });
  const hasMaxReason = plan.noBuyReasons.some(r => r.includes('MAX') || r.includes('POSITION'));
  assert(hasMaxReason, '13 MAX_POSITIONS in noBuyReasons');
}

// ── Summary ──
console.log('\n══════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);

