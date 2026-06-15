import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { logger } from '../utils/logger';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';
import type { EntryGateOutput, ExchangeBalance, MarketPrice, OrderRequest, OrderResult, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

class CountingFillAdapter implements ExchangeAdapter {
  readonly name = 'Paper';
  readonly isLive = false;
  lastExecutionResult = null;
  submitCount = 0;
  constructor(private price: number) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async getMarketPrice(coin: string): Promise<MarketPrice> {
    return { coin, bid: this.price * 0.999, ask: this.price * 1.001, last: this.price, timestamp: Date.now() };
  }
  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    this.submitCount++;
    logger.info(`TEST_ADAPTER_SUBMIT_CALLED: symbol=${req.coin}`);
    return { orderId: `test_${this.submitCount}`, coin: req.coin, side: req.side, quantity: req.quantity, price: req.price ?? this.price, status: 'filled', timestamp: Date.now() };
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
    explanation: 'allow',
    requiredNextActions: [],
    snapshot: {
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      requiredNextActions: [],
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.86, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null, pass: true, input: 0.05, required: 0.5, source: 'test' },
      priceFreshnessResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      tpRoomResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      marketSafetyResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      exposureCapitalResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      duplicateSymbolResult: { status: 'PASS', reason: null, pass: true, source: 'test' },
      timestamp: new Date().toISOString(),
      source: 'entry_gate_canonical',
    } as any,
  };
}

function makeCandidate(symbol: string, price: number): ScannerCandidate {
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
    traderBrainDecision: {
      symbol,
      mode: 'AUTO',
      selectedStrategy: 'momentum',
      selectedPlaybook: 'momentum',
      confidence: 0.86,
      status: 'BUY',
      entryPlan: { side: 'BUY', price, quantity: 10, reason: 'atomic entry test' },
      exitPlan: null,
      reasons: ['momentum ready'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'momentum ready' } as any, playbookResult: null, autobotsResult: null },
    },
    entryGateDecision: gateAllow(),
    mainReason: 'MOMENTUM_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price,
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
    rank: 1,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
    autoStrategyDecision: { effectiveStrategy: 'momentum', groupRecommendedStrategy: 'momentum', strategySource: 'autobots', groupTrend: 'bullish', confidenceTier: 'high', reason: 'test' } as any,
    groupTrend: 'bullish',
    strategySource: 'autobots',
  } as unknown as ScannerCandidate;
}

function makeSnapshot(candidate: ScannerCandidate): ScannerSnapshot {
  return {
    scanId: 'atomic_entry_scan',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'BINANCE_TOP_250',
    universeSize: 1,
    scannedCount: 1,
    candidateCount: 1,
    buyCount: 1,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates: [candidate],
    summary: 'atomic entry test',
    diagnostics: {} as any,
  };
}

async function main() {
  logger.clear();
  const symbol = 'ATOMICTESTUSDT';
  const price = 10;
  const feed = MarketDataFeed.getInstance();
  feed.destroy();
  feed.setManualPrice(symbol, price);
  feed.setSymbolFilters(symbol, {
    symbol,
    status: 'TRADING',
    baseAsset: 'ATOMICTEST',
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

  const adapter = new CountingFillAdapter(price);
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  const engine = new TradingEngine(adapter, new MLPredictor(), journal);
  engine.setAccountBalance(10000);

  const candidate = makeCandidate(symbol, price);
  const snapshot = makeSnapshot(candidate);
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot,
    executionPool: [candidate],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 10000,
    usedCapital: 0,
    maxPositions: 5,
    maxSelectedPerScan: 10,
    maxEntriesPerCycle: 10,
    capitalPerTrade: 100,
    maxSpreadPct: 0.5,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });

  ok(plan.selectedCandidates.length === 1, 'planner selects atomic test candidate');
  await engine.executePlannedScannerBuy(candidate, plan.selectedCandidates[0], snapshot);

  const openPosition = engine.getPositionManager().getPositionBySymbol(symbol) as any;
  ok(adapter.submitCount === 1, 'adapter called exactly once after preconditions');
  ok(!!openPosition, 'PositionManager contains canonical open position');
  ok(!!openPosition?.entryConfigSnapshot?.riskParams, 'canonical position has risk snapshot');
  ok(!!openPosition?.entryConfigSnapshot?.strategyAuditSnapshot, 'canonical position has strategy snapshot');
  ok(engine.getDailyTradeCount() === 1, 'dailyTradeCount increments after fill and PositionManager success');
  ok(logger.export().includes('brainApplyEntryCalled=false'), 'entry flow does not use brain.applyEntry as canonical position source');

  const messages = logger.getLogs().map((l) => l.message);
  const preconditionIndex = messages.findIndex((m) => m.includes('SNAPSHOT_PRECONDITION_AUDIT') && m.includes(`symbol=${symbol}`));
  const materializedIndex = messages.findIndex((m) => m.includes('SNAPSHOT_PRECONDITION_MATERIALIZED_AUDIT') && m.includes(`symbol=${symbol}`));
  const adapterIndex = messages.findIndex((m) => m.includes('TEST_ADAPTER_SUBMIT_CALLED') && m.includes(`symbol=${symbol}`));
  const pmIndex = messages.findIndex((m) => m.includes(`POSITION_MANAGER_ADD: ${symbol}`));
  const dailyCompleteIndex = messages.findIndex((m) => m.includes('EXECUTION_TRANSACTION_AUDIT') && m.includes('phase=complete') && m.includes('dailyTradeCountIncremented=true'));
  ok(preconditionIndex >= 0 && adapterIndex > preconditionIndex, 'snapshot precondition audit happens before adapter submit');
  ok(materializedIndex > preconditionIndex && adapterIndex > materializedIndex, 'risk and entry snapshots are materialized before adapter submit');
  ok(pmIndex > adapterIndex, 'PositionManager add happens after adapter fill');
  ok(dailyCompleteIndex > pmIndex, 'transaction complete audit with daily count happens after PositionManager add');

  const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
  const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  ok(!engineSrc.includes('brain.applyEntry(action, result, tradeId)'), 'TradingEngine no longer creates brain-only position via applyEntry before PositionManager');
  ok(engineSrc.indexOf('this.positionManager.addPosition(coin, canonicalPosition)') < engineSrc.indexOf('this._dailyTradeCount++'), 'dailyTradeCount source order is after PositionManager.addPosition success');
  ok(engineSrc.indexOf('SNAPSHOT_PRECONDITION_MATERIALIZED_AUDIT') < engineSrc.indexOf('this.adapter.submitOrder(req)'), 'materialized snapshot source order is before adapter submit');
  ok(!appSrc.includes('DEMO_EXECUTION_ADAPTER_CALLED: symbol=${symbol} source=App.setDemoAutoBuyFn'), 'App wiring no longer logs adapterCalled before TradingEngine preconditions');
  ok(appSrc.includes('adapterWasCalled') && appSrc.includes('adapterCalled: adapterWasCalled'), 'App wiring returns adapterCalled based on real paper adapter state change');

  feed.destroy();
  if (failed > 0) {
    console.error(`atomic-entry-transaction: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`atomic-entry-transaction: ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
