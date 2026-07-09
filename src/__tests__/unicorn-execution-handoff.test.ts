import assert from 'node:assert/strict';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { buildCandidateExecutionPrecheckSnapshot, buildCandidateRuntimeSnapshot, buildCandidateStrategyDecisionSnapshot } from '../core/scanner/CandidateLifecycle';
import { resolveAutoBotsRuntimeState } from '../core/runtime/autobots-state';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { mapPositionToOpenPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { logger } from '../utils/logger';
import type { EntryGateOutput, ExchangeBalance, MarketPrice, OrderRequest, OrderResult, ScannerCandidate, ScannerSnapshot } from '../core/types';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';

class DemoFillAdapter implements ExchangeAdapter {
  name = 'Demo';
  isLive = false;
  constructor(private symbol: string, private price: number) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async getMarketPrice(symbol: string): Promise<MarketPrice> {
    const price = symbol === this.symbol ? this.price : 1;
    return { coin: symbol, bid: price, ask: price, last: price, timestamp: Date.now() };
  }
  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    return {
      orderId: `demo_${req.coin}`,
      coin: req.coin,
      side: req.side,
      quantity: req.quantity,
      price: this.price,
      status: 'filled',
      timestamp: Date.now(),
    };
  }
  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    return this.placeOrder(req);
  }
  async cancelOrder(): Promise<boolean> { return false; }
  async getBalances(): Promise<ExchangeBalance[]> { return [{ asset: 'USDT', free: 10000, locked: 0 }]; }
  async getOpenOrders(): Promise<OrderResult[]> { return []; }
  async getAccountInfo(): Promise<{ canTrade: boolean; isLive: boolean }> { return { canTrade: true, isLive: false }; }
}

function gateAllow(): EntryGateOutput {
  return {
    decision: 'ALLOW',
    primaryReason: null,
    blockReasons: [],
    warnings: [],
    explanation: 'EntryGate ALLOW',
    requiredNextActions: [],
    snapshot: {
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      requiredNextActions: [],
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.92, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null, pass: true, input: 0.05, required: 0.35, source: 'test' },
      priceFreshnessResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      tpRoomResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      marketSafetyResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      exposureCapitalResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      duplicateSymbolResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      timestamp: new Date().toISOString(),
      source: 'entry_gate_canonical',
    },
  };
}

