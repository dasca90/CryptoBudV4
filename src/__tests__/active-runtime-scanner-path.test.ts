import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { logger } from '../utils/logger';
import type { MarketPrice, TraderBrainDecision } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const symbols = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'LINKUSDT',
  'SOLUSDT',
  'AVAXUSDT',
  'AAVEUSDT',
  'ZECUSDT',
  'INJUSDT',
];

function filtersFor(symbol: string) {
  return {
    symbol,
    status: 'TRADING',
    baseAsset: symbol.replace(/USDT$/, ''),
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
  };
}

function klineSeries(base = 100): unknown[][] {
  return Array.from({ length: 16 }, (_, i) => {
    const open = base + i * 0.2;
    const close = open + 0.18;
    return [Date.now() - (16 - i) * 60_000, String(open), String(close), String(open - 0.1), String(close), '1000'];
  });
}

function extractPipeField(line: string, field: string): string[] {
  const match = line.match(new RegExp(`${field}=([^\\s]+)`));
  if (!match || match[1] === 'none') return [];
  return match[1].split('|').filter(Boolean);
}

async function main() {
  logger.clear();
  const feed = MarketDataFeed.getInstance();
  feed.destroy();
  symbols.forEach((symbol, i) => {
    const price = 10 + i;
    feed.setManualPrice(symbol, price);
    feed.setSymbolFilters(symbol, filtersFor(symbol));
  });

  const engine = new TradingEngine(new PaperExchangeAdapter(), new MLPredictor(), new Journal());
  const autoRuntime = engine.getAutoRuntime();
  const scanner = autoRuntime.getScanner();

  scanner.setUniverseMode('WATCHLIST');
  scanner.setWatchlist(symbols);
  scanner.setPaperAutoEnabled(true);
  scanner.setManualStrategy(null);
  scanner.setScannerConfig({
    riskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
    referencePeriod: '1h',
  });
  scanner.setTradingTargetConfig({
    strategySource: 'autobots',
    confirmationMode: 'smart',
    manualTp1Pct: 2,
    manualTp2Pct: 0,
    stopLossPct: 1.5,
    dynamicTrailingEnabled: true,
    trailPullbackPct: 0.25,
  });
  scanner.setExecutionLimits({
    maxPositions: 10,
    maxSelectedPerScan: 10,
    maxEntriesPerCycle: 10,
    capital: 10000,
    capitalPerTrade: 100,
    source: 'ui_setting',
    userExplicit: true,
  });
  scanner.setExecutionContextProviders({
    getUsedCapital: () => 0,
    getOpenSymbols: () => [],
    getPendingSymbols: () => [],
  });
  (scanner as any).publicClient = {
    getKlines: async () => klineSeries(),
    get24hTickers: async () => [],
    getBookTickers: async () => [],
  };
  scanner.setBrainDecide(async (symbol: string, price: MarketPrice): Promise<TraderBrainDecision> => ({
    symbol,
    mode: 'AUTO',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.92,
    status: 'BUY',
    entryPlan: { side: 'BUY', price: price.last, quantity: Number((100 / price.last).toFixed(6)), reason: 'active runtime path regression' },
    exitPlan: null,
    reasons: ['active runtime path regression'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'momentum ready' } as any, playbookResult: null, autobotsResult: null },
  } as TraderBrainDecision));

  autoRuntime.setScanInterval(60_000);

  const snapshotPromise = new Promise<void>((resolve) => {
    autoRuntime.setCallbacks({
      onCandidatesReady: () => resolve(),
      executeBuy: async () => {},
      getAvailableSlots: () => 10,
    });
  });

  await autoRuntime.start('WATCHLIST');
  await snapshotPromise;
  await autoRuntime.stop();

  const messages = logger.getLogs().map((l) => l.message);
  const instanceAudit = messages.find((m) => m.includes('ACTIVE_SCANNER_INSTANCE_AUDIT') && m.includes('stage=scan'));
  const finalAudit = messages.find((m) => m.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT') && m.includes('phase=post_routing_final'));
  const fatalMissing = messages.find((m) => m.includes('SELECTED_TO_EXECUTION_HANDOFF_MISSING_FATAL'));
  const preconditionAudit = messages.find((m) => m.includes('SNAPSHOT_PRECONDITION_AUDIT') && m.includes('entryConfigSnapshotPresent=true'));
  const completeTransactionAudit = messages.find((m) => m.includes('EXECUTION_TRANSACTION_AUDIT') && m.includes('phase=complete') && m.includes('adapterCalled=true') && m.includes('positionManagerAddSucceeded=true'));

  ok(!!instanceAudit, 'active runtime path emits ACTIVE_SCANNER_INSTANCE_AUDIT');
  ok(instanceAudit?.includes('hasSelectedToExecutionHandoffPatch=true') ?? false, 'active scanner audit confirms handoff patch present');
  ok(instanceAudit?.includes('paperAutoExecutionEnabled=true') ?? false, 'active scanner audit shows paper auto enabled');
  ok(instanceAudit?.includes('paperAutoBuyFnPresent=true') ?? false, 'active scanner audit shows paper auto buy callback present on active scanner');
  ok(instanceAudit?.includes('executionMode=paper_simulated') ?? false, 'active scanner audit shows paper_simulated execution mode');
  ok(instanceAudit?.includes('autoBotsOn=true') ?? false, 'active scanner audit shows AutoBots on');
  ok(instanceAudit?.includes('logSinkName=logger.getLogs/logger.export') ?? false, 'active scanner audit uses same UI export sink');
  ok(!!finalAudit, 'active runtime path emits selected-to-execution handoff audit');
  ok(finalAudit?.includes('selectedCount=10') ?? false, 'active runtime handoff audit selectedCount=10');
  ok(finalAudit?.includes('paperAutoBuyFnPresent=true') ?? false, 'active runtime handoff audit sees callback present');
  ok(finalAudit?.includes('missingAuditSymbols=none') ?? false, 'active runtime handoff audit has no missing symbols');
  ok(finalAudit?.includes('invariantOk=true') ?? false, 'active runtime handoff invariant passes');
  ok(extractPipeField(finalAudit ?? '', 'controllerReceivedSymbols').length > 0 || extractPipeField(finalAudit ?? '', 'skippedBeforeHandoffSymbols').length > 0, 'active runtime handoff places every selected symbol into a visible bucket');
  ok(!fatalMissing, 'active runtime path emits no missing handoff fatal');
  ok(!!preconditionAudit, 'active runtime path emits snapshot precondition audit with entryConfigSnapshotPresent=true');
  ok(preconditionAudit?.includes('missingFields=none') ?? false, 'active runtime snapshot precondition has missingFields=none');
  ok(preconditionAudit?.includes('adapterWillBeCalled=true') ?? false, 'active runtime snapshot precondition allows adapter call');
  ok(!!completeTransactionAudit, 'active runtime path emits complete execution transaction audit');
  ok(completeTransactionAudit?.includes('adapterCalled=true') ?? false, 'active runtime complete transaction audit shows adapterCalled=true');
  ok(completeTransactionAudit?.includes('positionManagerAddSucceeded=true') ?? false, 'active runtime complete transaction audit shows positionManagerAddSucceeded=true');

  const exportJson = logger.export();
  ok(exportJson.includes('ACTIVE_SCANNER_INSTANCE_AUDIT'), 'logger export contains active scanner audit');
  ok(exportJson.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT'), 'logger export contains selected handoff audit');
  ok(exportJson.includes('SCANNER_POOL_BUILT'), 'logger export contains scanner pool audit from the same sink');

  feed.destroy();
  if (failed > 0) {
    console.error(`active-runtime-scanner-path: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`active-runtime-scanner-path: ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
