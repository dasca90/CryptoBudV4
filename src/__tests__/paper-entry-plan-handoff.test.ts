import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import { revalidateCandidate } from '../core/scanner/PaperAutoExecutionController';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import type { EntryGateOutput, OrderRequest, ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

class CapturingPaperAdapter extends PaperExchangeAdapter {
  lastRequest: OrderRequest | null = null;
  async submitOrder(req: OrderRequest) {
    this.lastRequest = req;
    return super.submitOrder(req);
  }
}

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
      confidenceResult: { status: 'PASS', reason: null, pass: true, input: 0.8, required: 0.3, source: 'test' },
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

function candidate(symbol = 'ETHUSDT', withEntryPlan = true): ScannerCandidate {
  return {
    candidateId: `c_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: null,
    confidence: 0.8,
    status: 'BUY',
    traderBrainDecision: {
      symbol,
      mode: 'AUTO',
      selectedStrategy: 'momentum',
      selectedPlaybook: null,
      confidence: 0.8,
      status: 'BUY',
      entryPlan: withEntryPlan ? { side: 'BUY', price: 100, quantity: 1, reason: 'canonical test plan' } : null,
      exitPlan: null,
      reasons: ['ready'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
    },
    entryGateDecision: gateAllow(),
    mainReason: 'EntryGate ALLOW',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 100,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 1.2,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.3,
    m5Change: 0.4,
    m15Change: 0.4,
    h1Change: 0.4,
    change24h: 1,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    rank: 1,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
  };
}

function snapshot(candidates: ScannerCandidate[]): ScannerSnapshot {
  return {
    scanId: 'entry_plan_scan',
    startedAt: '',
    finishedAt: '',
    status: 'COOLDOWN',
    universeMode: 'BINANCE_TOP_250',
    universeSize: candidates.length,
    scannedCount: candidates.length,
    candidateCount: candidates.length,
    buyCount: candidates.length,
    waitCount: 0,
    blockCount: 0,
    avoidCount: 0,
    candidates,
    summary: '',
    diagnostics: {} as any,
  };
}

async function main() {
  const good = candidate();
  const plan = buildExecutionPlan({
    scannerSnapshot: snapshot([good]),
    executionPool: [good],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 5,
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(plan.selectedCandidates.length === 1, 'selected BUY candidate is planned');
  ok(!!plan.selectedCandidates[0].entryPlan, 'selected BUY candidate includes entryPlan');

  const missing = candidate('NOENTRYUSDT', false);
  missing.executionPlan = { entryPlan: { side: 'BUY', price: 100, quantity: 1, reason: 'execution-plan-shape' } } as any;
  const missingPlan = buildExecutionPlan({
    scannerSnapshot: snapshot([missing]),
    executionPool: [missing],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 5,
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(missingPlan.selectedCandidates.length === 1, 'candidate with runtime executionPlan shape is normalized and selected');
  ok(!!missingPlan.selectedCandidates[0]?.entryPlan, 'normalized selected candidate includes canonical entryPlan');

  const precheckMissing = revalidateCandidate({
    candidate: missing,
    planEntry: { ...(plan.selectedCandidates[0] as any), symbol: missing.symbol, entryPlan: undefined },
    openSymbols: [],
    pendingLockSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 5,
    executionAdapter: 'paper_simulated',
    paperAutoEnabled: true,
    scannerRunning: true,
    groupEnabled: true,
  });
  ok(precheckMissing.blocked === true && precheckMissing.adapterCalled === false, 'missing entryPlan is blocked before adapter');
  ok(precheckMissing.executed === false, 'missing entryPlan never marks executed');

  const stale = candidate('STALEUSDT', true);
  stale.bookFresh = false;
  const stalePlan = buildExecutionPlan({
    scannerSnapshot: snapshot([stale]),
    executionPool: [stale],
    watchPool: [],
    nearMissPool: [],
    openSymbols: [],
    pendingOrderSymbols: [],
    capital: 1000,
    usedCapital: 0,
    maxPositions: 5,
    maxEntriesPerCycle: 1,
    capitalPerTrade: 100,
    maxSpreadPct: 0.35,
    decisionMode: 'unified',
    executionAdapter: 'paper_simulated',
    enabledRiskGroups: { mid_caps: true },
  });
  ok(stalePlan.selectedCandidates.length === 0, 'stale-book candidate cannot be selected');

  const disconnectedAdapter = new PaperExchangeAdapter();
  const disconnectedInfo = await disconnectedAdapter.getAccountInfo();
  ok(disconnectedInfo.canTrade === false, 'paper adapter reports not ready before connect');
  await disconnectedAdapter.submitOrder({ coin: 'ETHUSDT', side: 'BUY', quantity: 1, price: 100, mode: 'AUTO' });
  ok(disconnectedAdapter.lastExecutionResult?.rejectReason === 'PAPER_REJECT_ADAPTER_NOT_CONNECTED', 'unconnected paper adapter reports explicit reject reason');

  const feed = MarketDataFeed.getInstance();
  feed.setManualPrice('ETHUSDT', 100);
  const adapter = new CapturingPaperAdapter();
  await adapter.connect();
  const engine = new TradingEngine(adapter, new MLPredictor(), new Journal());
  await engine.executePlannedScannerBuy(good, plan.selectedCandidates[0], snapshot([good]));

  ok(adapter.lastRequest?.price === plan.selectedCandidates[0].entryPlan?.price, 'paper adapter receives entryPlan price');
  ok(adapter.lastExecutionResult?.success === true, 'paper adapter creates fill');
  ok(engine.getPositionManager().hasOpenPosition('ETHUSDT'), 'paper fill creates open position in store');
  ok(engine.getPositionManager().getOpenPositions().length === 1, 'open position appears in position store');

  const autoRuntimeSrc = await import('node:fs').then(fs => fs.readFileSync('src/core/trading/AutoRuntime.ts', 'utf8'));
  const tradingEngineSrc = await import('node:fs').then(fs => fs.readFileSync('src/core/trading/TradingEngine.ts', 'utf8'));
  ok(!autoRuntimeSrc.includes('AUTO_RUNTIME: executing BUY'), 'old duplicate buy-by-symbol runtime path is disabled');
  ok(!tradingEngineSrc.includes('Scanner buy skipped: no entry plan'), 'old no-entry-plan runtime warning is removed');

  console.log(`paper-entry-plan-handoff: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