function makeUnicornCandidate(symbol = 'UNIUSDT'): ScannerCandidate {
  const scanId = 'scan_unicorn_handoff';
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
    riskGroup: 'very_high_risk',
    selectedStrategy: 'momentum',
    effectiveStrategy: 'momentum',
    finalExecutionStrategy: 'momentum',
    setupValidatorUsed: 'momentum',
    finalEntryRule: 'UNICORN_HUNTER_READY',
    entryRule: 'UNICORN_HUNTER_READY',
    confidence: 0.92,
    rawScore: 92,
    status: 'BUY',
    lifecycleStatus: 'BUY_READY',
    traderBrainDecision: {
      symbol,
      mode: 'AUTO',
      selectedStrategy: 'momentum',
      selectedPlaybook: 'unicorn_hunter_entry',
      confidence: 0.92,
      status: 'BUY',
      entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 'unicorn_hunter_ready' },
      exitPlan: null,
      reasons: ['unicorn_ready'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: { unifiedSignal: { reasonCode: 'UNICORN_HUNTER_READY', definition: { buyRule: 'momentum' } } },
    },
    entryPlan: { side: 'BUY', price: 1, quantity: 100, reason: 'unicorn_hunter_ready' },
    entryGateDecision: gateAllow(),
    mainReason: 'UNICORN_HUNTER_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 1,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 5,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: -4,
    reboundPercent: 1.2,
    m5Change: 2,
    m15Change: 3,
    h1Change: 5,
    change24h: 45,
    mlBadEntryRisk: false,
    mlWinProbability: 0.9,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    referencePeriod: '1h',
    groupTrend: 'bullish',
    groupRecommendedStrategy: 'momentum',
    marketBestFit: 'momentum',
    perCoinSelectedStrategy: 'momentum',
    strategySource: 'unicorn_hunter' as any,
    strategySourceDetail: 'unicorn_hunter_parallel_lane' as any,
    strategyReason: 'unicorn_hunter_ready',
    candidateSource: 'unicorn_hunter',
    executionSource: 'unicorn_hunter',
    source: 'unicorn_hunter',
    ownerType: 'unicorn',
    ownerName: 'UNICORN_HUNTER',
    sourceOwner: 'UnicornHunter',
    sourceLabel: 'Unicorn Hunter',
    executionOwner: 'UnicornHunter',
    positionOwner: 'UnicornHunter',
    unicornScore: 92,
    unicornMetrics: { breakout: true },
    finalExecutable: true,
    buyAllowed: true,
    runtimeSnapshot: buildCandidateRuntimeSnapshot({ scanId, runtimeState, sourceOwner: 'UnicornHunter' }),
    autoBotsRuntimeState: runtimeState,
    autoStrategyDecision: {
      symbol,
      effectiveStrategy: 'momentum',
      strategySource: 'UnicornHunter',
      strategySourceDetail: 'unicorn_hunter_parallel_lane',
      strategyReason: 'unicorn_hunter_ready',
      reason: 'unicorn_hunter_ready',
      groupRecommendedStrategy: 'momentum',
      groupTrend: 'bullish',
      confidenceTier: 'A_80_PLUS',
      warnings: [],
      marketAnalyzerBestFit: 'momentum',
      perCoinSelectedStrategy: 'momentum',
    } as any,
    tradingTargetOwnership: {
      strategySource: 'unicorn_hunter',
      tp1Source: 'AutoBots dynamic per coin',
      tp1Value: 1.8,
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
    },
  } as unknown as ScannerCandidate;
  candidate.strategyDecision = buildCandidateStrategyDecisionSnapshot({
    scanId,
    candidate,
    resolution: {
      symbol,
      riskGroup: 'very_high_risk',
      groupTrend: 'bullish',
      groupRecommendedStrategy: 'momentum',
      groupConfidence: 0.92,
      marketBestFit: 'momentum',
      userSelectedRuntimeStrategy: 'momentum',
      dynamicPerCoinStrategy: true,
      perCoinSelectedStrategy: 'momentum',
      finalExecutionStrategy: 'momentum',
      strategySourceResolved: 'UNICORN_HUNTER',
      fallbackApplied: false,
      fallbackType: 'NONE',
      fallbackReason: null,
      overrideApplied: true,
      overrideReason: 'unicorn_hunter_parallel_lane',
      mismatchAllowed: true,
      mismatchReason: 'unicorn_hunter_parallel_lane',
      routerPath: 'unicorn_hunter_parallel_lane',
      strategyDecisionTrace: ['source=unicorn_hunter'],
      evaluatedStrategies: [],
      selectedStrategy: 'momentum',
      selectionReason: 'unicorn_hunter_ready',
      noValidStrategyReason: null,
      noValidStrategyTrace: [],
      fallbackCanSubmitBuy: true,
      fallbackSubmitGuardReason: 'unicorn_hunter_ready',
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

function snapshot(candidate: ScannerCandidate): ScannerSnapshot {
  return {
    scanId: 'scan_unicorn_handoff',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'SCANNING',
    universeMode: 'TOP_50',
    universeSize: 1,
    scannedCount: 1,
    candidateCount: 1,
    buyCount: 1,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates: [candidate],
    summary: 'test',
    diagnostics: {} as any,
  };
}

function makeAutoBotsCandidate(symbol = 'AUTOUSDT'): ScannerCandidate {
  const candidate = makeUnicornCandidate(symbol) as any;
  const now = new Date().toISOString();
  candidate.candidateId = `cand_${symbol}`;
  candidate.symbol = symbol;
  candidate.selectedStrategy = 'dip_and_rebound';
  candidate.effectiveStrategy = 'dip_and_rebound';
  candidate.finalExecutionStrategy = 'dip_and_rebound';
  candidate.strategyAtEntry = 'dip_and_rebound';
  candidate.setupValidatorUsed = 'dip_and_rebound';
  candidate.finalEntryRule = 'DIP_AND_REBOUND_CONFIRMED';
  candidate.entryRule = 'DIP_AND_REBOUND_CONFIRMED';
  candidate.setupResult = 'DIP_AND_REBOUND_OK';
  candidate.lifecycleStatus = 'BUY_READY';
  candidate.finalNoBuyReason = undefined;
  candidate.actionableNoBuyReason = undefined;
  candidate.technicalNoBuyReason = undefined;
  candidate.primaryBlocker = undefined;
  candidate.strategyAuditSnapshot = undefined;
  candidate.canonicalDisplayStatus = undefined;
  candidate.promotionAudit = undefined;
  candidate.blockReasons = [];
  candidate.requiredNextActions = [];
  candidate.warnings = [];
  candidate.strategySource = 'autobots';
  candidate.strategySourceDetail = 'autobots_test';
  candidate.strategyReason = 'autobots_ready';
  candidate.candidateSource = 'scanner';
  candidate.executionSource = 'auto';
  candidate.source = 'AutoBots';
  candidate.ownerName = 'AUTOBOTS';
  candidate.groupRecommendedStrategy = 'dip_and_rebound';
  candidate.marketBestFit = 'dip_and_rebound';
  candidate.marketAnalyzerBestFit = 'dip_and_rebound';
  candidate.perCoinSelectedStrategy = 'dip_and_rebound';
  candidate.reboundFreshnessStatus = 'valid';
  candidate.reboundTimestamp = now;
  candidate.dipLowTimestamp = now;
  candidate.reboundAgeMs = 0;
  candidate.maxAllowedReboundAgeMs = 900000;
  candidate.spreadPct = 0;
  candidate.unicornScore = undefined;
  candidate.unicornMetrics = undefined;
  candidate.rawScore = 99;
  candidate.confidence = 0.99;
  candidate.mainReason = 'AUTOBOTS_READY';
  candidate.traderBrainDecision = {
    ...candidate.traderBrainDecision,
    symbol,
    selectedStrategy: 'dip_and_rebound',
    selectedPlaybook: 'momentum_entry',
    reasons: ['autobots_ready'],
    ruleDecisionTrace: { unifiedSignal: { reasonCode: 'DIP_AND_REBOUND_CONFIRMED', definition: { buyRule: 'dip_and_rebound' } } },
  };
  candidate.autoStrategyDecision = {
    ...candidate.autoStrategyDecision,
    symbol,
    effectiveStrategy: 'dip_and_rebound',
    perCoinSelectedStrategy: 'dip_and_rebound',
    finalExecutionStrategy: 'dip_and_rebound',
    strategySource: 'AutoBots',
    strategySourceDetail: 'autobots_test',
    strategyReason: 'autobots_ready',
    reason: 'autobots_ready',
    groupRecommendedStrategy: 'dip_and_rebound',
    groupTrend: 'bullish',
    marketAnalyzerBestFit: 'dip_and_rebound',
    confidenceTier: 'A_80_PLUS',
    warnings: [],
  };
  candidate.tradingTargetOwnership = {
    strategySource: 'autobots',
    tp1Source: 'AutoBots dynamic per coin',
    tp1Value: 1.8,
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
  };
  candidate.strategyDecision = buildCandidateStrategyDecisionSnapshot({
    scanId: 'scan_unicorn_handoff',
    candidate,
    resolution: {
      symbol,
      riskGroup: 'very_high_risk',
      groupTrend: 'bullish',
      groupRecommendedStrategy: 'dip_and_rebound',
      groupConfidence: 0.99,
      marketBestFit: 'dip_and_rebound',
      userSelectedRuntimeStrategy: 'dip_and_rebound',
      dynamicPerCoinStrategy: true,
      perCoinSelectedStrategy: 'dip_and_rebound',
      finalExecutionStrategy: 'dip_and_rebound',
      strategySourceResolved: 'AUTOBOTS_DYNAMIC',
      fallbackApplied: false,
      fallbackType: 'NONE',
      fallbackReason: null,
      overrideApplied: false,
      overrideReason: null,
      mismatchAllowed: true,
      mismatchReason: 'autobots_test',
      routerPath: 'smart_strategy_router',
      strategyDecisionTrace: ['source=autobots'],
      evaluatedStrategies: [],
      selectedStrategy: 'dip_and_rebound',
      selectionReason: 'autobots_ready',
      noValidStrategyReason: null,
      noValidStrategyTrace: [],
      fallbackCanSubmitBuy: true,
      fallbackSubmitGuardReason: 'autobots_ready',
    } as any,
  });
  return candidate as ScannerCandidate;
}

function planFor(candidate: ScannerCandidate, openSymbols: string[] = []) {
  return buildExecutionPlan({
    scannerSnapshot: snapshot(candidate),
    executionPool: [candidate],
    watchPool: [],
    nearMissPool: [],
    openSymbols,
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 10,
    maxEntriesPerCycle: 5,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { very_high_risk: true } as any,
  });
}

logger.clear();
const ready = makeUnicornCandidate();
const readyPlan = planFor(ready);
assert.equal(ready.entryGateDecision?.decision, 'ALLOW', 'READY Unicorn candidate reaches EntryGate with ALLOW');
assert.equal(readyPlan.selectedCandidates.length, 1, 'READY Unicorn candidate is selected for execution when limits allow');
assert.equal(readyPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.source, 'Unicorn Hunter' as any);
assert.equal(readyPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.strategySource, 'unicorn_hunter');
assert.equal(readyPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.riskParams?.tp2Pct, 0, 'Unicorn selected plan persists TP2=0 in canonical risk snapshot');
const readyRisk = readyPlan.selectedCandidates[0]?.scannerAutoEntryConfigSnapshot?.riskParams as any;
assert.equal(readyRisk?.tp1Source, 'Unicorn dynamic per coin', 'Unicorn selected plan persists Unicorn TP1 source');
assert.equal(readyRisk?.tp1Min, 5, 'Unicorn selected plan persists TP1 min 5');
assert.equal(readyRisk?.tp1Max, 10, 'Unicorn selected plan persists TP1 max 10');
assert.ok(Number(readyRisk?.tp1Pct) >= 5 && Number(readyRisk?.tp1Pct) <= 10, 'Unicorn selected plan TP1 is inside 5-10 range');
assert.notEqual(readyRisk?.tp1Source, 'AutoBots dynamic per coin', 'Unicorn selected plan never persists AutoBots TP1 source');

logger.clear();
const autoFirst = makeAutoBotsCandidate('AUTOUSDT');
const unicornBudgeted = makeUnicornCandidate('BUDGETUNIUSDT');
const secondUnicornBudgeted = makeUnicornCandidate('BUDGETUNI2USDT');
const budgetSnapshot: ScannerSnapshot = {
  ...snapshot(autoFirst),
  scanId: 'scan_unicorn_budget',
  universeSize: 3,
  scannedCount: 3,
  candidateCount: 3,
  buyCount: 3,
  candidates: [autoFirst, unicornBudgeted, secondUnicornBudgeted],
};
const sharedBudgetPlan = buildExecutionPlan({
  scannerSnapshot: budgetSnapshot,
  executionPool: [autoFirst, unicornBudgeted, secondUnicornBudgeted],
  watchPool: [],
  nearMissPool: [],
  openSymbols: [],
  pendingOrderSymbols: [],
  capital: 1000,
  usedCapital: 0,
  maxPositions: 10,
  maxSelectedPerScan: 1,
  maxUnicornSelectedPerScan: 1,
  maxEntriesPerCycle: 1,
  capitalPerTrade: 100,
  maxSpreadPct: 0.35,
  decisionMode: 'unified',
  executionAdapter: 'paper_simulated',
  enabledRiskGroups: { very_high_risk: true } as any,
});
assert.equal(sharedBudgetPlan.selectedCandidates.length, 2, 'AutoBots and Unicorn can both be selected in the same cycle with separate budgets');
assert.ok(sharedBudgetPlan.selectedCandidates.some((candidate) => candidate.symbol === 'AUTOUSDT'), 'Higher-ranked AutoBots candidate remains selected through its own slot');
assert.ok(sharedBudgetPlan.selectedCandidates.some((candidate) => candidate.symbol === 'BUDGETUNIUSDT'), 'Unicorn READY is selected even after AutoBots consumes its own slot');
const budgetSkipped = sharedBudgetPlan.skippedCandidates.find((candidate) => candidate.symbol === 'BUDGETUNI2USDT');
assert.equal(budgetSkipped?.finalNoBuyReason, 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED', 'Second Unicorn is blocked only by Unicorn cycle budget');
assert.match(logger.export(), /EXECUTION_BUDGET_PARITY_AUDIT: .*sharedBudget=false/, 'Execution budget parity audit declares separate budgets');
assert.doesNotMatch(logger.export(), /GLOBAL_BUY_BUDGET_TAKEN_BY_AUTOBOTS/, 'Unicorn is never blocked by AutoBots slot ownership');

const duplicatePlan = planFor(makeUnicornCandidate('DUPUNIUSDT'), ['DUPUNIUSDT']);
assert.equal(duplicatePlan.selectedCandidates.length, 0, 'Duplicate open Unicorn is not selected');
assert.equal(duplicatePlan.skippedCandidates[0]?.finalNoBuyReason ?? duplicatePlan.noBuyReasons[0], 'UNICORN_BLOCK_DUPLICATE_POSITION');

logger.clear();
const incomplete = makeUnicornCandidate('MISSUNIUSDT') as any;
delete incomplete.source;
delete incomplete.candidateSource;
delete incomplete.strategySource;
delete incomplete.finalExecutionStrategy;
delete incomplete.setupValidatorUsed;
delete incomplete.strategyDecision;
incomplete.finalExecutable = true;
incomplete.buyAllowed = true;
const incompletePlan = planFor(incomplete as ScannerCandidate);
assert.equal(incompletePlan.selectedCandidates.length, 0, 'Incomplete Unicorn payload is blocked');
const logText = logger.getLogs().map((l) => l.message).join('\n');
assert.match(logText, /UNICORN_HANDOFF_INTEGRITY_AUDIT/);
assert.match(logText, /failureReason=STRATEGY_HANDOFF_INTEGRITY_FAILED/);
assert.match(logText, /missingFields=.*source/);
assert.match(logText, /missingFields=.*candidateSource/);
assert.match(logText, /missingFields=.*strategySource/);
assert.match(logText, /missingFields=.*strategyDecision/);

logger.clear();
const feed = MarketDataFeed.getInstance();
feed.destroy();
feed.setManualPrice('OPENUNIUSDT', 1);
feed.setSymbolFilters('OPENUNIUSDT', {
  symbol: 'OPENUNIUSDT',
  status: 'TRADING',
  baseAsset: 'OPENUNI',
  quoteAsset: 'USDT',
  minNotional: 10,
  minQty: 0.00001,
  maxQty: 1000000,
  stepSize: 0.00001,
  tickSize: 0.00001,
  minPrice: 0.00001,
  maxPrice: 1000000,
  quotePrecision: 8,
  baseAssetPrecision: 8,
  quoteAssetPrecision: 8,
  isSpotTradingAllowed: true,
});
const openCandidate = makeUnicornCandidate('OPENUNIUSDT');
const openPlan = planFor(openCandidate);
const journal = new Journal();
journal.markOpenPositionsHydrated();
const engine = new TradingEngine(new DemoFillAdapter('OPENUNIUSDT', 1), new MLPredictor(), journal);
engine.setAccountBalance(1000);
await engine.executePlannedScannerBuy(openCandidate, openPlan.selectedCandidates[0], snapshot(openCandidate));
const openPosition = engine.getPositionManager().getPositionBySymbol('OPENUNIUSDT');
assert.ok(openPosition, 'Unicorn execution creates an open position');
assert.match(logger.export(), /UNICORN_BUY_SUBMITTED symbol=OPENUNIUSDT/, 'Valid Unicorn candidate reaches the adapter submit path');
const row = mapPositionToOpenPositionView(openPosition!);
assert.equal(row.sourcePresentation?.badgeVariant, 'unicorn');
assert.match(row.sourceLabel ?? '', /Uni|Unicorn/i);
assert.equal((openPosition as any).buySnapshot?.source, 'unicorn_hunter');
assert.equal((openPosition as any).buySnapshot?.ownerName, 'UNICORN_HUNTER');
const persistedRisk = ((openPosition as any).entryConfigSnapshot?.riskParams
  ?? (openPosition as any).buySnapshot?.entryConfigSnapshot?.riskParams) as any;
assert.equal(persistedRisk?.tp1Source, 'Unicorn dynamic per coin', 'PositionManager persisted Unicorn TP1 source');
assert.equal(persistedRisk?.tp1Min, 5, 'PositionManager persisted Unicorn TP1 min 5');
assert.equal(persistedRisk?.tp1Max, 10, 'PositionManager persisted Unicorn TP1 max 10');
assert.ok(Number(persistedRisk?.tp1Pct) >= 5 && Number(persistedRisk?.tp1Pct) <= 10, 'PositionManager persisted Unicorn TP1 inside 5-10 range');
assert.notEqual(persistedRisk?.tp1Source, 'AutoBots dynamic per coin', 'PositionManager does not persist AutoBots TP1 source for Unicorn trade');

console.log('unicorn-execution-handoff tests passed');
