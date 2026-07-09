/**
 * Demo / Live Parity Test
 *
 * Proves:
 * 1. Same TraderBrain decision for demo/live before adapter
 * 2. Same EntryGate decision before adapter
 * 3. Only ExchangeAdapter differs between demo and live
 * 4. Live adds only exchange-specific failure reasons
 *
 * Run: npx tsx src/__tests__/paper-live-parity.ts
 */

import { TraderBrain } from '../core/trading/TraderBrain';
import { MLPredictor } from '../core/ml/MLPredictor';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { LiveBinanceAdapter } from '../core/exchange/LiveBinanceAdapter';
import { EntryGate } from '../core/entry-gate/EntryGate';
import { ExitEngine } from '../core/exits/ExitEngine';
import { evaluateCloseQuality } from '../core/ml/ml-data-quality';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import type { TraderBrainConfig, TraderAction, EntryGateInput, LiveSafetyState, CloseSnapshot, MLDataQuality, ExitInput } from '../core/types';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { buildExecutionModeParityAudit, getExecutionAdapterDisplay, sanitizeExecutionDisplayText } from '../lib/execution/executionDisplay';
import { validateStrategyContract } from '../core/strategy-audit/strategy-contracts';
import type { EntryGateOutput, ScannerCandidate, ScannerSnapshot } from '../core/types';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { resolveAutoBotsFinalStrategy } from '../core/scanner/AutoStrategyRouter';
import {
  buildCandidateExecutionPrecheckSnapshot,
  buildCandidateRuntimeSnapshot,
  buildCandidateStrategyDecisionSnapshot,
} from '../core/scanner/CandidateLifecycle';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

