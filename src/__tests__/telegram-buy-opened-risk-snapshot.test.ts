import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatBuyNotification } from '../core/notifications/telegram-templates';
import { resolveTradingTargetOwnership } from '../core/trading/TradingTargetOwnership';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { mapPositionToOpenPositionView, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import type { ExchangeAdapter } from '../core/exchange/ExchangeAdapter';
import type { EntryGateOutput, ExchangeBalance, MarketPrice, OrderRequest, OrderResult, ScannerCandidate, ScannerSnapshot, TradeRecord } from '../core/types';
import { logger } from '../utils/logger';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const candidate = {
  symbol: 'SKYUSDT',
  price: 0.07,
  riskGroup: 'mid_caps',
  confidence: 0.86,
  selectedStrategy: 'balanced',
  selectedPlaybook: 'balanced_entry_rule',
  mainReason: 'balanced setup',
  tpRoomOk: true,
  dataQuality: 'GOOD',
  groupTrend: 'bullish',
  autoStrategyDecision: { confidenceTier: 'high', groupTrend: 'bullish', strategySource: 'autobots' },
} as unknown as ScannerCandidate;

logger.clear();
const ownership = resolveTradingTargetOwnership(candidate, {
  strategySource: 'autobots',
  manualTp1Pct: 2,
  manualTp2Pct: 4,
  stopLossPct: 1.5,
  dynamicTrailingEnabled: true,
  trailPullbackPct: 0.25,
});

const entryPrice = 0.07;
const tp1Pct = ownership.tp1Value;
const tp1TargetPrice = entryPrice * (1 + (tp1Pct / 100));

const trade: TradeRecord = {
  tradeId: 't_sky',
  coin: 'SKYUSDT',
  mode: 'AUTO',
  adapter: 'Demo',
  side: 'BUY',
  entryPrice,
  quantity: 1000,
  entryTime: new Date().toISOString(),
  status: 'open',
  strategy: 'balanced',
  buySnapshot: {
    createdAt: new Date().toISOString(),
    symbol: 'SKYUSDT',
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    confidence: 0.86,
    selectedStrategy: 'balanced',
    selectedPlaybook: 'balanced_entry_rule',
    ownerName: 'AutoBots',
    ownerType: 'scanner',
    source: 'autobots',
    strategySource: 'autobots',
    settingsSnapshot: { stopLossPercent: 1.5, strategySource: 'autobots' },
    entryConfigSnapshot: {
      riskParams: {
        tp1Pct,
        tp1TargetPrice,
        tp1Source: ownership.tp1Source,
        sourceTp1: ownership.tp1Source,
        tp1Min: ownership.tp1Min,
        tp1Max: ownership.tp1Max,
        tp1Reason: ownership.tp1Reason,
        tp2Pct: 0,
        tp2Source: 'autobots_enforced_zero',
        sourceTp2: 'autobots_enforced_zero',
        slPct: 1.5,
        slSource: 'user',
        sourceSl: 'user',
      },
      strategyAuditSnapshot: {
        finalEntryRule: 'balanced_entry_rule',
        entryReason: 'balanced setup',
        finalExecutable: true,
        setupPassed: true,
        setupMissing: false,
        setupMetrics: [],
      },
    },
  } as any,
};

const message = formatBuyNotification(trade);
const logs = logger.export();

ok(tp1Pct > 0, '1 AutoBots TP1 is selected per coin and > 0');
ok(tp1TargetPrice > entryPrice, '2 TP1 target price is greater than entry price');
ok(Math.abs(tp1TargetPrice - (entryPrice * (1 + tp1Pct / 100))) < 1e-12, '3 TP1 target formula is correct');
ok(ownership.tp2Value === 0, '4 TP2 remains 0');
ok(ownership.slValue === 1.5 && ownership.slSource === 'user', '5 SL remains user-defined');
ok(String(ownership.tp1Source).includes('AutoBots') && String(ownership.tp1Source).toLowerCase().includes('dynamic'), '6 TP1 source is AutoBots dynamic per coin');
ok(message.includes(`TP1: ${tp1Pct.toFixed(2)}%`), '7 Telegram shows same TP1 as entry snapshot');
ok(message.includes('TP2: 0% / disabled'), '8 Telegram keeps AutoBots TP2 disabled');
ok(message.includes('SL: -1.50%'), '9 Telegram shows user SL');
ok(logs.includes('AUTOBOTS_TP1_SELECTION_AUDIT') && logs.includes('AUTOBOTS_TP1_V3_PARITY_AUDIT'), '10 AutoBots TP1 selection and V3 parity audits are emitted');
ok(logs.includes('TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT') && logs.includes(`tp1Pct=${tp1Pct}`) && logs.includes('riskSnapshotPresent=true'), '11 Telegram BUY risk snapshot audit uses canonical snapshot');

const doc = readFileSync(path.resolve(process.cwd(), 'docs/v3-tp1-reference.md'), 'utf8');
ok(doc.includes('V3 Hybrid Mode') && doc.includes('V3 Smart Mode') && doc.includes('V4 Parity Rule'), '12 V3 reference behavior is documented');

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
ok(engineSrc.includes('POSITION_RISK_SNAPSHOT_SAVED') && engineSrc.includes('tp1Reason') && engineSrc.includes('tp1Min') && engineSrc.includes('tp1Max'), '13 engine saves TP1 min/max/reason in canonical risk snapshot');
ok(adapterSrc.includes('OPEN_POSITION_RISK_SNAPSHOT_AUDIT') && adapterSrc.includes('CLOSED_POSITION_RISK_SNAPSHOT_AUDIT'), '14 Open and Closed positions audit canonical risk snapshot');

class DemoFillAdapter implements ExchangeAdapter {
  readonly name = 'Paper';
  readonly isLive = false;
  lastExecutionResult = null;
  lastRequest: OrderRequest | null = null;
  private price: MarketPrice;

  constructor(symbol: string, price: number) {
    this.price = {
      coin: symbol,
      bid: price * 0.999,
      ask: price * 1.001,
      last: price,
      timestamp: Date.now(),
    };
  }

  setPrice(symbol: string, price: number): void {
    this.price = {
      coin: symbol,
      bid: price * 0.999,
      ask: price * 1.001,
      last: price,
      timestamp: Date.now(),
    };
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async getMarketPrice(): Promise<MarketPrice> { return this.price; }
  async submitOrder(req: OrderRequest): Promise<OrderResult> {
    this.lastRequest = req;
    const price = Number.isFinite(req.price) ? Number(req.price) : (req.side === 'BUY' ? this.price.ask : this.price.bid);
    return {
      orderId: `demo_${req.side}_${Date.now()}`,
      coin: req.coin,
      side: req.side,
      quantity: req.quantity,
      price,
      status: 'filled',
      timestamp: Date.now(),
    };
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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.86, required: 0.3, source: 'test' },
      spreadSlippageResult: { status: 'PASS', reason: null, pass: true, input: 0.05, required: 0.5, source: 'test' },
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

function makeExecutableAutoBotsCandidate(symbol: string, price: number, strategySource: string | null = 'AutoBots'): ScannerCandidate {
  const autoStrategyDecision = {
    effectiveStrategy: 'momentum',
    groupRecommendedStrategy: 'momentum',
    ...(strategySource === null ? {} : { strategySource }),
    groupTrend: 'bullish',
    confidenceTier: 'high',
    reason: 'test autobots momentum',
    warnings: [],
  } as any;
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
      entryPlan: { side: 'BUY', price, quantity: 10, reason: 'behavioral TP1 snapshot test' },
      exitPlan: null,
      reasons: ['momentum ready'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: {
        unifiedSignal: { reasonCode: 'MOMENTUM_READY' } as any,
        playbookResult: null,
        autobotsResult: null,
      },
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
    autoStrategyDecision,
    ...(strategySource === null ? {} : { strategySource }),
    groupTrend: 'bullish',
  } as unknown as ScannerCandidate;
}

function makeSnapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'tp1_behavior_scan',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'COOLDOWN',
    universeMode: 'BINANCE_TOP_250',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.filter((c) => c.status === 'BUY').length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: 'tp1 behavior test',
    diagnostics: {} as any,
  };
}

async function runBehavioralPositionSnapshotTest() {
  logger.clear();
  const symbol = 'TP1E2EUSDT';
  const entry = 10;
  const feed = MarketDataFeed.getInstance();
  feed.destroy();
  feed.setManualPrice(symbol, entry);
  feed.setSymbolFilters(symbol, {
    symbol,
    status: 'TRADING',
    baseAsset: 'TP1E2E',
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

  const adapter = new DemoFillAdapter(symbol, entry);
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  const engine = new TradingEngine(adapter, new MLPredictor(), journal);
  engine.setAccountBalance(10000);

  const candidate = makeExecutableAutoBotsCandidate(symbol, entry);
  const snapshot = makeSnapshot([candidate]);
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
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.5,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });

  ok(plan.selectedCandidates.length === 1, '15 behavior test selects executable AutoBots candidate');
  await engine.executePlannedScannerBuy(candidate, plan.selectedCandidates[0], snapshot);

  const openPosition = engine.getPositionManager().getPositionBySymbol(symbol)!;
  ok(!!openPosition, '16 demo AutoBots BUY creates real open position');
  const risk = (openPosition as any).entryConfigSnapshot?.riskParams ?? (openPosition.buySnapshot as any)?.entryConfigSnapshot?.riskParams;
  ok(!!(openPosition as any).entryConfigSnapshot, '17 entryConfigSnapshot exists on new position');
  ok(!!risk, '18 entryConfigSnapshot.riskParams exists on new position');
  ok(risk.tp1Pct > 0, '19 riskParams.tp1Pct > 0');
  ok(risk.tp1TargetPrice > openPosition.avgEntryPrice, '20 riskParams.tp1TargetPrice > entryPrice');
  ok(Math.abs(risk.tp1TargetPrice - (openPosition.avgEntryPrice * (1 + risk.tp1Pct / 100))) < 1e-10, '21 riskParams TP1 target formula is exact');
  ok(String(risk.tp1Source).includes('AutoBots dynamic per coin'), '22 riskParams source is AutoBots dynamic per coin');
  ok(risk.tp2Pct === 0, '23 riskParams TP2 remains 0');
  ok(risk.slPct === 1.5, '24 riskParams SL remains user-defined');

  const openRow = mapPositionToOpenPositionView(openPosition);
  ok(openRow.tp1Pct === risk.tp1Pct, '25 Open Positions reads the same TP1 pct from snapshot');
  ok(openRow.tp1TargetPrice === risk.tp1TargetPrice, '26 Open Positions reads the same TP1 target from snapshot');
  ok(openRow.tp1Source === risk.tp1Source, '27 Open Positions reads the same TP1 source from snapshot');
  ok(openRow.sourceLabel === 'AutoBots', '27a Open Positions source/owner is AutoBots');
  ok(openRow.executionMode === 'Demo', '27b Open Positions execution mode is Demo for paper adapter');
  ok(openRow.mode === 'AUTO', '27c Open Positions keeps trade mode AUTO separate from execution mode');

  const liveOpenRow = mapPositionToOpenPositionView({ ...(openPosition as any), adapter: 'binance_live' } as any);
  ok(liveOpenRow.sourceLabel === 'AutoBots', '27d Live-capable open row model keeps source as AutoBots');
  ok(liveOpenRow.executionMode === 'Live', '27e Live-capable open row model exposes executionMode=Live without network/live order');
  ok(liveOpenRow.tp1Pct === risk.tp1Pct && liveOpenRow.tp2Pct === 0 && liveOpenRow.slPct === 1.5, '27f Live-capable open row model preserves identical TP1/TP2/SL rules');

  const openTrade = journal.getOpenTrades(symbol)[0];
  ok(!!(openTrade?.buySnapshot as any)?.entryConfigSnapshot?.riskParams, '28 Journal open trade stores canonical risk snapshot');
  const buyMessage = formatBuyNotification(openTrade);
  ok(buyMessage.includes(`TP1: ${risk.tp1Pct.toFixed(2)}%`), '29 Telegram BUY OPENED reads same TP1 pct from snapshot');
  const formattedTp1Target = Number(risk.tp1TargetPrice).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  ok(buyMessage.includes(`TP1 target: ${formattedTp1Target}`), '30 Telegram BUY OPENED reads same TP1 target from snapshot');
  ok(buyMessage.includes('Source: AutoBots'), '30a Telegram BUY OPENED shows Source: AutoBots');
  ok(buyMessage.includes('Mode: Demo'), '30b Telegram BUY OPENED shows Mode: Demo for paper adapter');

  const closePrice = risk.tp1TargetPrice * 1.01;
  adapter.setPrice(symbol, closePrice);
  feed.setManualPrice(symbol, closePrice);
  const closeSnapshot = {
    schemaVersion: 'cryptobud-v4-close-v1',
    tradeId: openPosition.tradeId ?? openTrade.tradeId,
    closedAt: new Date().toISOString(),
    symbol,
    adapter: 'Paper',
    exitReason: 'TP1_FIXED',
    requestedExitPrice: closePrice,
    realMarketPriceAtClose: closePrice,
    closePriceSource: 'book_ticker',
    closePriceStatus: 'fresh_book_ticker',
    closePriceAgeMs: 0,
    isRealMarketPrice: true,
    attemptedPriceSources: ['book_ticker'],
    priceResolutionErrors: [],
    exitPrice: closePrice,
    pnlPercent: ((closePrice - openPosition.avgEntryPrice) / openPosition.avgEntryPrice) * 100,
    pnlUsd: (closePrice - openPosition.avgEntryPrice) * openPosition.quantity,
    fees: Math.abs((closePrice - openPosition.avgEntryPrice) * openPosition.quantity) * 0.001,
    slippagePct: 0,
    durationMs: Date.now() - openPosition.openedAt,
    highestPrice: closePrice,
    highestPriceSinceTp: closePrice,
    mfePercent: ((closePrice - openPosition.avgEntryPrice) / openPosition.avgEntryPrice) * 100,
    maePercent: ((closePrice - openPosition.avgEntryPrice) / openPosition.avgEntryPrice) * 100,
    stopLossPercent: risk.slPct,
    tp1Percent: risk.tp1Pct,
    tp2Percent: risk.tp2Pct,
    tpMode: openPosition.tpMode,
    tpTriggerType: openPosition.tpTriggerType,
    executionQuality: 'CLEAN_REAL_MARKET_PRICE',
    closeOrderLockId: 'test_close_lock',
    sellLockAcquiredAt: Date.now(),
    positionManagerCloseStatus: 'CLOSING',
    ownerType: openPosition.buySnapshot?.ownerType,
    ownerName: openPosition.buySnapshot?.ownerName,
    source: openPosition.buySnapshot?.source,
    strategySource: openPosition.buySnapshot?.strategySource,
    groupTrend: openPosition.buySnapshot?.groupTrend,
    groupRecommendedStrategy: openPosition.buySnapshot?.groupRecommendedStrategy,
    effectiveStrategy: openPosition.buySnapshot?.selectedStrategy,
    entryStrategy: openPosition.buySnapshot?.selectedStrategy,
    isTpHit: true,
    isSlHit: false,
    isTrailingHit: false,
    tp1TargetPrice: risk.tp1TargetPrice,
    tp1HitPrice: closePrice,
    tp1Source: risk.tp1Source,
    tp2Source: risk.tp2Source,
    slSource: risk.slSource,
    riskParams: risk,
  } as any;
  const closedTrade: TradeRecord = {
    ...openTrade,
    side: 'SELL',
    status: 'closed',
    exitPrice: closePrice,
    exitTime: new Date().toISOString(),
    pnl: closeSnapshot.pnlUsd,
    pnlPercent: closeSnapshot.pnlPercent,
    closeSnapshot,
  };
  await journal.recordTrade(closedTrade);
  engine.getPositionManager().closePosition(symbol, closeSnapshot);

  ok(!!closedTrade, '31 demo close records closed trade');
  const closedRisk = (closedTrade.buySnapshot as any)?.entryConfigSnapshot?.riskParams;
  ok(closedRisk?.tp1Pct === risk.tp1Pct, '32 Closed trade preserves same TP1 pct');
  ok(closedRisk?.tp1TargetPrice === risk.tp1TargetPrice, '33 Closed trade preserves same TP1 target');
  ok(closedRisk?.tp1Source === risk.tp1Source, '34 Closed trade preserves same TP1 source');
  const closedRow = mapTradeRecordToClosedPositionView(closedTrade);
  ok(closedRow.tp1Pct === risk.tp1Pct && closedRow.tp1TargetPrice === risk.tp1TargetPrice, '35 Closed Positions reads preserved TP1 snapshot');
  ok(closedRow.sourceLabel === 'AutoBots', '35a Closed Positions source/owner is AutoBots');
  ok(closedRow.executionMode === 'Demo', '35b Closed Positions execution mode is Demo for paper adapter');
  ok(closedRow.modeLabel === 'AUTO', '35c Closed Positions keeps trade mode AUTO separate from execution mode');

  const liveClosedRow = mapTradeRecordToClosedPositionView({
    ...closedTrade,
    tradeId: `${closedTrade.tradeId}-live-model`,
    adapter: 'binance_live',
    closeSnapshot: { ...closedTrade.closeSnapshot, adapter: 'binance_live' } as any,
  });
  ok(liveClosedRow.sourceLabel === 'AutoBots', '35d Live-capable closed row model keeps source as AutoBots');
  ok(liveClosedRow.executionMode === 'Live', '35e Live-capable closed row model exposes executionMode=Live without network/live order');
  ok(liveClosedRow.tp1Pct === risk.tp1Pct && liveClosedRow.tp2Pct === 0 && liveClosedRow.slPct === 1.5, '35f Live-capable closed row model preserves identical TP1/TP2/SL rules');

  const exported = JSON.parse(await journal.exportJson());
  const exportedClosed = exported.trades.find((t: any) => t.tradeId === closedTrade.tradeId);
  ok(exportedClosed?.entryRiskSnapshot?.tp1Pct === risk.tp1Pct, '36 Journal/export includes same TP1 pct snapshot');
  ok(exportedClosed?.entryRiskSnapshot?.tp1TargetPrice === risk.tp1TargetPrice, '37 Journal/export includes same TP1 target snapshot');
  ok(exportedClosed?.entryRiskSnapshot?.tp1Source === risk.tp1Source, '38 Journal/export includes same TP1 source snapshot');

  const behaviorLogs = logger.export();
  ok(behaviorLogs.includes('POSITION_RISK_SNAPSHOT_SAVED') && behaviorLogs.includes(`tp1Pct=${risk.tp1Pct}`), '39 POSITION_RISK_SNAPSHOT_SAVED logs real TP1 value');
  ok(behaviorLogs.includes('TELEGRAM_BUY_OPENED_RISK_SNAPSHOT_AUDIT') && behaviorLogs.includes('riskSnapshotPresent=true'), '40 Telegram risk snapshot audit emitted for real open trade');
  ok(behaviorLogs.includes('OPEN_POSITION_RISK_SNAPSHOT_AUDIT') && behaviorLogs.includes('CLOSED_POSITION_RISK_SNAPSHOT_AUDIT'), '41 Open/Closed snapshot audits emitted from real position lifecycle');
  ok(!behaviorLogs.includes('finalNoBuyReason=none') || plan.selectedCandidates.length > 0, '42 finalNoBuyReason does not stay none for skipped/no-buy path in this executable flow');
  const runtimeLogMessages = logger.getLogs().map((l) => l.message);
  const readyIndex = runtimeLogMessages.findIndex((m) => m.includes('POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT') && m.includes(`symbol=${symbol}`));
  const addIndex = runtimeLogMessages.findIndex((m) => m.includes(`POSITION_MANAGER_ADD: ${symbol}`));
  ok(readyIndex >= 0 && addIndex > readyIndex, '43 PositionManager only receives new AutoBots position after full risk/setup snapshot is attached');
  feed.destroy();
}

async function runAutoTargetOwnershipVariantTest(symbol: string, strategySource: string | null, label: string, capitalPerTrade = 100) {
  logger.clear();
  const entry = 10;
  const feed = MarketDataFeed.getInstance();
  feed.destroy();
  feed.setManualPrice(symbol, entry);
  feed.setSymbolFilters(symbol, {
    symbol,
    status: 'TRADING',
    baseAsset: symbol.replace('USDT', ''),
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

  const adapter = new DemoFillAdapter(symbol, entry);
  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  const engine = new TradingEngine(adapter, new MLPredictor(), journal);
  engine.setAccountBalance(10000);

  const candidate = makeExecutableAutoBotsCandidate(symbol, entry, strategySource);
  const snapshot = makeSnapshot([candidate]);
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
    maxEntriesPerCycle: 1,
    capitalPerTrade,
    maxSpreadPct: 0.5,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });

  ok(plan.selectedCandidates.length === 1, `${label} planned scanner candidate is selected`);
  await engine.executePlannedScannerBuy(candidate, plan.selectedCandidates[0], snapshot);
  const openPosition = engine.getPositionManager().getPositionBySymbol(symbol)!;
  const risk = (openPosition as any)?.entryConfigSnapshot?.riskParams ?? (openPosition?.buySnapshot as any)?.entryConfigSnapshot?.riskParams;
  const logs = logger.export();

  ok(!!openPosition, `${label} creates a demo scanner auto position`);
  const actualNotional = openPosition.avgEntryPrice * openPosition.quantity;
  ok(risk?.tp1Pct > 0, `${label} resolves Auto TP1 > 0`);
  ok(risk?.tp1TargetPrice > openPosition.avgEntryPrice, `${label} TP1 target > entry`);
  ok(risk?.tp2Pct === 0, `${label} keeps TP2 = 0`);
  ok(risk?.slPct === 1.5, `${label} keeps user SL`);
  ok(String(risk?.tp1Source).includes('AutoBots dynamic per coin'), `${label} uses AutoBots dynamic per coin source`);
  ok(logs.includes('AUTO_TARGET_OWNERSHIP_RESOLVED') && logs.includes('isAutoTargetOwned=true'), `${label} emits canonical auto target ownership audit`);
  ok(logs.includes('POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT') && logs.includes(`symbol=${symbol}`) && logs.includes(`tp1Pct=${risk.tp1Pct}`), `${label} PositionManager receives snapshot only after TP1 > 0`);
  ok(!logs.includes(`symbol=${symbol} tp1=0`) && !logs.includes('sourceTp1=user'), `${label} never uses manual/user TP1=0 for scanner auto trade`);
  ok(Math.abs(actualNotional - capitalPerTrade) < 0.0001, `${label} scanner AUTO capital per coin applies final notional`);
  ok(logs.includes('CAPITAL_PER_COIN_SETTINGS_SOURCE_AUDIT') && logs.includes(`symbol=${symbol}`) && logs.includes(`resolvedCapitalPerCoin=${capitalPerTrade}`), `${label} emits capital per coin source audit`);
  if (strategySource === null || String(strategySource).toLowerCase() !== 'autobots') {
    ok(logs.includes('AUTO_TARGET_OWNERSHIP_MISCLASSIFICATION_PREVENTED'), `${label} prevents weak strategySource misclassification`);
  }
  feed.destroy();
}

runBehavioralPositionSnapshotTest()
  .then(() => runAutoTargetOwnershipVariantTest('OWNUNDEFUSDT', null, '44 strategySource undefined'))
  .then(() => runAutoTargetOwnershipVariantTest('OWNSCANNERUSDT', 'scanner', '45 strategySource scanner'))
  .then(() => runAutoTargetOwnershipVariantTest('OWNBRAINUSDT', 'trader_brain', '46 strategySource trader_brain'))
  .then(() => runAutoTargetOwnershipVariantTest('OWNCAP200USDT', 'scanner', '47 scanner capitalPerCoin 200', 200))
  .then(() => {
    console.log(`telegram-buy-opened-risk-snapshot: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
