import { TradingEngine } from '../src/core/trading/TradingEngine';
import { PaperExchangeAdapter } from '../src/core/exchange/PaperExchangeAdapter';
import { MLPredictor } from '../src/core/ml/MLPredictor';
import { Journal } from '../src/core/persistence/Journal';
import { logger } from '../src/utils/logger';
import type { ScannerCandidate, TraderBrainDecision } from '../src/core/types';

async function main() {
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const journal = new Journal();
  const engine = new TradingEngine(adapter, ml, journal);
  await adapter.connect();

  const scanner = engine.getAutoRuntime().getScanner();
  scanner.setPaperAutoEnabled(true);
  scanner.setManualStrategy(null);
  scanner.setUniverseMode('BINANCE_TOP_250');
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
    maxEntriesPerCycle: 4,
    capital: 10000,
    capitalPerTrade: 100,
  });
  scanner.setExecutionContextProviders({
    getUsedCapital: () => engine.getPositionManager().getOpenPositions().reduce((s, p) => s + (p.avgEntryPrice * p.quantity), 0),
    getOpenSymbols: () => engine.getPositionManager().getOpenPositions().map(p => p.coin),
    getPendingSymbols: () => engine.getOrderLockManager().getActiveLocks().filter(l => l.side === 'BUY').map(l => l.symbol),
  });

  scanner.setBrainDecide(async (symbol, price) => {
    const d: TraderBrainDecision = {
      symbol,
      mode: 'AUTO',
      selectedStrategy: 'momentum',
      selectedPlaybook: null,
      confidence: 0.89,
      status: 'BUY',
      entryPlan: { side: 'BUY', price: price.last > 0 ? price.last : 1, quantity: 0.001, reason: 'runtime_proof' },
      exitPlan: null,
      reasons: ['runtime_proof_buy'],
      blockReasons: [],
      warnings: [],
      requiredNextActions: [],
      ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
    };
    return d;
  });

  scanner.setPaperAutoBuyFn(async (symbol: string, candidate: ScannerCandidate) => {
    const openBefore = engine.getPositionManager().getOpenPositions().length;
    logger.info(`POSITION_CREATE_ATTEMPT: symbol=${symbol} openPositionsBefore=${openBefore}`);
    logger.info(`PAPER_EXECUTION_ADAPTER_CALLED: symbol=${symbol} source=runtime-proof-script`);
    await engine.executeScannerBuy(candidate);
    const openAfter = engine.getPositionManager().getOpenPositions().length;
    const created = engine.getPositionManager().hasOpenPosition(symbol) && openAfter > openBefore;
    const lastPaperExec = adapter.lastExecutionResult;
    if (lastPaperExec?.success) {
      logger.info(`PAPER_EXECUTION_FILL_CREATED: symbol=${symbol} status=${lastPaperExec.status} qty=${lastPaperExec.executedQuantity} price=${lastPaperExec.executedPrice}`);
    }
    if (created) logger.info(`POSITION_CREATED: symbol=${symbol} openPositionsAfter=${openAfter}`);
    else logger.warn(`POSITION_CREATE_FAILED: symbol=${symbol} openPositionsBefore=${openBefore} openPositionsAfter=${openAfter} adapterResult=${lastPaperExec?.status ?? 'none'} rejectReason=${lastPaperExec?.rejectReason ?? 'none'}`);
    return {
      attempted: true,
      executed: created,
      blocked: !created,
      symbol,
      reason: created ? 'Paper fill created and position opened' : 'Paper execution did not create position',
      gateResults: created ? ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', 'PAPER_FILL_CREATED', 'POSITION_OPENED'] : ['ENTRYGATE_ALLOW', 'EXECUTION_FAILED'],
      stage: created ? 'PositionOpened' as const : 'ExecutionFailed' as const,
      adapterCalled: true,
      adapterResult: lastPaperExec?.status ?? 'UNKNOWN',
      positionCreateAttempted: true,
      positionCreated: created,
      openPositionsBefore: openBefore,
      openPositionsAfter: openAfter,
    };
  });

  const snapshot = await scanner.scan('BINANCE_TOP_250');
  const openPositions = engine.getPositionManager().getOpenPositions();
  const usedCapital = openPositions.reduce((s, p) => s + (p.avgEntryPrice * p.quantity), 0);
  console.log(`RUNTIME_PROOF_SUMMARY: buyCount=${snapshot.buyCount} executionPoolSize=${snapshot.executionPoolSize ?? 0} openPositions=${openPositions.length} usedCapital=${usedCapital.toFixed(2)} lastPaperAutoStage=${snapshot.paperAutoResult?.stage ?? 'none'} lastPaperAutoExecuted=${String(snapshot.paperAutoResult?.executed ?? false)} reason=${snapshot.paperAutoResult?.reason ?? 'none'}`);
}

main().catch((e) => {
  console.error(`RUNTIME_PROOF_ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

