import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { logger } from '../utils/logger';
import type { EntryGateOutput, PlannedCandidate, ScannerCandidate, TraderBrainDecision } from '../core/types';

// This test validates ownership routing and canonical scanner_auto classification only.
// It does not validate the full scanner entryConfigSnapshot materialization contract.

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.9, required: 0.3, source: 'test' },
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
    confidence: 0.91,
    status: 'BUY',
    traderBrainDecision: {
      symbol,
      mode: 'AUTO',
      selectedStrategy: 'momentum',
      selectedPlaybook: 'momentum',
      confidence: 0.91,
      status: 'BUY',
      entryPlan: { side: 'BUY', price, quantity: 10, reason: 'scanner ownership context regression' },
      exitPlan: null,
      reasons: ['scanner ownership context regression'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'ready' } as any, playbookResult: null, autobotsResult: null },
    },
    entryGateDecision: gateAllow(),
    mainReason: 'MOMENTUM_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 1.2,
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
    mlWinProbability: 0.91,
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

async function main() {
  logger.clear();

  const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
  ok(engineSrc.includes("executionPath: 'scanner_auto'"), 'TradingEngine routes scanner handoff through canonical scanner_auto execution path');
  ok(engineSrc.includes('AUTO_EXECUTION_CONTEXT_CANONICAL_AUDIT'), 'TradingEngine emits canonical auto execution context audit');
  ok(engineSrc.includes("stage: 'pre_entry_gate'"), 'TradingEngine audits AUTO ownership before EntryGate');
  ok(engineSrc.includes("executionPath: 'brain_auto_entry'"), 'generic brain AUTO path is explicitly named for ownership fencing');

  const symbol = 'INJUSDT';
  const price = 25;
  const feed = MarketDataFeed.getInstance();
  feed.destroy();
  feed.setManualPrice(symbol, price);
  feed.setSymbolFilters(symbol, {
    symbol,
    status: 'TRADING',
    baseAsset: 'INJ',
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

  const journal = new Journal();
  journal.markOpenPositionsHydrated();
  const engine = new TradingEngine(new PaperExchangeAdapter(), new MLPredictor(), journal);

  const rogueDecision: TraderBrainDecision = {
    symbol,
    mode: 'AUTO',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.9,
    status: 'BUY',
    entryPlan: { side: 'BUY', price, quantity: 4, reason: 'rogue auto path' },
    exitPlan: null,
    reasons: ['rogue auto path'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'ready' } as any, playbookResult: null, autobotsResult: null },
  };

  const rogueBrain: any = {
    coin: symbol,
    mode: 'AUTO',
    position: null,
    config: { takeProfitPercent: 2, stopLossPercent: 1.5 },
    decide: async () => rogueDecision,
  };

  await (engine as any).processEntry(rogueBrain);

  const rogueMessages = logger.getLogs().map((l) => l.message);
  const rogueAudit = rogueMessages.find((m) => m.includes('AUTO_EXECUTION_CONTEXT_CANONICAL_AUDIT') && m.includes(`symbol=${symbol}`) && m.includes('stage=pre_entry_gate'));
  ok(!!rogueAudit, 'rogue AUTO brain path emits canonical ownership audit before EntryGate');
  ok(rogueAudit?.includes('executionPath=brain_auto_entry') ?? false, 'rogue AUTO brain path is labeled brain_auto_entry');
  ok(rogueAudit?.includes('resolverPath=unknown_non_auto') ?? false, 'rogue AUTO brain path resolves to unknown_non_auto');
  ok(rogueAudit?.includes('contextValid=false') ?? false, 'rogue AUTO brain path is marked invalid before EntryGate');
  ok(rogueMessages.some((m) => m.includes('AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED') && m.includes('stage=pre_entry_gate')), 'rogue AUTO brain path is blocked before EntryGate');

  logger.clear();

  const candidate = makeCandidate(symbol, price);
  const planEntry: PlannedCandidate = {
    symbol,
    plannedAction: 'BUY',
    gateSnapshot: gateAllow().snapshot as any,
    entryPlan: candidate.traderBrainDecision.entryPlan!,
    capitalAllocation: 100,
    effectiveStrategy: candidate.selectedStrategy,
    strategy: candidate.selectedStrategy,
    scanId: 'scanner_auto_context_test',
  } as PlannedCandidate;

  await engine.executePlannedScannerBuy(candidate, planEntry);

  const scannerMessages = logger.getLogs().map((l) => l.message);
  const scannerAudit = scannerMessages.find((m) => m.includes('AUTO_EXECUTION_CONTEXT_CANONICAL_AUDIT') && m.includes(`symbol=${symbol}`) && m.includes('stage=pre_order_lock'));
  ok(!!scannerAudit, 'scanner AUTO path emits canonical ownership audit before order lock');
  ok(scannerAudit?.includes('executionPath=scanner_auto') ?? false, 'scanner AUTO path uses canonical executionPath=scanner_auto');
  ok(scannerAudit?.includes('ownerType=scanner') ?? false, 'scanner AUTO path resolves ownerType=scanner');
  ok(scannerAudit?.includes('source=AutoBots') ?? false, 'scanner AUTO path resolves source=AutoBots');
  ok(scannerAudit?.includes('isAutoTargetOwned=true') ?? false, 'scanner AUTO path is auto-target-owned');
  ok(scannerAudit?.includes('isScannerAutoTrade=true') ?? false, 'scanner AUTO path is scanner auto trade');
  ok(scannerAudit?.includes('resolverPath=scanner_auto') ?? false, 'scanner AUTO path resolves through scanner_auto');
  ok(scannerAudit?.includes('contextValid=true') ?? false, 'scanner AUTO path is canonical and valid');

  feed.destroy();
  if (failed > 0) {
    console.error(`scanner-auto-ownership-context: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`scanner-auto-ownership-context: ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
