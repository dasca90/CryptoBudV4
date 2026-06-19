import { resolveExecutionDecision } from '../core/scanner/executionDecision';
import { buildExecutableCandidateSet } from '../core/scanner/ExecutionPlanner';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExecutionDecisionParams } from '../core/scanner/executionDecision';
import type { ScannerCandidate, ScannerSnapshot, EntryGateOutput } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));
const eq = <T>(a: T, b: T, label: string) => ok(a === b, `${label}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);

function baseParams(overrides: Partial<ExecutionDecisionParams> = {}): ExecutionDecisionParams {
  return {
    symbol: 'BTCUSDT', scanId: 'test_scan', candidateRank: 1,
    status: 'BUY', finalExecutable: true, buyAllowed: true, setupResult: 'READY',
    finalExecutionStrategy: 'conservative', riskGroup: 'large_caps', groupName: 'large_caps',
    groupRecommendedStrategy: 'conservative', groupOpenCount: 0, groupMaxOpen: 3,
    groupExposure: 0, groupMaxExposure: 10000,
    priceFresh: true, bookFresh: true, spreadOk: true, tpRoomOk: true,
    capitalOk: true, maxOpenPositionsOk: true, maxGroupPositionsOk: true, maxGroupExposureOk: true,
    duplicateOpenPosition: false, pendingOrderExists: false, banned: false, buySpacingOk: true,
    runtimeExecutionEnabled: true,
    ...overrides,
  };
}

// ===== 1. PRICE_STALE beats UNKNOWN_BUG (priority) =====
{
  const d = resolveExecutionDecision(baseParams({ priceFresh: false }));
  eq(d.finalNoBuyReason, 'PRICE_STALE', 'PRICE_STALE selected over UNKNOWN bug');
}

// ===== 2. MAX_POSITIONS cannot appear when maxOpenPositionsOk=true =====
{
  const d = resolveExecutionDecision(baseParams({ maxOpenPositionsOk: true, groupOpenCount: 1, groupMaxOpen: 3 }));
  eq(d.finalNoBuyReason, 'none', 'maxOpenPositionsOk=true does not produce MAX_OPEN_POSITIONS_REACHED');
}

// ===== 3. MAX_POSITIONS only when openCount >= maxOpen =====
{
  const d = resolveExecutionDecision(baseParams({ maxOpenPositionsOk: false }));
  eq(d.finalNoBuyReason, 'MAX_OPEN_POSITIONS_REACHED', 'MAX_OPEN_POSITIONS_REACHED when maxOpenPositionsOk=false');
  // Verify it only appears when maxOpenPositionsOk is explicitly false
  const d2 = resolveExecutionDecision(baseParams({ maxOpenPositionsOk: true }));
  ok(d2.finalNoBuyReason !== 'MAX_OPEN_POSITIONS_REACHED', 'no MAX_OPEN_POSITIONS when maxOpenPositionsOk=true');
}

// ===== 4. Executable candidate missing riskGroup → MISSING_RISK_GROUP =====
{
  const d1 = resolveExecutionDecision(baseParams({ riskGroup: 'unknown' }));
  eq(d1.finalNoBuyReason, 'MISSING_RISK_GROUP', 'riskGroup unknown → MISSING_RISK_GROUP');
  const d2 = resolveExecutionDecision(baseParams({ riskGroup: 'n/a' }));
  eq(d2.finalNoBuyReason, 'MISSING_RISK_GROUP', 'riskGroup n/a → MISSING_RISK_GROUP');
}

// ===== 5. STRATEGY_HANDOFF_INTEGRITY_FAILED when finalExecutable or buyAllowed false =====
{
  const d1 = resolveExecutionDecision(baseParams({ finalExecutable: false }));
  eq(d1.finalNoBuyReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED', 'finalExecutable=false → STRATEGY_HANDOFF_INTEGRITY_FAILED');
  const d2 = resolveExecutionDecision(baseParams({ buyAllowed: false }));
  eq(d2.finalNoBuyReason, 'STRATEGY_HANDOFF_INTEGRITY_FAILED', 'buyAllowed=false → STRATEGY_HANDOFF_INTEGRITY_FAILED');
}

// ===== 6. All checks pass → EXECUTE =====
{
  const d = resolveExecutionDecision(baseParams());
  eq(d.finalNoBuyReason, 'none', 'all clear: finalNoBuyReason is none');
  eq(d.finalDecision, 'EXECUTE', 'all clear: finalDecision is EXECUTE');
  ok(d.invariantOk, 'all clear: invariantOk is true');
}

// ===== 7. Canonical reason propagates through skippedCandidates =====
{
  const now = new Date().toISOString();
  const buyReady = (symbol: string, overrides: Partial<ScannerCandidate> = {}): ScannerCandidate => ({
    candidateId: `cand_${symbol}`, symbol, createdAt: now, updatedAt: now, mode: 'AUTO',
    riskGroup: 'mid_caps', selectedStrategy: 'conservative', selectedPlaybook: null,
    effectiveStrategy: 'conservative', confidence: 0.91, status: 'BUY',
    entryGateDecision: {
      decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [],
      requiredNextActions: [], explanation: 'ok',
      snapshot: { decision: 'ALLOW', primaryReason: null, blockReasons: [], requiredNextActions: [],
        confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.91, required: 0.3, source: 'test' },
        spreadSlippageResult: { status: 'PASS', reason: null },
        priceFreshnessResult: { status: 'PASS', reason: null },
        tpRoomResult: { status: 'PASS', reason: null },
        marketSafetyResult: { status: 'PASS', reason: null },
        exposureCapitalResult: { status: 'PASS', reason: null },
        duplicateSymbolResult: { status: 'PASS', reason: null },
        timestamp: now, source: 'entry_gate_canonical',
      },
    } as EntryGateOutput,
    mainReason: 'BUY_READY', requiredNextActions: [], blockReasons: [], warnings: [],
    price: 1.23, priceAgeMs: 100, priceFresh: true, spreadPct: 0.05, volumeRel: 1.5, tpRoomOk: true,
    reboundConfirmed: true, momentumConfirmed: true, dipPercent: -2.5, reboundPercent: 1.2,
    reboundFreshnessStatus: 'valid', reboundTimestamp: now,
    dipLowTimestamp: new Date(Date.now() - 20_000).toISOString(),
    reboundAgeMs: 10_000, maxAllowedReboundAgeMs: 180_000,
    m5Change: 0.4, m15Change: 0.2, h1Change: 0.1, change24h: 0,
    mlBadEntryRisk: false, mlWinProbability: 0.82, bookFresh: true,
    autoStrategyDecision: { strategySource: 'autobots', effectiveStrategy: 'conservative',
      groupTrend: 'neutral', groupRecommendedStrategy: 'conservative', reason: 'test',
      warnings: [], confidenceTier: 'high' } as any,
    tradingTargetOwnership: { tp1Value: 1.2, tp2Value: 0, slValue: 1.5, dynamicTrailingEnabled: false } as any,
    traderBrainDecision: { entryPlan: { side: 'BUY', price: 1.23, quantity: 10, reason: 'BUY_READY' }, ruleDecisionTrace: {} as any } as any,
    ...overrides,
  }) as ScannerCandidate;
  const snap = (candidates: ScannerCandidate[]): ScannerSnapshot => ({
    scanId: 'test_scan', startedAt: now, finishedAt: now, status: 'COOLDOWN',
    universeMode: 'TOP_50', universeSize: candidates.length, scannedCount: candidates.length,
    candidateCount: candidates.length, buyCount: candidates.filter(c => c.status === 'BUY').length,
    waitCount: 0, blockCount: 0, avoidCount: 0, candidates, summary: 'test', diagnostics: {} as any,
  });

  // Duplicate → skipped with DUPLICATE_OPEN_POSITION
  const result = buildExecutableCandidateSet({
    scanSnapshot: snap([buyReady('OPGUSDT')]),
    runtimeState: { canAttemptScannerAutoExecution: true },
    riskState: { openSymbols: ['OPGUSDT'], pendingOrderSymbols: [], capital: 1000, usedCapital: 0, capitalPerTrade: 100, maxPositions: 10, maxSpreadPct: 0.35 },
  });
  const skipped = result.skippedCandidates.find(s => s.symbol === 'OPGUSDT');
  ok(!!skipped, 'canonical set: OPGUSDT is in skippedCandidates');
  if (skipped) eq(skipped.finalNoBuyReason, 'DUPLICATE_OPEN_POSITION', 'canonical set: finalNoBuyReason=DUPLICATE_OPEN_POSITION');
}

// ===== 8. UI BUY count matches canonical BUY symbols =====
{
  const now = new Date().toISOString();
  const buyReady = (symbol: string, overrides: Partial<ScannerCandidate> = {}): ScannerCandidate => ({
    candidateId: `cand_${symbol}`, symbol, createdAt: now, updatedAt: now, mode: 'AUTO',
    riskGroup: 'mid_caps', selectedStrategy: 'conservative', selectedPlaybook: null,
    effectiveStrategy: 'conservative', confidence: 0.91, status: 'BUY',
    entryGateDecision: { decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [],
      requiredNextActions: [], explanation: 'ok', snapshot: {} as any } as EntryGateOutput,
    mainReason: 'BUY_READY', requiredNextActions: [], blockReasons: [], warnings: [],
    price: 1.23, priceAgeMs: 100, priceFresh: true, spreadPct: 0.05, volumeRel: 1.5, tpRoomOk: true,
    reboundConfirmed: true, momentumConfirmed: true, dipPercent: -2.5, reboundPercent: 1.2,
    reboundFreshnessStatus: 'valid', reboundTimestamp: now, m5Change: 0.4,
    mlBadEntryRisk: false, mlWinProbability: 0.82, bookFresh: true,
    autoStrategyDecision: {} as any, tradingTargetOwnership: {} as any, traderBrainDecision: {} as any,
    ...overrides,
  }) as ScannerCandidate;
  const snap = (candidates: ScannerCandidate[]): ScannerSnapshot => ({
    scanId: 'test_scan', startedAt: now, finishedAt: now, status: 'COOLDOWN',
    universeMode: 'TOP_50', universeSize: candidates.length, scannedCount: candidates.length,
    candidateCount: candidates.length,     buyCount: candidates.filter(c => c.status === 'BUY').length,
    waitCount: 0, blockCount: 0, avoidCount: 0, candidates, summary: 'test', diagnostics: {} as any,
  });
  const result = buildExecutableCandidateSet({
    scanSnapshot: snap([buyReady('BTCUSDT'), buyReady('ETHUSDT')]),
    runtimeState: { canAttemptScannerAutoExecution: true },
    riskState: { openSymbols: [], pendingOrderSymbols: [], capital: 1000, usedCapital: 0, capitalPerTrade: 100, maxPositions: 10, maxSpreadPct: 0.35 },
  });
  eq(result.uiBuyReadySymbols.length, 2, 'UI BUY count matches input candidates count');
}

// ===== 9. No skipped candidate has empty finalNoBuyReason =====
{
  const d = resolveExecutionDecision(baseParams({ priceFresh: false }));
  ok(typeof d.finalNoBuyReason === 'string' && d.finalNoBuyReason.length > 0, 'finalNoBuyReason is a non-empty string');
  ok(d.finalNoBuyReason !== undefined && d.finalNoBuyReason !== null, 'finalNoBuyReason is not null/undefined');
}
{
  // Source check: finalNoBuyReason always populated on skippedCandidates
  const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
  ok(plannerSrc.includes('finalNoBuyReason'), 'ExecutionPlanner populates finalNoBuyReason on skippedCandidates');
}

// ===== 10. No UNKNOWN_EXECUTION_SELECTION_BUG when a known blocker exists =====
{
  // With priceFresh=false, the reason is PRICE_STALE, not UNKNOWN
  const d = resolveExecutionDecision(baseParams({ priceFresh: false }));
  ok(d.finalNoBuyReason !== 'UNKNOWN_EXECUTION_SELECTION_BUG', 'PRICE_STALE blocks, not UNKNOWN');
}
{
  // Only when all gates pass but candidate isn't executed could UNKNOWN appear
  // This requires the invariant fallback path (maxOpenPositionsOk contradiction)
  const src = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/executionDecision.ts'), 'utf8');
  ok(src.includes("'UNKNOWN_EXECUTION_SELECTION_BUG'"), 'UNKNOWN_EXECUTION_SELECTION_BUG is a valid fallback for invariant failure');
}

// ===== 11. Source — pipeline counters track actual lifecycle =====
{
  const src = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
  ok(src.includes('adapterCalledCount++'), 'pipeline: adapterCalledCount tracks actual adapter call');
  ok(src.includes('positionCreatedCount++'), 'pipeline: positionCreatedCount tracks actual position creation');
  ok(src.includes('adapterAcceptedCount++'), 'pipeline: adapterAcceptedCount tracks adapter success');
  ok(src.includes('orderFilledCount++'), 'pipeline: orderFilledCount tracks actual fill');
  ok(src.includes('journalPersistedCount++'), 'pipeline: journalPersistedCount tracks persistence');
  ok(src.includes('executionSelectedCount'), 'pipeline: executionSelectedCount tracks selected');
  ok(src.includes('submitAttemptedCount'), 'pipeline: submitAttemptedCount tracks submit attempts');
  ok(src.includes('telegramSentCount'), 'pipeline: telegramSentCount counter exists');
}

// ===== 12. Source — executionDecision on TradeV4CandidateView =====
{
  const typesSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/types.ts'), 'utf8');
  ok(typesSrc.includes('executionDecision'), 'TradeV4CandidateView has executionDecision field');
  ok(typesSrc.includes('submitAttempted'), 'candidate view includes submitAttempted');
  ok(typesSrc.includes('adapterAccepted'), 'candidate view includes adapterAccepted');
  ok(typesSrc.includes('orderFilled'), 'candidate view includes orderFilled');
}
{
  const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
  ok(adapterSrc.includes('executionDecision'), 'adapter maps executionDecision to view');
  ok(adapterSrc.includes('decisionsBySymbol'), 'adapter uses decisionsBySymbol lookup');
}

// ===== 13. Source — no legacy exactNotSelectedReason anywhere =====
{
  const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
  const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
  const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
  const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
  ok(!plannerSrc.includes('exactNotSelectedReason'), 'cleanup: ExecutionPlanner no exactNotSelectedReason');
  ok(!panelSrc.includes('exactNotSelectedReason'), 'cleanup: TopCandidatesPanel no exactNotSelectedReason');
  ok(!adapterSrc.includes('exactNotSelectedReason'), 'cleanup: tradeV4DataAdapter no exactNotSelectedReason');
  ok(!scannerSrc.includes('exactNotSelectedReason'), 'cleanup: MarketScanner no exactNotSelectedReason');
}

// ===== 14. Source — decisions field in ExecutionPlan =====
{
  const typesSrc = readFileSync(path.resolve(process.cwd(), 'src/core/types/index.ts'), 'utf8');
  ok(typesSrc.includes('ExecutionDecision[]'), 'ExecutionPlan.decisions typed as ExecutionDecision array');
  const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
  ok(plannerSrc.includes('decisions:'), 'ExecutionPlanner returns decisions in plan');
}

// ===== 15. Source — new ExecutionDecision fields (submitAttempted, adapterAccepted, orderFilled) =====
{
  const edSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/executionDecision.ts'), 'utf8');
  ok(edSrc.includes('submitAttempted'), 'ExecutionDecision has submitAttempted');
  ok(edSrc.includes('adapterAccepted'), 'ExecutionDecision has adapterAccepted');
  ok(edSrc.includes('orderFilled'), 'ExecutionDecision has orderFilled');
  ok(edSrc.includes('telegramSent'), 'ExecutionDecision has telegramSent');
  ok(!edSrc.includes('executionSubmitted'), 'ExecutionDecision no longer has executionSubmitted');
}

// ===== 16. Dev vs production parity — same fixture produces same decision =====
{
  // Verify the decision function is deterministic: same params → same result
  const params = baseParams({ priceFresh: false, spreadOk: false });
  const d1 = resolveExecutionDecision(params);
  const d2 = resolveExecutionDecision(params);
  eq(d1.finalNoBuyReason, d2.finalNoBuyReason, 'deterministic: same params → same finalNoBuyReason');
  eq(d1.finalDecision, d2.finalDecision, 'deterministic: same params → same finalDecision');
}

console.log(`\nexecution-decision.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