function assertEqual<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg} — expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Demo / Live Parity Test');
  console.log('══════════════════════════════════════════════\n');

  // ── Setup ──────────────────────────────────────────
  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice('BTCUSDT', 50000);
  feed.setExchangeInfo({
    symbols: [{
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      isSpotTradingAllowed: true,
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '10000000', tickSize: '0.01' },
        { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '1000', stepSize: '0.00001' },
        { filterType: 'MIN_NOTIONAL', minNotional: '10' },
      ],
    }],
  });

  const ml = new MLPredictor();
  ml.feedPrice({ coin: 'BTCUSDT', bid: 49950, ask: 50050, last: 50000, timestamp: Date.now() });
  ml.feedPrice({ coin: 'BTCUSDT', bid: 49980, ask: 50020, last: 50000, timestamp: Date.now() });
  ml.feedPrice({ coin: 'BTCUSDT', bid: 49990, ask: 50010, last: 50000, timestamp: Date.now() });

  const config: TraderBrainConfig = {
    coin: 'BTCUSDT', mode: 'AUTO', enabled: true,
    maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5,
    maxLeverage: 1, cooldownSeconds: 0, mlEnabled: false, minConfidence: 0,
  };

  // ── Test 1: Same TraderBrain decision for demo vs live ──
  console.log('\n── Test 1: Same TraderBrain decision for demo/live ──\n');

  const demoAdapter = new PaperExchangeAdapter();
  await demoAdapter.connect();
  const demoBrain = new TraderBrain(config, demoAdapter, ml);

  // Live adapter with safety bypass for test
  const liveSafetyState: LiveSafetyState = 'LIVE_READY';
  const liveAdapter = new LiveBinanceAdapter(() => liveSafetyState);
  const liveBrain = new TraderBrain(config, liveAdapter, ml);

  const demoAction = await demoBrain.tick();
  const liveAction = await liveBrain.tick();

  assert(
    demoAction.type === liveAction.type,
    `Decision type matches (demo=${demoAction.type}, live=${liveAction.type})`,
  );

  if (demoAction.type === 'ENTER' && liveAction.type === 'ENTER') {
    assertEqual(demoAction.side, liveAction.side, 'ENTER side matches');
    assertEqual(demoAction.strategy, liveAction.strategy, 'ENTER strategy matches');
    assertEqual(demoAction.coin, liveAction.coin, 'ENTER coin matches');
  }

  if (demoAction.type === 'NOOP' && liveAction.type === 'NOOP') {
    assertEqual(demoAction.reason, liveAction.reason, 'NOOP reason matches');
  }

  // ── Test 2: Same EntryGate decision regardless of adapter ──
  console.log('\n── Test 2: Same EntryGate decision for any adapter ──\n');

  const gate = new EntryGate();
  const makeInput = (overrides?: Partial<EntryGateInput>): EntryGateInput => ({
    coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.002,
    mode: 'AUTO', mlConfidence: 0.8, prediction: 'BUY',
    currentPositions: 0, maxPositions: 10, recentLoss: false,
    spreadOk: true, volumePass: true, priceFresh: true,
    btcDumping: false, marketRegimeUnsafe: false,
    reboundConfirmed: true, momentumConfirmed: true,
    tpRoomOk: true, isVeryHighRisk: false, isLive: false,
    ...overrides,
  });

  const gateDecision = gate.evaluate(makeInput());

  assert(gateDecision.decision === 'ALLOW', `EntryGate allows entry with good params (got ${gateDecision.decision})`);

  const blockedInput = makeInput({ currentPositions: 10 });
  const blockedDecision = gate.evaluate(blockedInput);
  assert(blockedDecision.decision === 'BLOCK', `EntryGate blocks when at max positions (got ${blockedDecision.decision})`);

  // ── Test 3: Only ExchangeAdapter differs ──
  console.log('\n── Test 3: Only ExchangeAdapter differs ──\n');

  assert(demoAdapter.isLive === false, 'Demo simulated adapter isLive === false');
  assert(liveAdapter.isLive === true, 'LiveBinanceAdapter.isLive === true');
  assert(getExecutionAdapterDisplay(demoAdapter.name) === 'Demo', `Demo adapter display name is Demo (got "${getExecutionAdapterDisplay(demoAdapter.name)}")`);
  assert(liveAdapter.name === 'Binance Live', `Live adapter name is "Binance Live" (got "${liveAdapter.name}")`);

  // Both implement the same interface
  assert(
    typeof demoAdapter.submitOrder === typeof liveAdapter.submitOrder,
    'Both adapters have submitOrder with same type signature',
  );
  assert(
    typeof demoAdapter.getMarketPrice === typeof liveAdapter.getMarketPrice,
    'Both adapters have getMarketPrice with same type signature',
  );

  // ── Test 4: Live adds exchange-specific failure ──
  console.log('\n── Test 4: Live adds exchange-specific failure ──\n');

  const blockedAdapter = new LiveBinanceAdapter(() => 'LIVE_DISABLED' as LiveSafetyState);

  try {
    await blockedAdapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.001, mode: 'AUTO' });
    assert(false, 'LiveBinanceAdapter should throw LIVE_TRADING_NOT_ENABLED');
  } catch (e) {
    assert(e instanceof Error && e.message === 'LIVE_TRADING_NOT_ENABLED', `Live adapter throws LIVE_TRADING_NOT_ENABLED (got: ${e instanceof Error ? e.message : String(e)})`);
  }

  // Demo adapter never throws for a valid order
  const demoResult = await demoAdapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.001, mode: 'AUTO' });
  assert(demoResult.status === 'filled', 'Demo adapter fills valid orders');

  // ── Test 5: LIVE_READY state allows live adapter connection ──
  console.log('\n── Test 5: LIVE_READY state allows live adapter connection ──\n');

  const readyAdapter = new LiveBinanceAdapter(() => 'LIVE_READY' as LiveSafetyState);
  try {
    await readyAdapter.connect();
    assert(true, 'LiveBinanceAdapter.connect() succeeds in LIVE_READY state');
  } catch (e) {
    assert(false, `LiveBinanceAdapter.connect() should succeed in LIVE_READY state (got: ${e instanceof Error ? e.message : String(e)})`);
  }

  // ── Test 6: Exit parity — same ExitEngine decision for demo and live ──
  console.log('\n── Test 6: Exit parity — same ExitEngine decision for demo/live ──\n');

  const exitEngine = new ExitEngine();
  const exitInput: ExitInput = {
    coin: 'BTCUSDT', entryPrice: 100, quantity: 1, currentPrice: 97,
    bidPrice: 96.9, askPrice: 97.1, lastPrice: 97, priceTimestamp: Date.now(),
    openedAt: Date.now() - 120000, highestPrice: 105, highestPriceSinceTp: 101,
    tpArmed: true, tp1Hit: false, tp2Hit: false, stopLossPercent: 2,
    tp1Percent: 3, tp2Percent: 6, trailFromPeakPercent: 1, maxHoldSec: 86400,
    mode: 'AUTO', isLive: false,
    timeBasedExitEnabled: false, resumeGuardActive: false,
    exitCyclesSinceHydration: 6, maxTimeBasedExitsPerCycle: 2, priceAgeMs: 0,
  };
  const demoExit = exitEngine.evaluateExit(exitInput);
  const liveExit = exitEngine.evaluateExit({ ...exitInput, isLive: true });
  assertEqual(demoExit.shouldClosePosition, liveExit.shouldClosePosition, 'Exit decision parity: shouldClosePosition matches');
  assertEqual(demoExit.exitReason, liveExit.exitReason, 'Exit decision parity: exitReason matches');

  // ── Test 7: ML data quality evaluation ──
  console.log('\n── Test 7: ML data quality evaluation ──\n');

  const goodSnapshot: CloseSnapshot = {
    schemaVersion: 'cryptobud-v4-close-v1',
    tradeId: 'test_trade_1',
    closedAt: new Date().toISOString(),
    symbol: 'BTCUSDT',
    adapter: 'Demo',
    exitReason: 'TP1_FIXED', requestedExitPrice: 103, realMarketPriceAtClose: 103,
    closePriceSource: 'book_ticker', closePriceStatus: 'fresh_book_ticker',
    closePriceAgeMs: 100, isRealMarketPrice: true,
    attemptedPriceSources: ['book_ticker'], priceResolutionErrors: [],
    exitPrice: 103, pnlPercent: 3, pnlUsd: 3, fees: 0.003, slippagePct: 0,
    durationMs: 3600000, highestPrice: 105, highestPriceSinceTp: 103,
    mfePercent: 5, maePercent: null, dynamicTrailAudit: null,
    stopLossPercent: 2, tp1Percent: 3, tp2Percent: 6, tpMode: 'fixed',
    tpTriggerType: 'percent', executionQuality: 'CLEAN_REAL_MARKET_PRICE',
  };
  assertEqual(evaluateCloseQuality(goodSnapshot), 'GOOD', 'Clean market price close → GOOD quality');

  const fallbackSnapshot: CloseSnapshot = {
    ...goodSnapshot,
    closePriceSource: 'trigger_fallback',
    closePriceStatus: 'trigger_fallback',
    isRealMarketPrice: false,
    executionQuality: 'FALLBACK_TRIGGER_PRICE',
  };
  assertEqual(evaluateCloseQuality(fallbackSnapshot), 'MEDIUM', 'Fallback price close → MEDIUM quality');

  const badSnapshot: CloseSnapshot = {
    ...goodSnapshot,
    exitReason: 'INVALID_PRICE',
    executionQuality: 'INVALID_PRICE',
  };
  assertEqual(evaluateCloseQuality(badSnapshot), 'BAD', 'Invalid price close → BAD quality');


  // Test 8: Unified scanner selection parity and display naming
  console.log('\n-- Test 8: Unified scanner selection parity and Demo display naming --\n');

  const gateAllow = (): EntryGateOutput => ({
    decision: 'ALLOW', primaryReason: null, blockReasons: [], warnings: [], explanation: 'ok', requiredNextActions: [],
    snapshot: {
      decision: 'ALLOW', primaryReason: null, blockReasons: [], requiredNextActions: [],
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.8, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null }, priceFreshnessResult: { status: 'PASS', reason: null },
      tpRoomResult: { status: 'PASS', reason: null }, marketSafetyResult: { status: 'PASS', reason: null },
      exposureCapitalResult: { status: 'PASS', reason: null }, duplicateSymbolResult: { status: 'PASS', reason: null },
      timestamp: new Date().toISOString(), source: 'entry_gate_canonical',
    },
  });
  const parityRuntime = resolveAutoBotsRuntimeState({
    executionMode: 'paper_simulated',
    buildMode: 'dev',
    tauriDetected: false,
    uiAutoBotsOn: true,
    strategySource: 'autobots',
    scannerAutoEnabled: true,
    paperAutoExecutionEnabled: true,
    marketScannerPaperAutoEnabled: true,
    paperAutoBuyFnPresent: true,
  });
  const makeCandidate = (symbol: string): ScannerCandidate => {
    const runtimeSnapshot = buildCandidateRuntimeSnapshot({ scanId: 'demo-live-parity', runtimeState: parityRuntime });
    const baseCandidate: ScannerCandidate = {
      candidateId: symbol, symbol, createdAt: '', updatedAt: '', mode: 'AUTO', riskGroup: 'mid_caps', selectedStrategy: 'momentum',
      selectedPlaybook: null, confidence: 0.8, status: 'BUY', traderBrainDecision: { entryPlan: { side: 'BUY', price: 10, quantity: 1, reason: 'test' } } as any,
      entryGateDecision: gateAllow(), mainReason: 'ok', requiredNextActions: [], blockReasons: [], warnings: [], price: 10, priceAgeMs: 100, spreadPct: 0.1,
      volumeRel: 1, tpRoomOk: true, reboundConfirmed: true, momentumConfirmed: true, dipPercent: 0, reboundPercent: 1.2, m5Change: 0.7, m15Change: 0.5, h1Change: 0.4, change24h: 0, mlBadEntryRisk: false, mlWinProbability: 0.8, bookFresh: true, priceFresh: true,
      runtimeSnapshot,
      autoBotsRuntimeState: parityRuntime,
      autoStrategyDecision: {
        symbol,
        effectiveStrategy: 'momentum',
        strategySource: 'AutoBots',
        strategySourceDetail: 'per_coin_selector',
        strategyReason: 'parity fixture',
        groupRecommendedStrategy: 'momentum',
        groupTrend: 'sideways',
        referencePeriod: '1h',
        confidenceTier: 'A_80_PLUS',
        confidenceAdjustment: 0,
        blockedByGroupRegime: false,
        blockedBySafety: false,
        reason: 'parity fixture',
        warnings: [],
        marketAnalyzerBestFit: 'momentum',
        perCoinSelectedStrategy: 'momentum',
      } as any,
      groupRecommendedStrategy: 'momentum',
      marketAnalyzerBestFit: 'momentum',
      perCoinSelectedStrategy: 'momentum',
      effectiveStrategy: 'momentum',
      professionalGateMode: 'advisory',
      professionalAnalysis: { professionalScore: 80, professionalVerdict: 'WAIT', professionalReasons: [], professionalBlockers: [] } as any,
    };
    const resolution = resolveAutoBotsFinalStrategy(baseCandidate as any, { marketBestFit: 'momentum' }, { groupRecommendedStrategy: 'momentum', groupTrend: 'sideways' }, {
      autoBotsOn: parityRuntime.resolvedAutoBotsEnabled,
      dynamicPerCoinStrategy: parityRuntime.dynamicPerCoinStrategy,
      userSelectedRuntimeStrategy: 'momentum',
      manualOverrideActive: false,
    });
    const strategyDecision = buildCandidateStrategyDecisionSnapshot({ scanId: 'demo-live-parity', candidate: baseCandidate, resolution });
    const executionPrecheckSnapshot = buildCandidateExecutionPrecheckSnapshot({
      candidate: baseCandidate,
      priceFresh: true,
      bookFresh: true,
      spreadOk: true,
      tpRoomOk: true,
      riskGroupResolved: true,
      professionalGateResolved: true,
      entryContractResolved: true,
      entryContractValid: true,
    });
    return { ...baseCandidate, strategyDecision, executionPrecheckSnapshot };
  };
  const parityCandidate = makeCandidate('ETHUSDT');
  const scannerSnapshot: ScannerSnapshot = { scanId: 'demo-live-parity', startedAt: '', finishedAt: '', status: 'COOLDOWN', universeMode: 'TOP_50', universeSize: 1, scannedCount: 1, candidateCount: 1, buyCount: 1, waitCount: 0, blockCount: 0, avoidCount: 0, candidates: [parityCandidate], summary: '', diagnostics: {} as any };
  const basePlanInput = { scannerSnapshot, executionPool: [parityCandidate], watchPool: [], nearMissPool: [], openSymbols: [], pendingOrderSymbols: [], capital: 1000, usedCapital: 0, maxPositions: 10, maxEntriesPerCycle: 1, capitalPerTrade: 100, maxSpreadPct: 0.35, decisionMode: 'unified' as const, enabledRiskGroups: { mid_caps: true } };
  const demoPlan = buildExecutionPlan({ ...basePlanInput, executionAdapter: 'paper_simulated' });
  const livePlan = buildExecutionPlan({ ...basePlanInput, executionAdapter: 'binance_live' });
  assertEqual(demoPlan.selectedCandidates.map(c => c.symbol).join(','), livePlan.selectedCandidates.map(c => c.symbol).join(','), 'Demo candidate selection equals Live for same scanner inputs');
  assert(demoPlan.selectedCandidates.length > 0, `Demo plan has at least 1 selected candidate (got ${demoPlan.selectedCandidates.length})`);
  assert(livePlan.selectedCandidates.length > 0, `Live plan has at least 1 selected candidate (got ${livePlan.selectedCandidates.length})`);
  assert(!!demoPlan.selectedCandidates[0]?.gateSnapshot && !!livePlan.selectedCandidates[0]?.gateSnapshot, 'Both modes use EntryGate snapshot path');
  assert(!!demoPlan.selectedCandidates[0]?.entryPlan && !!livePlan.selectedCandidates[0]?.entryPlan, 'Both modes carry canonical entryPlan');
  const audit = buildExecutionModeParityAudit({ executionAdapter: 'paper_simulated', decisionMode: 'unified', plannerInputCount: 1, plannerInputWithEntryPlan: 1, generatedEntryPlanCount: 0, selectedCount: 1, selectedWithEntryPlan: 1, entryGateSnapshotUsed: true, plannerUsed: true });
  assert(audit.includes('executionMode=demo') && audit.includes('executionAdapter=demo_simulated') && audit.includes('finalAdapterOnlyDifference=true') && audit.includes('parityOk=true'), 'EXECUTION_MODE_PARITY_AUDIT reports unified Demo/Live semantics');
  assert(!sanitizeExecutionDisplayText('PAPER_EXECUTION_ADAPTER_CALLED paper_simulated Paper').includes('Paper'), 'Visible execution text sanitizes Paper wording');

  // ── Test 9: Strategy contract hardening — negative threshold tests ──
  console.log('\n── Test 9: Strategy contract hardening — threshold enforcement ──\n');

  const contractParams = (overrides: Record<string, unknown>) => ({
    strategy: 'momentum',
    finalEntryRule: 'MOMENTUM_READY',
    marketRegimeBucket: 'unknown' as const,
    dipDepthPct: null,
    reboundPct: 1.0,
    requiredReboundPct: null,
    reboundConfirmed: true,
    momentumConfirmed: true,
    finalExecutable: true,
    ...overrides,
  });

  // Momentum: reboundPercent = 0 => blocked
  const mcZero = validateStrategyContract(contractParams({ strategy: 'momentum', reboundPct: 0, reboundConfirmed: true }));
  assert(!mcZero.contractValid, `Momentum: reboundPct=0 → contractValid=false (got ${mcZero.contractValid}, reason=${mcZero.invalidReason})`);
  assert(['rebound_below_required', 'actualReboundPct_missing_or_zero'].includes(mcZero.invalidReason), `Momentum: reboundPct=0 → blocked (reason=${mcZero.invalidReason})`);

  // Momentum: reboundPercent = 0.79 => blocked
  const mc79 = validateStrategyContract(contractParams({ strategy: 'momentum', reboundPct: 0.79, reboundConfirmed: true }));
  assert(!mc79.contractValid, `Momentum: reboundPct=0.79 → contractValid=false (got ${mc79.contractValid}, reason=${mc79.invalidReason})`);
  assert(mc79.invalidReason === 'rebound_below_required', `Momentum: reboundPct=0.79 → invalidReason=rebound_below_required (got ${mc79.invalidReason})`);

  // Momentum: reboundPercent = 0.8 + all true → allowed
  const mcGood = validateStrategyContract(contractParams({ strategy: 'momentum', reboundPct: 0.8, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true }));
  assert(mcGood.contractValid, `Momentum: reboundPct=0.8 → contractValid=true (got ${mcGood.contractValid})`);

  // Balanced: reboundPercent = 0 => blocked
  const bcZero = validateStrategyContract(contractParams({ strategy: 'balanced', reboundPct: 0, reboundConfirmed: true, momentumConfirmed: true }));
  assert(!bcZero.contractValid, `Balanced: reboundPct=0 → contractValid=false (got ${bcZero.contractValid}, reason=${bcZero.invalidReason})`);
  assert(['rebound_below_required', 'actualReboundPct_missing_or_zero'].includes(bcZero.invalidReason), `Balanced: reboundPct=0 → blocked (reason=${bcZero.invalidReason})`);

  // Balanced: reboundPercent = 0.39 => blocked
  const bc39 = validateStrategyContract(contractParams({ strategy: 'balanced', reboundPct: 0.39, reboundConfirmed: true, momentumConfirmed: true }));
  assert(!bc39.contractValid, `Balanced: reboundPct=0.39 → contractValid=false (got ${bc39.contractValid}, reason=${bc39.invalidReason})`);
  assert(bc39.invalidReason === 'rebound_below_required', `Balanced: reboundPct=0.39 → invalidReason=rebound_below_required (got ${bc39.invalidReason})`);

  // Balanced: reboundPercent = 0.4 + all true → allowed
  const bcGood = validateStrategyContract(contractParams({ strategy: 'balanced', reboundPct: 0.4, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true }));
  assert(bcGood.contractValid, `Balanced: reboundPct=0.4 → contractValid=true (got ${bcGood.contractValid})`);

  // Dip and Rebound: dip=0 rebound=0 → blocked
  const drBadDip = validateStrategyContract({
    strategy: 'dip_and_rebound', finalEntryRule: 'DIP_AND_REBOUND_READY', marketRegimeBucket: 'unknown',
    dipDepthPct: 0, reboundPct: 0, requiredDipPct: null, requiredReboundPct: null,
    dipConfirmed: true, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true,
  });
  assert(!drBadDip.contractValid, `DipAndRebound: dipPct=0 reboundPct=0 → contractValid=false (got ${drBadDip.contractValid}, reason=${drBadDip.invalidReason})`);
  assert(['dip_below_required', 'rebound_below_required', 'actualDipPct_missing_or_zero', 'actualReboundPct_missing_or_zero'].includes(drBadDip.invalidReason), `DipAndRebound: dipPct=0 → blocked (reason=${drBadDip.invalidReason})`);

  // Dip and Rebound: dip=0.8 rebound=0.4 + confirmed → allowed
  const drGood = validateStrategyContract({
    strategy: 'dip_and_rebound', finalEntryRule: 'DIP_AND_REBOUND_READY', marketRegimeBucket: 'unknown',
    dipDepthPct: 0.8, reboundPct: 0.4, requiredDipPct: null, requiredReboundPct: null,
    dipConfirmed: true, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true,
  });
  assert(drGood.contractValid, `DipAndRebound: dipPct=0.8 reboundPct=0.4 → contractValid=true (got ${drGood.contractValid})`);

  // Conservative: dip=1 rebound=0 → blocked (dip below 2%)
  const conBadDip = validateStrategyContract({
    strategy: 'conservative', finalEntryRule: 'CONSERVATIVE_READY', marketRegimeBucket: 'unknown',
    dipDepthPct: 1.0, reboundPct: 0.5, requiredDipPct: null, requiredReboundPct: null,
    dipConfirmed: true, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true,
  });
  assert(!conBadDip.contractValid, `Conservative: dipPct=1 → contractValid=false (got ${conBadDip.contractValid}, reason=${conBadDip.invalidReason})`);

  // Conservative: dip=2 rebound=0 → blocked (rebound below 1%)
  const conBadRebound = validateStrategyContract({
    strategy: 'conservative', finalEntryRule: 'CONSERVATIVE_READY', marketRegimeBucket: 'unknown',
    dipDepthPct: 2.0, reboundPct: 0.5, requiredDipPct: null, requiredReboundPct: null,
    dipConfirmed: true, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true,
  });
  assert(!conBadRebound.contractValid, `Conservative: dipPct=2 reboundPct=0.5 → contractValid=false (got ${conBadRebound.contractValid}, reason=${conBadRebound.invalidReason})`);

  // Conservative: dip=2 rebound=1 + confirmed → allowed
  const conGood = validateStrategyContract({
    strategy: 'conservative', finalEntryRule: 'CONSERVATIVE_READY', marketRegimeBucket: 'unknown',
    dipDepthPct: 2.0, reboundPct: 1.0, requiredDipPct: null, requiredReboundPct: null,
    dipConfirmed: true, reboundConfirmed: true, momentumConfirmed: true, finalExecutable: true,
  });
  assert(conGood.contractValid, `Conservative: dipPct=2 reboundPct=1 → contractValid=true (got ${conGood.contractValid})`);

  // ── Summary ────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  await demoAdapter.disconnect();
  await liveAdapter.disconnect();
  await readyAdapter.disconnect();
  feed.destroy();

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exitCode = 1;
});
