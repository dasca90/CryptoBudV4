import { MarketScanner } from '../core/scanner/MarketScanner';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { logger } from '../utils/logger';
import type { MarketPrice, ScannerCandidate, TraderBrainDecision } from '../core/types';

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
  'AAVEUSDT',
  'ZECUSDT',
  'INJUSDT',
  'ATOMUSDT',
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

function klineSeries(currentPrice = 100): unknown[][] {
  return Array.from({ length: 16 }, (_, i) => {
    const progress = i / 15;
    const close = currentPrice * (0.985 + progress * 0.01);
    const open = close * 0.999;
    const low = i === 8 ? currentPrice * 0.98 : close * 0.998;
    return [Date.now() - (16 - i) * 60_000, String(open), String(Math.max(open, close) * 1.001), String(low), String(close), '1000'];
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

  const scanner = new MarketScanner();
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
    manualTp2Pct: 4,
    stopLossPct: 1.5,
    dynamicTrailingEnabled: false,
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
    getKlines: async (symbol: string) => klineSeries((await feed.getPrice(symbol))?.last ?? 100),
    get24hTickers: async () => [],
    getBookTickers: async () => [],
  };
  scanner.setBrainDecide(async (symbol: string, price: MarketPrice): Promise<TraderBrainDecision> => ({
    symbol,
    mode: 'AUTO',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.9,
    status: 'BUY',
    entryPlan: { side: 'BUY', price: price.last, quantity: Number((100 / price.last).toFixed(6)), reason: 'runtime handoff regression' },
    exitPlan: null,
    reasons: ['runtime handoff regression'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'momentum ready' } as any, playbookResult: null, autobotsResult: null },
  } as TraderBrainDecision));

  const receivedSymbols: string[] = [];
  scanner.setPaperAutoBuyFn(async (plannedCandidate, candidate: ScannerCandidate) => {
    receivedSymbols.push(plannedCandidate.symbol);
    return {
      attempted: true,
      executed: false,
      blocked: true,
      symbol: candidate.symbol,
      reason: 'runtime_test_controller_received_no_fill',
      gateResults: ['TEST_CONTROLLER_RECEIVED'],
      stage: 'ExecutionFailed',
      adapterCalled: false,
      adapterResult: 'NOT_SUBMITTED',
      positionCreateAttempted: false,
      positionCreated: false,
      openPositionsBefore: 0,
      openPositionsAfter: 0,
    };
  });

  const snapshot = await scanner.scan('WATCHLIST');
  ok(snapshot.executionPlan?.selectedCandidates.length === 10, 'runtime scan selects 10 candidates');
  ok(snapshot.executionPlan?.maxSelectedPerScan === 10, 'runtime scan uses maxSelectedPerScan=10');
  const messages = logger.getLogs().map((l) => l.message);
  const preRouting = messages.find((m) => m.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT') && m.includes('phase=post_planner_pre_routing'));
  const final = messages.find((m) => m.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT') && m.includes('phase=post_routing_final'));
  ok(!!preRouting, 'pre-routing SELECTED_TO_EXECUTION_HANDOFF_AUDIT emitted from runtime scan path');
  ok(!!final, 'post-routing SELECTED_TO_EXECUTION_HANDOFF_AUDIT emitted from runtime scan path');
  ok(final?.includes('selectedCount=10') ?? false, 'final handoff audit selectedCount=10');
  ok(final?.includes('maxSelectedPerScan=10') ?? false, 'final handoff audit maxSelectedPerScan=10');
  ok(final?.includes('paperAutoExecutionEnabled=true') ?? false, 'final handoff audit paperAutoExecutionEnabled=true');
  ok(final?.includes('paperAutoBuyFnPresent=true') ?? false, 'final handoff audit paperAutoBuyFnPresent=true');
  ok(final?.includes('executionMode=paper_simulated') ?? false, 'final handoff audit executionMode=paper_simulated');
  ok(final?.includes('routeBranch=paper_simulated') ?? false, 'final handoff audit routeBranch=paper_simulated');
  ok(final?.includes('missingAuditSymbols=none') ?? false, 'final handoff audit has no missing symbols');
  ok(final?.includes('invariantOk=true') ?? false, 'final handoff invariant passes');
  ok(extractPipeField(final ?? '', 'controllerReceivedSymbols').length === 10, 'final audit controllerReceivedSymbols has all 10 symbols');
  ok(extractPipeField(final ?? '', 'controllerReceivedSymbols').every((symbol) => symbols.includes(symbol)), 'runtime paper controller receives all 10 selected candidates');
  ok(!messages.some((m) => m.includes('SELECTED_TO_EXECUTION_HANDOFF_ERROR')), 'runtime scan emits no missing handoff error');

  feed.destroy();
  if (failed > 0) {
    console.error(`runtime-selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`runtime-selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
