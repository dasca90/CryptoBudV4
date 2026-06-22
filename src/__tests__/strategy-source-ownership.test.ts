import { readFileSync } from 'node:fs';
import { computeAutoStrategy } from '../core/scanner/AutoStrategyRouter';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { AutoStrategyRouterInput, GroupTrendInput } from '../core/scanner/AutoStrategyRouter';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (c: boolean, l: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${l}`); } };

const BASE_INPUT: AutoStrategyRouterInput = {
  symbol: 'BTCUSDT',
  riskGroup: 'top_caps',
  referencePeriod: '1h',
  groupTrend: 'bullish',
  groupRecommendedStrategy: 'balanced',
  groupEnabled: true,
  candidateStatus: 'WAIT',
  confidence: 85,
  dipPct: -2,
  reboundPct: 2,
  momentumPct: 1.2,
  volumeRelative: 1.1,
  spreadPct: 0.1,
  tpRoomOk: true,
  priceFresh: true,
  fallingKnife: false,
  overextended: false,
  reboundConfirmed: true,
  momentumConfirmed: true,
  mlBadEntryRisk: false,
  mlWinProbability: 0,
  recentLossStreak: 0,
  userStrategyMode: 'auto',
  blockReasons: [],
};

const mk = (o: Partial<AutoStrategyRouterInput>) => ({ ...BASE_INPUT, ...o });

// Manual Override wins only when explicitly active
{
  const d = computeAutoStrategy(mk({ userStrategyMode: 'manual', manualSelectedStrategy: 'balanced' }));
  ok(d.strategySource === 'ManualOverride', 'manual override source owner');
  ok(d.effectiveStrategy === 'balanced', 'manual override forces strategy');
  ok(d.strategyReason.includes('Manual override active'), 'manual override reason explicit');
}
{
  const d = computeAutoStrategy(mk({ userStrategyMode: 'auto', manualSelectedStrategy: 'balanced' }));
  ok(d.strategySource !== 'ManualOverride', 'manual override not active in auto mode');
}

// AutoBots uses per-coin selector when available
{
  const d = computeAutoStrategy(mk({ groupTrend: 'bullish', momentumConfirmed: true, spreadPct: 0.1, priceFresh: true }));
  ok(d.strategySource === 'AutoBots', 'autobots owner used');
  ok(d.strategySourceDetail === 'per_coin_selector', 'autobots per-coin selector detail');
}

// AutoBots uses group fallback only if per-coin unavailable
{
  const d = computeAutoStrategy(mk({ groupTrend: 'bearish', confidence: 40, reboundConfirmed: false }));
  ok(d.strategySource === 'AutoBots_SafeFallback', 'safe fallback owner used');
  ok(d.strategySourceDetail === 'group_fallback' || d.strategySourceDetail === 'fallback_conservative', 'group fallback detail used');
}

// AutoBots + bearish near-support should prefer dip_and_rebound, not balanced
{
  const d = computeAutoStrategy(mk({ groupTrend: 'bearish', reboundConfirmed: true, tpRoomOk: true, spreadPct: 0.1, priceFresh: true, confidence: 72 }));
  ok(d.effectiveStrategy === 'dip_and_rebound', 'bearish near-support selects dip_and_rebound');
  ok(d.effectiveStrategy !== 'balanced', 'bearish near-support not silently balanced');
}

// high_risk bearish group -> conservative or wait-safe
{
  const d = computeAutoStrategy(mk({ riskGroup: 'high_risk', groupTrend: 'bearish', reboundConfirmed: false, confidence: 55 }));
  ok(d.effectiveStrategy === 'wait' || d.effectiveStrategy === 'conservative', 'high_risk bearish group conservative/wait-safe');
}

// SafeFallback activates only when data stale/missing or blocked context
{
  const d = computeAutoStrategy(mk({ priceFresh: false, reboundConfirmed: true, tpRoomOk: true, spreadPct: 0.1, momentumConfirmed: false }));
  ok(d.strategySource === 'AutoBots_SafeFallback', 'stale data safe fallback owner');
  ok(d.fallbackUsed === true, 'fallbackUsed true for safe fallback');
}

// Market Analyzer cannot directly authorize BUY (router has no BUY status)
{
  const d = computeAutoStrategy(mk({ marketAnalyzerBestFit: 'momentum' }));
  ok(!('status' in d), 'router decision has no BUY status field');
}

// reason is never used as strategySource
{
  const d = computeAutoStrategy(mk({}));
  ok(['ManualOverride', 'AutoBots', 'AutoBots_SafeFallback', 'Takeover'].includes(d.strategySource), 'strategySource enum owner only');
  ok(d.strategySource !== (d.reason as any), 'strategySource not reason text');
}

// strategySource survives into PlannedCandidate
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
      confidenceResult: { status: 'PASS', reason: null },
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

function candidateFrom(d: ReturnType<typeof computeAutoStrategy>): ScannerCandidate {
  return {
    candidateId: 'c1', symbol: 'BTCUSDT', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mode: 'AUTO',
    riskGroup: 'top_caps', selectedStrategy: d.effectiveStrategy, selectedPlaybook: null, confidence: 0.8, status: 'BUY',
    traderBrainDecision: {} as any, entryGateDecision: gateAllow(), mainReason: 'ok', requiredNextActions: [], blockReasons: [], warnings: [],
    price: 100, priceAgeMs: 10, spreadPct: 0.1, volumeRel: 1, tpRoomOk: true, reboundConfirmed: true, momentumConfirmed: true,
    dipPercent: -1, reboundPercent: 1, m5Change: 1, m15Change: 1, h1Change: 1, change24h: 1, mlBadEntryRisk: false, mlWinProbability: 80,
    autoStrategyDecision: d,
  } as ScannerCandidate;
}

function snapshotOf(cands: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 's', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: 'COOLDOWN', universeMode: 'TOP_50', universeSize: 1,
    scannedCount: cands.length, candidateCount: cands.length, buyCount: cands.length, waitCount: 0, blockCount: 0, avoidCount: 0,
    candidates: cands, summary: '', diagnostics: {} as any,
  };
}

{
  const d = computeAutoStrategy(mk({ groupTrend: 'bullish' }));
  const c = candidateFrom(d);
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshotOf([c]),
    executionPool: [c],
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
    enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
  });
  ok((plan.selectedCandidates[0]?.strategySource ?? '') === d.strategySource, 'strategySource preserved into PlannedCandidate');
  ok((plan.selectedCandidates[0]?.strategySourceDetail ?? '') === d.strategySourceDetail, 'strategySourceDetail preserved into PlannedCandidate');
}

// no ambiguous runtime strings in scanner/analyzer logs
{
  const forbidden = ['backup'];
  const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  const analyzerSrc = readFileSync('src/core/scanner/MarketAnalyzerV3.ts', 'utf8');
  const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
  const paramsCardSrc = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
  const contents = [scannerSrc, analyzerSrc];
  const runtimeLogStrings = contents.map(c => (c.match(/logger\.(?:info|warn|error)\(`([^`]+)`/g) ?? []).join('\n')).join('\n');
  for (const tok of forbidden) {
    ok(!runtimeLogStrings.includes(tok), `no forbidden ambiguous runtime log token ${tok}`);
  }

  ok(scannerSrc.includes('TOP_MOVER_ADVISORY_TRACE:'), 'top mover advisory trace log exists');
  ok(scannerSrc.includes('advisoryOnly=true') && scannerSrc.includes('cannotExecuteBuy=true'), 'top mover trace is advisory-only');
  ok(scannerSrc.includes('strategySourceRawLegacy=') && scannerSrc.includes('strategySourceResolved='), 'legacy raw source is separated from resolved strategy source');
  ok(scannerSrc.includes('fallbackReason=') && scannerSrc.includes('fallbackType='), 'strategy behavior alignment includes explicit fallback metadata');
  ok(scannerSrc.includes('const topMomentumList = [...pocketCandidates]'), 'momentum list uses pocket candidates');
  ok(analyzerSrc.includes('MARKET_ANALYZER_LOG_DEDUPE_AUDIT:'), 'analyzer log dedupe audit exists');
  ok(analyzerSrc.includes('suppressedCount='), 'analyzer dedupe includes suppressed count');
  ok(tradePageSrc.includes("strategySource: 'autobots'"), 'AutoBots ON defaults to strategySource=AutoBots');
  ok(tradePageSrc.includes("!paperAutoEnabled && effectiveStrategySource === 'manual_override' ? airParams.strategy : null"), 'manual override only active when AutoBots is off and explicitly selected');
  ok(paramsCardSrc.includes('Strategy Source'), 'strategy source selector exists in UI');
  ok(scannerSrc.includes("['dip/rebound confirmation', 'LTF confirmation', 'spread ok', 'TP room ok']"), 'why-no-buy uses dip/rebound + LTF confirmation when best-fit dip_and_rebound');
  ok(scannerSrc.includes("['conservative safety confirmation', 'spread ok', 'TP room ok']"), 'why-no-buy uses conservative safety confirmation');
  ok(scannerSrc.includes('const fixRequired = !this.manualMode && mismatchDetected && !overrideAllowed;'), 'mismatch marked fixRequired only when override not allowed');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

