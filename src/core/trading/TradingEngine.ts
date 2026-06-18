import type { ExchangeAdapter } from '../exchange/ExchangeAdapter';
import type {
  TraderBrainConfig, Position, TraderAction, OrderRequest,
  LiveSafetyState, EntryGateInput, EntryGateOutput, TraderBrainDecision,
  EnterAction, ExitAction, ExitInput, ExitDecision, CloseSnapshot, ExitReason,
  ClosePriceResolution, DynamicTrailOutput, BuySnapshot, TradeRecord, MLLabel, MLQualityResult,
  ScannerCandidate, ScannerSnapshot, ScalperCandidate, ScalperSnapshot, MarketPrice,
  ManualAnalysisSnapshot, ManualBuyRequest, ManualSellRequest,
  RiskInput, RiskDecision, RiskConfig, PaperExecutionResult, PlannedCandidate,
  ScannerAutoEntryConfigSnapshot,
} from '../types';

import { TraderBrain } from './TraderBrain';
import { MLPredictor } from '../ml/MLPredictor';
import { Journal } from '../persistence/Journal';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { EntryGate } from '../entry-gate/EntryGate';
import { ExitEngine } from '../exits/ExitEngine';
import { resolveClosePrice } from '../market-data/close-price-resolver';
import { createMLLabel } from '../ml/ml-labeler';
import { evaluateTradeMLQuality } from '../ml/ml-data-quality';
import { AutoRuntime } from './AutoRuntime';
import { ScalperRuntime } from '../scalper/ScalperRuntime';
import { ManualRuntime } from '../manual/ManualRuntime';
import { RiskEngine } from '../risk/RiskEngine';
import { PositionManager } from '../positions/PositionManager';
import { OrderLockManager } from '../orders/OrderLockManager';
import { logger } from '../../utils/logger';
import { ScannerBrainService } from '../scanner/ScannerBrainService';
import { isSymbolBannedForTrading } from './banned-symbols';
import { resolveEntryRiskParams } from './entry-risk-resolver';
import { resolveAutoTargetOwnership, resolveTradingTargetOwnership } from './TradingTargetOwnership';
import { createDefaultAppSettings } from '../types';
import { buildStrategyAuditSnapshotFromCandidate } from '../strategy-audit/strategy-audit-builder';
import { emitVisualExecutionEvent } from '../../lib/air-scanner/executionVisualEventBus';
import { logStrategyAudit } from '../strategy-audit/strategy-audit-logger';
import { isScalperEnabled } from '../scalper/MicroScalperEngine';
import { resolveTradeSourceLabel } from '../notifications/trade-source';
import { validateStrategyContract } from '../strategy-audit/strategy-contracts';

let _tradeIdCounter = 0;
function nextTradeId(): string {
  return `trade_${Date.now()}_${++_tradeIdCounter}`;
}

function buildEntryConfigSnapshotContractHash(snapshot: Pick<ScannerAutoEntryConfigSnapshot, 'symbol' | 'scanId' | 'sourceCandidateId' | 'selectedStrategy' | 'finalEntryRule' | 'entryPrice' | 'quantity'>): string {
  return [
    snapshot.symbol,
    snapshot.scanId ?? 'none',
    snapshot.sourceCandidateId ?? 'none',
    snapshot.selectedStrategy,
    snapshot.finalEntryRule,
    snapshot.entryPrice,
    snapshot.quantity,
  ].join('|');
}

export class TradingEngine {
  private adapter: ExchangeAdapter;
  private ml: MLPredictor;
  private journal: Journal;
  private feed: MarketDataFeed;
  private entryGate: EntryGate;
  private exitEngine: ExitEngine;

  brains: Map<string, TraderBrain> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private autoRuntime: AutoRuntime;
  private scalperRuntime: ScalperRuntime;
  private manualRuntime: ManualRuntime;
  private riskEngine: RiskEngine;
  private positionManager: PositionManager;
  private orderLockManager: OrderLockManager;
  private _accountBalance = 10000;
  private _dailyPnlUsd = 0;
  private _dailyTradeCount = 0;
  private _consecutiveLosses = 0;
  private lastRiskBlockReason: string | null = null;
  private lastPreAdapterBlockReason: string | null = null;
  private _winRate = 0.5;
  private _maxDrawdownPercent = 0;
  private scannerBrainService: ScannerBrainService;
  private getBanlist: () => string[] = () => createDefaultAppSettings().scannerBanlist;
  private btcAnchorEnabled = true;
  private ethAnchorEnabled = true;
  private eventCallbacks: {
    onTradeOpened?: (trade: TradeRecord) => void | Promise<void>;
    onTradeClosed?: (trade: TradeRecord) => void | Promise<void>;
  } = {};

  constructor(adapter: ExchangeAdapter, ml: MLPredictor, journal: Journal) {
    this.adapter = adapter;
    this.ml = ml;
    this.journal = journal;
    this.feed = MarketDataFeed.getInstance();
    this.entryGate = new EntryGate();
    this.exitEngine = new ExitEngine();
    this.autoRuntime = new AutoRuntime(ml);
    this.autoRuntime.setBrainDecide((symbol, price) => this.scannerDecide(symbol, price));
    this.autoRuntime.setCallbacks({
      onCandidatesReady: () => {},
      executeBuy: (candidate, snapshot, rejected) => this.executeScannerBuy(candidate, snapshot, rejected),
      getAvailableSlots: () => Math.max(0, 10 - this.countOpenPositions()),
    });
    this.scalperRuntime = new ScalperRuntime();
    this.scalperRuntime.setBrainDecide((symbol, price) => this.scannerDecide(symbol, price));
    this.scalperRuntime.setCallbacks({
      onSnapshotReady: () => {},
      executeBuy: (candidate) => this.executeScalperBuy(candidate),
    });
    this.manualRuntime = new ManualRuntime();
    this.manualRuntime.setBrainDecide((symbol, price) => this.scannerDecide(symbol, price));
    this.riskEngine = new RiskEngine();
    logger.info(`RISK_CONFIG_SOURCE_AUDIT: maxPositionsPerRiskGroup=${JSON.stringify(this.riskEngine.getConfig().maxPositionsPerRiskGroup)} sourceOfMaxPositionsPerRiskGroup=RiskEngine_defaults maxCapitalAtRisk=${this.riskEngine.getConfig().maxCapitalAtRiskTotal} maxCapitalAtRiskPerTrade=${this.riskEngine.getConfig().maxCapitalAtRiskPerTrade} maxDailyTrades=${this.riskEngine.getConfig().maxDailyTrades} configBindingValid=true`);
    const scannerGroupKeys = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];
    const configuredGroupKeys = Object.keys(this.riskEngine.getConfig().maxPositionsPerRiskGroup);
    const missingConfigKeys = scannerGroupKeys.filter(k => !configuredGroupKeys.includes(k));
    const unusedConfigKeys = configuredGroupKeys.filter(k => !scannerGroupKeys.includes(k));
    const fallbackGroupConfigUsed = missingConfigKeys.length > 0 || unusedConfigKeys.length > 0;
    const invariantOk = missingConfigKeys.length === 0 && unusedConfigKeys.length === 0 && !fallbackGroupConfigUsed;
    logger.info(`RISK_GROUP_CONFIG_BINDING_AUDIT: configuredGroupKeys=${configuredGroupKeys.join('|')} scannerGroupKeys=${scannerGroupKeys.join('|')} missingConfigKeys=${missingConfigKeys.join('|') || 'none'} unusedConfigKeys=${unusedConfigKeys.join('|') || 'none'} fallbackGroupConfigUsed=${String(fallbackGroupConfigUsed)} invariantOk=${String(invariantOk)}`);
    this.positionManager = new PositionManager();
    this.orderLockManager = new OrderLockManager();
    this.scannerBrainService = new ScannerBrainService(this.brains, this.adapter, this.ml, {
      btcEnabled: this.btcAnchorEnabled,
      ethEnabled: this.ethAnchorEnabled,
    });
    logger.info(`ACTIVE_RUNTIME_SCANNER_WIRING_AUDIT: source=TradingEngine.constructor scannerInstanceId=${this.autoRuntime.getScanner().getScannerInstanceId()} paperAutoBuyFnPresentBeforeDefault=${String(this.autoRuntime.getScanner().hasPaperAutoBuyFn())} logSinkName=logger.getLogs/logger.export`);
    this.installDefaultPaperAutoBuyHandler();
    logger.info(`ACTIVE_RUNTIME_SCANNER_WIRING_AUDIT: source=TradingEngine.constructor scannerInstanceId=${this.autoRuntime.getScanner().getScannerInstanceId()} paperAutoBuyFnPresentAfterDefault=${String(this.autoRuntime.getScanner().hasPaperAutoBuyFn())} callbackTarget=TradingEngine.executePlannedScannerBuy logSinkName=logger.getLogs/logger.export`);
  }

  getAutoRuntime(): AutoRuntime { return this.autoRuntime; }
  getScalperRuntime(): ScalperRuntime { return this.scalperRuntime; }
  getManualRuntime(): ManualRuntime { return this.manualRuntime; }
  setBanlistProvider(fn: () => string[]): void { this.getBanlist = fn; }
  setEventCallbacks(callbacks: {
    onTradeOpened?: (trade: TradeRecord) => void | Promise<void>;
    onTradeClosed?: (trade: TradeRecord) => void | Promise<void>;
  }): void {
    this.eventCallbacks = { ...this.eventCallbacks, ...callbacks };
  }

  private installDefaultPaperAutoBuyHandler(): void {
    this.autoRuntime.getScanner().setPaperAutoBuyFn(async (plannedCandidate: PlannedCandidate, candidate: ScannerCandidate) => {
      const symbol = plannedCandidate.symbol;
      const openBefore = this.positionManager.getOpenPositions().length;
      if (!plannedCandidate.entryPlan) {
        logger.warn(`ENTRY_PLAN_MISSING: symbol=${symbol} source=TradingEngine.defaultPaperAutoBuyFn adapterCalled=false`);
        return {
          attempted: false,
          executed: false,
          blocked: true,
          symbol,
          reason: 'Missing canonical entry plan',
          gateResults: ['ENTRY_PLAN_MISSING'],
          stage: 'ExecutionFailed' as const,
          adapterCalled: false,
          adapterResult: 'NOT_SUBMITTED',
          positionCreateAttempted: false,
          positionCreated: false,
          openPositionsBefore: openBefore,
          openPositionsAfter: openBefore,
        };
      }

      try {
        const beforeExecution = this.adapter.lastExecutionResult;
        const accountInfo = await this.adapter.getAccountInfo();
        if (!accountInfo.canTrade) {
          logger.info(`DEMO_EXECUTION_ADAPTER_CONNECT_START: symbol=${symbol} source=TradingEngine.defaultPaperAutoBuyFn reason=default_demo_auto_requires_connected_adapter`);
          await this.adapter.connect();
          const afterConnect = await this.adapter.getAccountInfo();
          if (!afterConnect.canTrade) {
            logger.warn(`DEMO_EXECUTION_ADAPTER_UNAVAILABLE: symbol=${symbol} source=TradingEngine.defaultPaperAutoBuyFn reason=demo_adapter_not_connected`);
            return {
              attempted: false,
              executed: false,
              blocked: true,
              symbol,
              reason: 'Demo adapter unavailable - not connected',
              gateResults: ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', 'DEMO_ADAPTER_NOT_CONNECTED'],
              stage: 'ExecutionFailed' as const,
              adapterCalled: false,
              adapterResult: 'NOT_SUBMITTED',
              positionCreateAttempted: false,
              positionCreated: false,
              openPositionsBefore: openBefore,
              openPositionsAfter: openBefore,
            };
          }
        }

        logger.info(`POSITION_CREATE_ATTEMPT: symbol=${symbol} openPositionsBefore=${openBefore} source=TradingEngine.defaultPaperAutoBuyFn`);
        await this.executePlannedScannerBuy(candidate, plannedCandidate);
        const openAfter = this.positionManager.getOpenPositions().length;
        const created = this.positionManager.hasOpenPosition(symbol) && openAfter > openBefore;
        const afterExecution = this.adapter.lastExecutionResult;
        const adapterWasCalled = afterExecution !== beforeExecution;
        const adapterResult = adapterWasCalled ? (afterExecution?.status ?? 'UNKNOWN') : 'NOT_SUBMITTED';
        const snapshotMissingFields = (() => {
          const snapshot = plannedCandidate.scannerAutoEntryConfigSnapshot;
          if (!snapshot) return ['entryConfigSnapshot'];
          const missing: string[] = [];
          if (!snapshot.selectedStrategy || snapshot.selectedStrategy.toLowerCase() === 'wait') missing.push('selectedStrategy');
          if (!snapshot.finalEntryRule || snapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')) missing.push('finalEntryRule');
          return missing;
        })();
        const failReason = adapterWasCalled && afterExecution?.success
          ? 'Demo fill created but position not opened'
          : adapterWasCalled
            ? `Demo execution failed: ${afterExecution?.rejectReason ?? adapterResult}`
            : snapshotMissingFields.length > 0
              ? `Demo execution blocked: entry_config_snapshot_incomplete:${snapshotMissingFields.join('|')}`
              : this.lastPreAdapterBlockReason
                ? `pre_adapter_block:${this.lastPreAdapterBlockReason}`
                : this.lastRiskBlockReason
                  ? `risk_blocked:${this.lastRiskBlockReason.replace(/\s+/g, '_')}`
                  : 'Demo execution blocked before adapter: pre_adapter_block_before_submit';
        if (!adapterWasCalled) {
          const auditSnapshot = plannedCandidate.scannerAutoEntryConfigSnapshot;
          const openSymbols = this.positionManager.getOpenPositions().map(p => p.coin);
          const isDuplicate = openSymbols.includes(symbol);
          const isBanned = isSymbolBannedForTrading(symbol, undefined, 'USDT', this.getBanlist()).banned;
          const capitalOk = this._accountBalance >= (plannedCandidate.entryPlan?.quantity ?? 0) * (plannedCandidate.entryPlan?.price ?? 0);
          const maxPositionsOk = openSymbols.length < 50;
          logger.info(`PRE_ADAPTER_CANDIDATE_VERDICT_AUDIT: symbol=${symbol} selectedRank=${plannedCandidate.rank ?? 0} requestedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} selectedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} runtimeActiveStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalEntryRule=${auditSnapshot?.finalEntryRule ?? 'n/a'} finalExecutable=${String(auditSnapshot?.finalExecutableAtEntry ?? auditSnapshot?.finalExecutable ?? 'n/a')} buyAllowed=${String(auditSnapshot?.buyAllowed ?? 'n/a')} setupResult=${auditSnapshot?.setupResult ?? 'n/a'} openPositionDuplicate=${String(isDuplicate)} pendingOrderDuplicate=false banned=${String(isBanned)} spreadOk=true tpRoomOk=${String(auditSnapshot?.setupResult !== 'SPREAD_TOO_HIGH')} priceFresh=true capitalOk=${String(capitalOk)} maxOpenPositionsOk=${String(maxPositionsOk)} allowedForAdapter=${String(!isDuplicate && !isBanned)} adapterCalled=false positionCreated=false blockReason=${failReason}`);
          logger.warn(`EXECUTION_PRE_ADAPTER_REJECTION_AUDIT: symbol=${symbol} selectedStrategy=${auditSnapshot?.selectedStrategy ?? 'n/a'} finalEntryRule=${auditSnapshot?.finalEntryRule ?? 'n/a'} finalExecutable=${String(auditSnapshot?.finalExecutableAtEntry ?? auditSnapshot?.finalExecutable ?? 'n/a')} buyAllowed=${String(auditSnapshot?.buyAllowed ?? 'n/a')} realRejectReason=${failReason} hasRiskBlockReason=${String(!!this.lastRiskBlockReason)} hasPreAdapterBlockReason=${String(!!this.lastPreAdapterBlockReason)}`);
        }
        return {
          attempted: true,
          executed: created,
          blocked: !created,
          symbol,
          reason: created ? 'Demo fill created and position opened' : failReason,
          gateResults: created ? ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', 'DEMO_FILL_CREATED', 'POSITION_OPENED'] : ['ENTRYGATE_ALLOW', 'RISKENGINE_ALLOW', adapterWasCalled ? 'EXECUTION_FAILED' : 'ADAPTER_NOT_CALLED'],
          stage: created ? 'PositionOpened' as const : (adapterWasCalled && afterExecution?.success ? 'DemoFillCreated' as const : 'ExecutionFailed' as const),
          adapterCalled: adapterWasCalled,
          adapterResult,
          positionCreateAttempted: true,
          positionCreated: created,
          openPositionsBefore: openBefore,
          openPositionsAfter: openAfter,
        };
        logger.info(`EXECUTION_BLOCK_REASON_CANONICAL_AUDIT: symbol=${symbol} phase=${!adapterWasCalled ? 'pre_adapter' : 'post_adapter'} adapterCalled=${String(adapterWasCalled)} adapterStatus=${adapterResult} riskBlockReasons=${this.lastRiskBlockReason ?? 'none'} finalRejectReasonBefore=PAPER_REJECT_INSUFFICIENT_POSITION_QTY finalRejectReasonAfter=${failReason.replace(/\s+/g, '_')} canonicalReasonSource=${this.lastRiskBlockReason ? 'RiskEngine' : adapterWasCalled ? 'Adapter' : 'PositionManager'}`);
      } catch (err) {
        const openAfter = this.positionManager.getOpenPositions().length;
        logger.warn(`DEMO_EXECUTION_DEFAULT_HANDLER_FAILED: symbol=${symbol} reason=${err instanceof Error ? err.message : String(err)}`);
        return {
          attempted: true,
          executed: false,
          blocked: true,
          symbol,
          reason: `Default demo execution failed: ${err instanceof Error ? err.message : String(err)}`,
          gateResults: ['ENTRYGATE_ALLOW', 'EXECUTION_FAILED'],
          stage: 'ExecutionFailed' as const,
          adapterCalled: false,
          adapterResult: 'CALL_FAILED',
          positionCreateAttempted: false,
          positionCreated: false,
          openPositionsBefore: openBefore,
          openPositionsAfter: openAfter,
        };
      }
    });
    logger.info('DEFAULT_PAPER_AUTO_BUY_HANDLER_INSTALLED: source=TradingEngine constructor scannerHasPaperAutoBuyFn=true');
  }

  getLastRiskBlockReason(): string | null { return this.lastRiskBlockReason; }

  getLastPreAdapterBlockReason(): string | null { return this.lastPreAdapterBlockReason; }

  private async scannerDecide(symbol: string, price: MarketPrice): Promise<TraderBrainDecision> {
    try {
      const lookup = this.scannerBrainService.getOrCreateBrainForSymbol(symbol, 'AUTO');
      const decision = await lookup.brain.decide(price, this.ml.predict(symbol));
      decision.scannerBrainSource = lookup.source;
      return decision;
    } catch (err) {
      logger.warn(`SCANNER_BRAIN_CREATE_FAILED: symbol=${symbol} universeMode=${this.autoRuntime.getScanner().getUniverseMode()} reason=brain_create_failed error=${err instanceof Error ? err.message : String(err)}`);
      return {
        symbol, mode: 'AUTO', selectedStrategy: 'none', selectedPlaybook: null,
        confidence: 0, status: 'AVOID', entryPlan: null, exitPlan: null,
        reasons: ['brain_create_failed'], blockReasons: ['brain_create_failed'],
        warnings: ['scanner_brain_create_failed'], requiredNextActions: [],
        ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
      };
    }
  }

  async executeManualBuy(snapshot: ManualAnalysisSnapshot, request: ManualBuyRequest): Promise<void> {
    if (snapshot.isStale) {
      logger.warn(`Manual buy blocked: stale analysis for ${snapshot.symbol} — re-analyze first`);
      return;
    }
    if (!snapshot.entryGateDecision || snapshot.entryGateDecision.decision !== 'ALLOW') {
      logger.warn(`Manual buy blocked: EntryGate ${snapshot.entryGateDecision?.decision ?? 'none'} for ${snapshot.symbol}`);
      return;
    }
    if (!snapshot.traderBrainDecision?.entryPlan) {
      logger.warn(`Manual buy blocked: no entry plan for ${snapshot.symbol}`);
      return;
    }

    // Re-evaluate EntryGate with current context
    const brain = this.brains.get(snapshot.symbol);
    if (!brain) {
      logger.warn(`Manual buy skipped: brain not found for ${snapshot.symbol}`);
      return;
    }

    const gateInput: EntryGateInput = {
      coin: snapshot.symbol,
      side: 'BUY',
      price: snapshot.price,
      quantity: 0.001,
      mode: 'MANUAL',
      mlConfidence: snapshot.traderBrainDecision.confidence,
      prediction: snapshot.traderBrainDecision.selectedStrategy,
      currentPositions: this.countOpenPositions(),
      maxPositions: 10,
      recentLoss: false,
      spreadOk: snapshot.spreadPct < 0.5,
      volumePass: !snapshot.traderBrainDecision.blockReasons.some(r => r.includes('volume')),
      priceFresh: Date.now() - new Date(snapshot.analyzedAt).getTime() < 30000,
      btcDumping: snapshot.traderBrainDecision.blockReasons.some(r => r.includes('btc') || r.includes('dump')),
      marketRegimeUnsafe: snapshot.traderBrainDecision.blockReasons.some(r => r.includes('regime')),
      reboundConfirmed: !snapshot.traderBrainDecision.blockReasons.some(r => r.includes('rebound')),
      momentumConfirmed: !snapshot.traderBrainDecision.blockReasons.some(r => r.includes('momentum')),
      tpRoomOk: !snapshot.traderBrainDecision.blockReasons.some(r => r.includes('tp') || r.includes('room')),
      isVeryHighRisk: snapshot.traderBrainDecision.blockReasons.some(r => r.includes('risk')),
      isLive: this.adapter.isLive,
      marketDataOnline: this.feed.getMarketDataQuality(snapshot.symbol).quality !== 'OFFLINE',
      bookFresh: this.feed.getMarketDataQuality(snapshot.symbol).bookFresh,
      symbolTradable: this.feed.isSymbolTradable(snapshot.symbol),
    };

    const gateResult = this.entryGate.evaluate(gateInput);
    if (gateResult.decision !== 'ALLOW') {
      logger.warn(`Manual buy blocked by EntryGate: ${gateResult.explanation}`);
      return;
    }

    const entryPlan = snapshot.traderBrainDecision.entryPlan;
    const action: EnterAction = {
      type: 'ENTER',
      coin: snapshot.symbol,
      side: entryPlan.side,
      quantity: entryPlan.quantity,
      price: entryPlan.price,
      mlConfidence: snapshot.traderBrainDecision.confidence,
      prediction: snapshot.traderBrainDecision.selectedStrategy,
      strategy: `MANUAL_${snapshot.traderBrainDecision.selectedStrategy}`,
    };

    await this.executeEntry(action, brain, snapshot.traderBrainDecision, gateResult, undefined, undefined, undefined, undefined, request);
  }

  async executeManualSell(request: ManualSellRequest): Promise<void> {
    const brain = this.brains.get(request.symbol);
    if (!brain || !brain.position) {
      logger.warn(`Manual sell skipped: no position for ${request.symbol}`);
      return;
    }

    const pos = brain.position;
    const priceRes = await resolveClosePrice(brain.coin, 'SELL');
    const exitPrice = priceRes.price;

    if (exitPrice <= 0) {
      logger.warn(`Manual sell blocked: close price unavailable for ${request.symbol}`);
      return;
    }

    const pnl = (exitPrice - pos.avgEntryPrice) * pos.quantity;
    const pnlPct = (exitPrice - pos.avgEntryPrice) / pos.avgEntryPrice * 100;
    const durationMs = Date.now() - pos.openedAt;
    const mfePercent = ((pos.highestPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
    const maePercent = ((exitPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;

    let executionQuality: 'CLEAN_REAL_MARKET_PRICE' | 'FALLBACK_TRIGGER_PRICE' | 'PRICE_UNAVAILABLE' | 'INVALID_PRICE' = 'CLEAN_REAL_MARKET_PRICE';
    if (exitPrice <= 0) executionQuality = 'INVALID_PRICE';
    else if (priceRes.source === 'unavailable') executionQuality = 'PRICE_UNAVAILABLE';
    else if (!priceRes.isRealMarketPrice) executionQuality = 'FALLBACK_TRIGGER_PRICE';

    const decision: ExitDecision = {
      action: 'EXIT',
      exitReason: 'MANUAL_EXIT',
      exitPrice,
      pnlPercent: pnlPct,
      pnlUsd: pnl,
      shouldClosePosition: true,
      warnings: [],
      audit: {},
    };

    await this.executeExitWithSnapshot(brain, pos, decision, priceRes);
    logger.trade(`MANUAL EXIT ${request.symbol} @ ${exitPrice} PnL:${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
  }

  async executeScalperBuy(candidate: ScalperCandidate, scalperSnapshot?: ScalperSnapshot): Promise<void> {
    logger.info(`CANDIDATE_SOURCE_PIPELINE_AUDIT: symbol=${candidate.symbol} pipeline=micro_scalper candidateSource=micro_scalper executionSource=auto buyPath=TradingEngine.executeScalperBuy microScalperEnabled=${String(isScalperEnabled())}`);
    if (!isScalperEnabled()) {
      logger.warn(`MICRO_BUY_BLOCKED_SCALPER_DISABLED: symbol=${candidate.symbol} microScalperEnabled=false buyAllowed=false reason=scalper_disabled executionPath=TradingEngine.executeScalperBuy`);
      return;
    }
    if (this.adapter.isLive) {
      logger.warn(`Scalper buy blocked: live adapter not allowed for SCALPER — ${candidate.symbol}`);
      return;
    }
    if (candidate.status !== 'BUY') return;
    if (!candidate.entryGateDecision || candidate.entryGateDecision.decision !== 'ALLOW') return;

    const brain = this.scannerBrainService.getOrCreateBrainForSymbol(candidate.symbol, 'SCALPER').brain;

    const entryPlan = candidate.traderBrainDecision?.entryPlan ?? {
      side: 'BUY' as const,
      price: candidate.price,
      quantity: 0.001,
      reason: 'scalper entry',
    };

    const action: EnterAction = {
      type: 'ENTER',
      coin: candidate.symbol,
      side: entryPlan.side,
      quantity: entryPlan.quantity,
      price: entryPlan.price,
      mlConfidence: candidate.traderBrainDecision?.confidence ?? candidate.scalpScore / 100,
      prediction: candidate.signal,
      strategy: `SCALPER_${candidate.signal}`,
    };

    await this.executeEntry(action, brain, candidate.traderBrainDecision ?? undefined, candidate.entryGateDecision, undefined, undefined, candidate, scalperSnapshot, undefined, undefined, { executionPath: 'executeScalperBuy' });
  }

  async executeScannerBuy(candidate: ScannerCandidate, scannerSnapshot?: ScannerSnapshot, rejectedNearCandidates?: string[]): Promise<void> {
    logger.info(`AUTOBOTS_SOURCE_MODEL_AUDIT: symbol=${candidate.symbol} source=AutoBots engine=The Dipper candidateSource=The Dipper executionSource=auto strategySource=${candidate.strategySource ?? 'unknown'} buyPath=TradingEngine.executeScannerBuy`);
    logger.info(`CANDIDATE_SOURCE_PIPELINE_AUDIT: symbol=${candidate.symbol} pipeline=autobots_scanner candidateSource=scanner executionSource=auto buyPath=TradingEngine.executeScannerBuy`);
    if (candidate.status !== 'BUY') return;
    if (!candidate.entryGateDecision || candidate.entryGateDecision.decision !== 'ALLOW') return;
    (candidate as any).ownerType = (candidate as any).ownerType ?? 'scanner';
    (candidate as any).ownerName = (candidate as any).ownerName ?? 'The Dipper';
    (candidate as any).source = (candidate as any).source ?? 'AutoBots';

    const brain = this.scannerBrainService.getOrCreateBrainForSymbol(candidate.symbol, 'AUTO').brain;

    if (!candidate.traderBrainDecision.entryPlan) {
      logger.warn(`ENTRY_PLAN_MISSING: symbol=${candidate.symbol} source=TradingEngine.executeScannerBuy adapterCalled=false`);
      return;
    }

    const action: EnterAction = {
      type: 'ENTER',
      coin: candidate.symbol,
      side: candidate.traderBrainDecision.entryPlan.side,
      quantity: candidate.traderBrainDecision.entryPlan.quantity,
      price: candidate.traderBrainDecision.entryPlan.price,
      mlConfidence: candidate.confidence,
      prediction: candidate.selectedStrategy,
      strategy: candidate.selectedStrategy,
    };

    await this.executeEntry(action, brain, candidate.traderBrainDecision, candidate.entryGateDecision, candidate, scannerSnapshot, undefined, undefined, undefined, rejectedNearCandidates, { executionPath: 'scanner_auto' });
  }

  async executePlannedScannerBuy(candidate: ScannerCandidate, planEntry: PlannedCandidate, scannerSnapshot?: ScannerSnapshot, rejectedNearCandidates?: string[]): Promise<void> {
    logger.info(`AUTOBOTS_SOURCE_MODEL_AUDIT: symbol=${candidate.symbol} source=AutoBots engine=The Dipper candidateSource=The Dipper executionSource=auto strategySource=${candidate.strategySource ?? 'unknown'} buyPath=TradingEngine.executePlannedScannerBuy`);
    logger.info(`CANDIDATE_SOURCE_PIPELINE_AUDIT: symbol=${candidate.symbol} pipeline=autobots_scanner candidateSource=scanner executionSource=auto buyPath=TradingEngine.executePlannedScannerBuy`);
    if (candidate.status !== 'BUY') return;
    if (planEntry.plannedAction !== 'BUY') return;
    if (!planEntry.gateSnapshot || planEntry.gateSnapshot.decision !== 'ALLOW') return;

    const entryPlan = planEntry.entryPlan;
    if (!entryPlan) {
      logger.warn(`ENTRY_PLAN_MISSING: symbol=${candidate.symbol} source=TradingEngine.executePlannedScannerBuy adapterCalled=false`);
      return;
    }
    const scannerAutoEntryConfigSnapshot = planEntry.scannerAutoEntryConfigSnapshot ?? null;
    if (scannerAutoEntryConfigSnapshot) {
      const contractHash = buildEntryConfigSnapshotContractHash(scannerAutoEntryConfigSnapshot);
      logger.info(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${candidate.symbol} boundary=before_demo_execution_controller snapshotPresent=true selectedStrategy=${scannerAutoEntryConfigSnapshot.selectedStrategy} finalEntryRule=${scannerAutoEntryConfigSnapshot.finalEntryRule} contractHash=${contractHash} contractValid=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} semanticValid=${String(scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}`);
      logger.info(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${candidate.symbol} boundary=inside_execute_planned_scanner_buy snapshotPresent=true selectedStrategy=${scannerAutoEntryConfigSnapshot.selectedStrategy} finalEntryRule=${scannerAutoEntryConfigSnapshot.finalEntryRule} contractHash=${contractHash} contractValid=${String(scannerAutoEntryConfigSnapshot.finalExecutable && scannerAutoEntryConfigSnapshot.buyAllowed && scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} semanticValid=${String(scannerAutoEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !scannerAutoEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}`);
    } else {
      logger.error(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${candidate.symbol} boundary=inside_execute_planned_scanner_buy snapshotPresent=false selectedStrategy=missing finalEntryRule=missing contractHash=missing contractValid=false`);
    }
    (candidate as any).ownerType = (candidate as any).ownerType ?? 'scanner';
    (candidate as any).ownerName = (candidate as any).ownerName ?? 'The Dipper';
    (candidate as any).source = (candidate as any).source ?? 'AutoBots';
    (candidate as any).capitalAllocation = (candidate as any).capitalAllocation ?? planEntry.capitalAllocation ?? (entryPlan.price * entryPlan.quantity);

    const brain = this.scannerBrainService.getOrCreateBrainForSymbol(candidate.symbol, 'AUTO').brain;
    const gateResult: EntryGateOutput = {
      decision: planEntry.gateSnapshot.decision,
      primaryReason: planEntry.gateSnapshot.primaryReason,
      blockReasons: planEntry.gateSnapshot.blockReasons as EntryGateOutput['blockReasons'],
      warnings: [],
      explanation: 'Canonical planned EntryGate ALLOW',
      requiredNextActions: planEntry.gateSnapshot.requiredNextActions,
      snapshot: planEntry.gateSnapshot,
    };

    const decision: TraderBrainDecision = {
      ...candidate.traderBrainDecision,
      entryPlan,
    };
    const action: EnterAction = {
      type: 'ENTER',
      coin: candidate.symbol,
      side: entryPlan.side,
      quantity: entryPlan.quantity,
      price: entryPlan.price,
      mlConfidence: candidate.confidence,
      prediction: planEntry.effectiveStrategy ?? scannerAutoEntryConfigSnapshot?.selectedStrategy ?? candidate.selectedStrategy,
      strategy: scannerAutoEntryConfigSnapshot?.selectedStrategy ?? planEntry.strategy ?? candidate.selectedStrategy,
    };

    const plannedNotional = entryPlan.price * entryPlan.quantity;
    logger.info(`CAPITAL_PER_COIN_SETTINGS_SOURCE_AUDIT: symbol=${candidate.symbol} executionPath=executePlannedScannerBuy sourceUsed=plannedCandidate.capitalAllocation uiCapitalPerCoin=${(candidate as any).capitalAllocation ?? 'n/a'} persistedCapitalPerCoin=${(candidate as any).capitalAllocation ?? 'n/a'} resolvedCapitalPerCoin=${(candidate as any).capitalAllocation ?? plannedNotional} finalOrderNotionalUsd=${plannedNotional.toFixed(4)} availableCapital=n/a reason=planned_entry_plan_consumed`);
    logger.info(`ENTRY_PLAN_CONSUMED_BY_DEMO_EXECUTION: symbol=${candidate.symbol} side=${entryPlan.side} price=${entryPlan.price} quantity=${entryPlan.quantity} scanId=${planEntry.scanId ?? scannerSnapshot?.scanId ?? 'unknown'}`);
    await this.executeEntry(action, brain, decision, gateResult, candidate, scannerSnapshot, undefined, undefined, undefined, rejectedNearCandidates, { executionPath: 'scanner_auto', plannedScannerBuy: true, scannerAutoEntryConfigSnapshot });
  }

  addBrain(config: TraderBrainConfig): TraderBrain {
    const brain = new TraderBrain(config, this.adapter, this.ml);
    brain.setAnchorSettings(this.btcAnchorEnabled, this.ethAnchorEnabled);
    this.brains.set(config.coin, brain);

    this.feed.subscribe(config.coin, (price) => {
      this.ml.feedPrice(price);
      if (price.last > 0 && this.positionManager.hasOpenPosition(config.coin)) {
        const pos = this.positionManager.getPositionBySymbol(config.coin);
        if (pos && pos.avgEntryPrice > 0) {
          const previousPnlPct = pos.unrealizedPnlPercent;
          const unrealizedPnlPct = ((price.last - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
          const unrealizedPnlUsd = (price.last - pos.avgEntryPrice) * pos.quantity;
          const pnlDirection = unrealizedPnlPct > 0.1 ? 'profit' : unrealizedPnlPct < -0.1 ? 'loss' : 'flat';
          const changed = Math.abs(unrealizedPnlPct - previousPnlPct) > 0.001;
          this.positionManager.updatePosition(config.coin, {
            currentPrice: price.last,
            lastPrice: price.last,
            priceTimestamp: price.timestamp,
            unrealizedPnlPercent: unrealizedPnlPct,
          });
          if (changed) {
            const entryValue = pos.avgEntryPrice * pos.quantity;
            const estimatedFees = Math.abs(unrealizedPnlUsd) * 0.001;
            logger.info(`OPEN_POSITION_MARK_PRICE_UPDATE_AUDIT: symbol=${config.coin} positionId=${pos.tradeId ?? 'none'} entryPrice=${pos.avgEntryPrice} previousMarkPrice=${pos.currentPrice} newMarkPrice=${price.last} markPriceSource=book_ticker_feed priceAgeMs=0 validPrice=true changed=true`);
            logger.info(`OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT: symbol=${config.coin} positionId=${pos.tradeId ?? 'none'} entryPrice=${pos.avgEntryPrice} markPrice=${price.last} qty=${pos.quantity} entryValue=${entryValue.toFixed(4)} grossPnlUsd=${unrealizedPnlUsd.toFixed(4)} grossPnlPct=${unrealizedPnlPct.toFixed(2)} estimatedFees=${estimatedFees.toFixed(4)} unrealizedPnlUsd=${(unrealizedPnlUsd - estimatedFees).toFixed(4)} unrealizedPnlPct=${unrealizedPnlPct.toFixed(2)} pnlDirection=${pnlDirection} previousUnrealizedPnlUsd=${((previousPnlPct / 100) * entryValue).toFixed(4)} previousUnrealizedPnlPct=${previousPnlPct.toFixed(2)} changed=true`);
          }
          logger.throttled('INFO', `OPEN_POSITION_MARK_PRICE_AUDIT: symbol=${config.coin} positionId=${pos.tradeId ?? 'none'} entryPrice=${pos.avgEntryPrice} markPrice=${price.last} markPriceSource=book_ticker_feed priceAgeMs=0 markPriceUpdatedAt=${new Date().toISOString()} validPrice=true`, 'open_pos_price', 5000);
        }
      }
    });

    return brain;
  }

  removeBrain(coin: string): void {
    this.brains.delete(coin);
  }

  getBrain(coin: string): TraderBrain | undefined {
    return this.brains.get(coin);
  }

  getAllPositions(): Position[] {
    return this.positionManager.getOpenPositions();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.adapter.connect();
    this.orderLockManager.cleanupStaleLocks();

    this.tickInterval = setInterval(async () => {
      await this.processDecisions();
      this.orderLockManager.cleanupStaleLocks();
    }, 5000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    await this.adapter.disconnect();
  }

  private async processDecisions(): Promise<void> {
    const now = Date.now();
    let exitEvalCount = 0;
    let exitSellCount = 0;
    // Update live prices for all open positions
    for (const pos of this.positionManager.getOpenPositions()) {
      const price = this.feed.getLastPrice(pos.coin);
      if (price > 0 && pos.avgEntryPrice > 0) {
        const priceAgeMs = this.feed.getPriceAgeMs(pos.coin);
        const previousPnlPct = pos.unrealizedPnlPercent;
        const unrealizedPnlPct = ((price - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
        this.positionManager.updatePosition(pos.coin, {
          currentPrice: price,
          lastPrice: price,
          priceTimestamp: Date.now() - Math.max(0, priceAgeMs),
          unrealizedPnlPercent: unrealizedPnlPct,
        });
        if (Math.abs(unrealizedPnlPct - previousPnlPct) > 0.001) {
          const entryValue = pos.avgEntryPrice * pos.quantity;
          const estimatedFees = Math.abs((price - pos.avgEntryPrice) * pos.quantity) * 0.001;
          logger.info(`OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT: symbol=${pos.coin} positionId=${pos.tradeId ?? 'none'} entryPrice=${pos.avgEntryPrice} markPrice=${price} qty=${pos.quantity} entryValue=${entryValue.toFixed(4)} grossPnlUsd=${((price - pos.avgEntryPrice) * pos.quantity).toFixed(4)} grossPnlPct=${unrealizedPnlPct.toFixed(2)} estimatedFees=${estimatedFees.toFixed(4)} unrealizedPnlUsd=${(((price - pos.avgEntryPrice) * pos.quantity) - estimatedFees).toFixed(4)} unrealizedPnlPct=${unrealizedPnlPct.toFixed(2)} pnlDirection=${unrealizedPnlPct > 0.1 ? 'profit' : unrealizedPnlPct < -0.1 ? 'loss' : 'flat'} previousUnrealizedPnlUsd=${((previousPnlPct / 100) * entryValue).toFixed(4)} previousUnrealizedPnlPct=${previousPnlPct.toFixed(2)} changed=true`);
        }
      }
    }
    // Exit evaluation for ALL open positions (covers scanner_auto temp brains too)
    for (const pos of this.positionManager.getOpenPositions()) {
      const brain = this.brains.get(pos.coin) ?? this.scannerBrainService.getOrCreateBrainForSymbol(pos.coin, 'AUTO').brain;
      if (!brain.position) { brain.position = pos; }
      {
        const tradeId = pos.tradeId;
        if (tradeId) {
          const closedWithSameId = this.journal.getClosedTrades().filter(t => t.tradeId === tradeId);
          const existsInOpen = true;
          const existsInClosed = closedWithSameId.length > 0;
          const violationDetected = existsInOpen && existsInClosed;
          if (violationDetected) {
            logger.error(`POSITION_TRADE_ID_STATE_INVARIANT: tradeId=${tradeId} symbol=${pos.coin} existsInOpen=${String(existsInOpen)} existsInClosed=${String(existsInClosed)} openPositionStatus=${pos.mode ?? 'unknown'} closedReason=${closedWithSameId[0]?.status ?? 'none'} violationDetected=true`);
            this.positionManager.removePosition(pos.coin);
            this.journal.deleteOpenPosition(tradeId);
            logger.warn(`POSITION_OPEN_CLOSED_CONFLICT_REPAIRED: symbol=${pos.coin} tradeId=${tradeId} action=auto_removed_from_open_positions`);
          }
        }
      }
      try {
        exitEvalCount++;
        const priceRes = await resolveClosePrice(pos.coin, 'SELL');
        const exitPrice = priceRes.price;
        const markPrice = this.feed.getLastPrice(pos.coin);
        const pnlPct = pos.avgEntryPrice > 0 ? ((markPrice > 0 ? markPrice : exitPrice) - pos.avgEntryPrice) / pos.avgEntryPrice * 100 : 0;
        const stopTriggerPrice = pos.stopLossPercent > 0 ? pos.avgEntryPrice * (1 - pos.stopLossPercent / 100) : 0;
        const shouldStopLossSell = markPrice > 0 && stopTriggerPrice > 0 && markPrice <= stopTriggerPrice;
        const shouldTakeProfitSell = pos.tp1Percent > 0 && markPrice > 0 && markPrice >= pos.avgEntryPrice * (1 + pos.tp1Percent / 100);
        logger.info(`EXIT_EVALUATION_AUDIT: symbol=${pos.coin} positionId=${pos.tradeId ?? 'none'} strategyAtEntry=${pos.buySnapshot?.selectedStrategy ?? 'n/a'} entryPrice=${pos.avgEntryPrice} markPrice=${markPrice > 0 ? markPrice : exitPrice} markPriceSource=${markPrice > 0 ? 'feed' : priceRes.source} priceAgeMs=${now - (priceRes.capturedAt ?? 0)} qty=${pos.quantity} unrealizedPnlUsd=${((markPrice > 0 ? markPrice : exitPrice) - pos.avgEntryPrice) * pos.quantity} unrealizedPnlPct=${pnlPct.toFixed(2)} stopLossPct=${pos.stopLossPercent} stopLossSource=position stopTriggerPrice=${stopTriggerPrice.toFixed(4)} tp1Pct=${pos.tp1Percent} tp1TriggerPrice=${(pos.avgEntryPrice * (1 + pos.tp1Percent / 100)).toFixed(4)} tp2Pct=${pos.tp2Percent} trailingEnabled=${String(pos.trailFromPeakPercent > 0)} trailingActive=${String(pos.tpArmed)} trailingStopPrice=n/a shouldStopLossSell=${String(shouldStopLossSell)} shouldTakeProfitSell=${String(shouldTakeProfitSell)} shouldTrailingSell=false finalExitDecision=${shouldStopLossSell ? 'STOP_LOSS' : shouldTakeProfitSell ? 'TAKE_PROFIT' : 'HOLD'} noExitReason=${(!shouldStopLossSell && !shouldTakeProfitSell) ? (markPrice > 0 ? 'price_above_sl_and_below_tp' : 'no_live_price') : 'none'}`);
        if (shouldStopLossSell) {
          logger.warn(`STOP_LOSS_TRIGGER_AUDIT: symbol=${pos.coin} positionId=${pos.tradeId ?? 'none'} entryPrice=${pos.avgEntryPrice} markPrice=${markPrice} stopLossPct=${pos.stopLossPercent} stopTriggerPrice=${stopTriggerPrice.toFixed(4)} unrealizedPnlPct=${pnlPct.toFixed(2)} triggerMethod=price exitReason=STOP_LOSS_HIT adapterWillBeCalled=true`);
          const exitInput: ExitInput = {
            coin: pos.coin, entryPrice: pos.avgEntryPrice, quantity: pos.quantity,
            currentPrice: exitPrice, bidPrice: priceRes.bidPrice, askPrice: priceRes.askPrice, lastPrice: priceRes.lastPrice,
            priceTimestamp: priceRes.capturedAt, openedAt: pos.openedAt, highestPrice: pos.highestPrice,
            highestPriceSinceTp: pos.highestPriceSinceTp, tpArmed: pos.tpArmed, tp1Hit: pos.tp1Hit, tp2Hit: pos.tp2Hit,
            stopLossPercent: pos.stopLossPercent, tp1Percent: pos.tp1Percent, tp2Percent: pos.tp2Percent,
            trailFromPeakPercent: pos.trailFromPeakPercent, maxHoldSec: pos.maxHoldSec, mode: (brain.config.mode as any) ?? 'AUTO',
            isLive: this.adapter.isLive,
          };
          const decision = this.exitEngine.evaluateExit(exitInput);
          if (decision.shouldClosePosition) {
            exitSellCount++;
            await this.executeExitWithSnapshot(brain, pos, decision, priceRes);
          }
        } else if (shouldTakeProfitSell) {
          const exitInput: ExitInput = {
            coin: pos.coin, entryPrice: pos.avgEntryPrice, quantity: pos.quantity,
            currentPrice: exitPrice, bidPrice: priceRes.bidPrice, askPrice: priceRes.askPrice, lastPrice: priceRes.lastPrice,
            priceTimestamp: priceRes.capturedAt, openedAt: pos.openedAt, highestPrice: pos.highestPrice,
            highestPriceSinceTp: pos.highestPriceSinceTp, tpArmed: pos.tpArmed, tp1Hit: pos.tp1Hit, tp2Hit: pos.tp2Hit,
            stopLossPercent: pos.stopLossPercent, tp1Percent: pos.tp1Percent, tp2Percent: pos.tp2Percent,
            trailFromPeakPercent: pos.trailFromPeakPercent, maxHoldSec: pos.maxHoldSec, mode: (brain.config.mode as any) ?? 'AUTO',
            isLive: this.adapter.isLive,
          };
          const decision = this.exitEngine.evaluateExit(exitInput);
          if (decision.shouldClosePosition) {
            exitSellCount++;
            await this.executeExitWithSnapshot(brain, pos, decision, priceRes);
          }
        }
      } catch (e) {
        logger.warn(`EXIT_EVALUATION_ERROR: symbol=${pos.coin} reason=${e instanceof Error ? e.message : String(e)}`);
      }
    }
    logger.info(`EXIT_ENGINE_LIFECYCLE_AUDIT: scannerStatus=${this.running ? 'RUNNING' : 'STOPPED'} exitEngineEnabled=true openPositionsCount=${this.positionManager.getOpenPositions().length} positionManagerSubscribed=true lastExitEvaluationAt=${new Date().toISOString()} evaluationIntervalMs=5000 reasonIfNotRunning=none exitEvalCount=${exitEvalCount} exitSellCount=${exitSellCount}`);
    let exitCount = 0;
    for (const [, brain] of this.brains) {
      if (brain.config.mode === 'MANUAL') continue;

      try {
        if (brain.position) {
          exitCount++;
          await this.processExit(brain);
        } else {
          await this.processEntry(brain);
        }
      } catch (e) {
        logger.error(`Decision error [${brain.coin}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (exitCount > 0) {
      logger.throttled('INFO', `PAPER_POSITION_MONITOR_TICK: openCount=${exitCount}`, 'paper_monitor_tick', 30000);
    }
  }

  private lastDecision: TraderBrainDecision | null = null;
  private lastGateResult: EntryGateOutput | null = null;

  private logAutoExecutionContextCanonicalAudit(params: {
    symbol: string;
    ownershipResolution: ReturnType<typeof resolveAutoTargetOwnership>;
    contextValid: boolean;
    manualBuyRequest?: ManualBuyRequest;
    stage: 'pre_entry_gate' | 'pre_order_lock';
  }): void {
    const { symbol, ownershipResolution, contextValid, manualBuyRequest, stage } = params;
    logger.info(
      `AUTO_EXECUTION_CONTEXT_CANONICAL_AUDIT: symbol=${symbol} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(ownershipResolution.isAutoTargetOwned)} isScannerAutoTrade=${String(ownershipResolution.isScannerAutoTrade)} isManualTrade=${String(ownershipResolution.isManualTrade)} isManualOverride=${String(ownershipResolution.isManualOverride)} resolverPath=${ownershipResolution.resolverPath} contextValid=${String(contextValid)} manualBuyRequestPresent=${String(!!manualBuyRequest)} stage=${stage}`
    );
  }

  private logLegacyAutoBuyPathBlocked(params: {
    symbol: string;
    oldExecutionPath: string;
    autoBotsEnabled: boolean;
    scannerAutoEnabled: boolean;
    hasScannerCandidate: boolean;
  }): void {
    const { symbol, oldExecutionPath, autoBotsEnabled, scannerAutoEnabled, hasScannerCandidate } = params;
    logger.warn(
      `LEGACY_AUTO_BUY_PATH_BLOCKED: symbol=${symbol} oldExecutionPath=${oldExecutionPath} reason=legacy_auto_path_disabled_in_v4 autoBotsEnabled=${String(autoBotsEnabled)} scannerAutoEnabled=${String(scannerAutoEnabled)} hasScannerCandidate=${String(hasScannerCandidate)} canonicalReplacement=scanner_auto`
    );
  }

  private shouldSuppressLegacyBrainAutoEntry(brain: TraderBrain, decision: TraderBrainDecision): {
    suppress: boolean;
    scannerAutoEnabled: boolean;
    autoBotsEnabled: boolean;
  } {
    const scanner = this.autoRuntime.getScanner();
    const scannerAutoEnabled = scanner.isPaperAutoEnabled();
    const autoBotsEnabled = !scanner.isManualMode();
    const suppress = !brain.position && decision.mode === 'AUTO' && scannerAutoEnabled;
    return { suppress, scannerAutoEnabled, autoBotsEnabled };
  }

  private async processEntry(brain: TraderBrain): Promise<void> {
    const decision = await brain.decide();
    brain.lastDecision = decision;
    this.lastDecision = decision;

    if (decision.status !== 'BUY' || !decision.entryPlan) {
      return;
    }

    const legacyBrainAutoEntry = this.shouldSuppressLegacyBrainAutoEntry(brain, decision);
    if (legacyBrainAutoEntry.suppress) {
      this.logLegacyAutoBuyPathBlocked({
        symbol: decision.symbol,
        oldExecutionPath: 'brain_auto_entry',
        autoBotsEnabled: legacyBrainAutoEntry.autoBotsEnabled,
        scannerAutoEnabled: legacyBrainAutoEntry.scannerAutoEnabled,
        hasScannerCandidate: false,
      });
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${decision.symbol} reason=legacy_brain_auto_entry_suppressed strategy=${decision.selectedStrategy}`);
      return;
    }

    const ownershipResolution = resolveAutoTargetOwnership({
      executionPath: 'brain_auto_entry',
      mode: decision.mode,
    });
    const autoContextValid = !(!brain.position && decision.mode === 'AUTO' && ownershipResolution.resolverPath === 'unknown_non_auto');
    this.logAutoExecutionContextCanonicalAudit({
      symbol: decision.symbol,
      ownershipResolution,
      contextValid: autoContextValid,
      stage: 'pre_entry_gate',
    });
    if (!autoContextValid) {
      logger.warn(`AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED: symbol=${decision.symbol} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=false isScannerAutoTrade=false isManualTrade=false resolverPath=${ownershipResolution.resolverPath} reason=auto_buy_without_scanner_or_manual_context stage=pre_entry_gate`);
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${decision.symbol} reason=auto_target_ownership_context_missing strategy=${decision.selectedStrategy}`);
      return;
    }

    const mq = this.feed.getMarketDataQuality(decision.symbol);
    const filters = this.feed.getSymbolFilters(decision.symbol);

    const gateInput: EntryGateInput = {
      coin: decision.symbol,
      side: decision.entryPlan.side,
      price: decision.entryPlan.price,
      quantity: decision.entryPlan.quantity,
      mode: decision.mode,
      mlConfidence: decision.confidence,
      prediction: decision.selectedStrategy,
      currentPositions: this.countOpenPositions(),
      maxPositions: 10,
      recentLoss: false,
      spreadOk: !decision.blockReasons.some(r => r.includes('spread')) && mq.spreadOk,
      volumePass: !decision.blockReasons.some(r => r.includes('volume')),
      priceFresh: !decision.blockReasons.some(r => r.includes('stale') || r.includes('price')) && mq.priceFresh,
      btcDumping: decision.blockReasons.some(r => r.includes('btc') || r.includes('dump')),
      marketRegimeUnsafe: decision.blockReasons.some(r => r.includes('regime')),
      reboundConfirmed: !decision.blockReasons.some(r => r.includes('rebound')),
      momentumConfirmed: !decision.blockReasons.some(r => r.includes('momentum')),
      tpRoomOk: !decision.blockReasons.some(r => r.includes('tp') || r.includes('room')),
      isVeryHighRisk: decision.blockReasons.some(r => r.includes('risk') || r.includes('very_high')),
      isLive: this.adapter.isLive,
      marketDataOnline: mq.quality !== 'OFFLINE',
      bookFresh: mq.bookFresh,
      symbolTradable: filters ? filters.isSpotTradingAllowed && filters.status === 'TRADING' : undefined,
      minNotionalOk: undefined,
      lotSizeOk: undefined,
      tickSizeOk: undefined,
    };

    const gateResult = this.entryGate.evaluate(gateInput);
    this.lastGateResult = gateResult;

    if (gateResult.decision === 'ALLOW') {
      const enterAction: EnterAction = {
        type: 'ENTER',
        coin: decision.symbol,
        side: decision.entryPlan.side,
        quantity: decision.entryPlan.quantity,
        price: decision.entryPlan.price,
        mlConfidence: decision.confidence,
        prediction: decision.selectedStrategy,
        strategy: decision.selectedStrategy,
      };
      await this.executeEntry(enterAction, brain, decision, gateResult);
    } else {
      logger.warn(`Entry blocked by EntryGate [${decision.symbol}]: ${gateResult.explanation}`);
    }
  }

  private async executeEntry(
    action: EnterAction,
    brain: TraderBrain,
    decision?: TraderBrainDecision,
    gateResult?: EntryGateOutput,
    scannerCandidate?: ScannerCandidate,
    scannerSnapshot?: ScannerSnapshot,
    scalperCandidate?: ScalperCandidate,
    scalperSnapshot?: ScalperSnapshot,
    manualBuyRequest?: ManualBuyRequest,
    rejectedNearCandidates?: string[],
    executionContext?: { executionPath?: string; plannedScannerBuy?: boolean; scannerAutoEntryConfigSnapshot?: ScannerAutoEntryConfigSnapshot | null },
  ): Promise<void> {
    const coin = action.coin;
    const usedCapitalBefore = this.positionManager.getExposureSummary().totalExposure;
    const ownershipResolution = resolveAutoTargetOwnership({
      candidate: scannerCandidate,
      executionPath: executionContext?.executionPath,
      manualBuyRequest,
      mode: brain.mode,
    });
    const isAutoTargetOwned = ownershipResolution.isAutoTargetOwned;
    const isScannerAutoTrade = ownershipResolution.isScannerAutoTrade;
    const isManualTrade = ownershipResolution.isManualTrade;
    const isManualOverride = ownershipResolution.isManualOverride;
    const autoManagedScannerEntry = isScannerAutoTrade;
    const autoBotsOn = isAutoTargetOwned;
    const canonicalScannerContextValid = !isScannerAutoTrade || (
      ownershipResolution.executionPath === 'scanner_auto'
      && ownershipResolution.isAutoTargetOwned
      && ownershipResolution.isScannerAutoTrade
      && ownershipResolution.resolverPath === 'scanner_auto'
    );
    this.logAutoExecutionContextCanonicalAudit({
      symbol: coin,
      ownershipResolution,
      contextValid: canonicalScannerContextValid,
      manualBuyRequest,
      stage: 'pre_order_lock',
    });
    logger.info(`AUTO_TARGET_OWNERSHIP_RESOLVED: symbol=${coin} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} isManualTrade=${String(isManualTrade)} isManualOverride=${String(isManualOverride)} tp1Pct=pending tp1Source=pending tp2Pct=pending slPct=${brain.config.stopLossPercent} resolverPath=${ownershipResolution.resolverPath}`);
    if (!manualBuyRequest && brain.mode === 'AUTO' && !scannerCandidate && !scalperCandidate && ownershipResolution.resolverPath === 'unknown_non_auto') {
      logger.warn(`AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED: symbol=${coin} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=false isScannerAutoTrade=false isManualTrade=false resolverPath=${ownershipResolution.resolverPath} reason=auto_buy_without_scanner_or_manual_context stage=pre_order_lock`);
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${coin} reason=auto_target_ownership_context_missing strategy=${decision?.selectedStrategy ?? action.strategy}`);
      return;
    }
    if (scannerCandidate && !canonicalScannerContextValid) {
      logger.warn(`AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED: symbol=${coin} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} isManualTrade=${String(isManualTrade)} resolverPath=${ownershipResolution.resolverPath} reason=scanner_auto_context_not_canonical stage=pre_order_lock`);
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${coin} reason=auto_target_ownership_context_missing strategy=${decision?.selectedStrategy ?? action.strategy}`);
      return;
    }
    if (ownershipResolution.weakStrategySourceWouldMiss) {
      logger.warn(`AUTO_TARGET_OWNERSHIP_MISCLASSIFICATION_PREVENTED: symbol=${coin} executionPath=${ownershipResolution.executionPath} strategySource=${ownershipResolution.strategySource} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} isAutoTargetOwned=true previousDetection=manual_override resolverPath=${ownershipResolution.resolverPath}`);
    }
    const preLockOwnership = scannerCandidate
      ? (() => {
          const existingOwnership = scannerCandidate.tradingTargetOwnership;
          const ownershipIsAuto = existingOwnership && (
            existingOwnership.strategySource === 'autobots' ||
            existingOwnership.tp1Source === 'AutoBots dynamic per coin'
          );
          if (isScannerAutoTrade && !ownershipIsAuto) {
            logger.warn(`AUTO_TARGET_OWNERSHIP_OVERRIDE_MANUAL: symbol=${coin} existingTp1Source=${existingOwnership?.tp1Source ?? 'none'} existingTp2Source=${existingOwnership?.tp2Source ?? 'none'} existingTp2Value=${existingOwnership?.tp2Value ?? 'none'} reason=replacing_manual_ownership_with_auto ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source}`);
            return resolveTradingTargetOwnership(scannerCandidate, {
              strategySource: 'autobots',
              manualTp1Pct: 0,
              manualTp2Pct: 0,
              stopLossPct: brain.config.stopLossPercent,
              dynamicTrailingEnabled: Boolean((existingOwnership as any)?.dynamicTrailingEnabled ?? false),
              trailPullbackPct: 0.25,
              isScannerAutoTrade: true,
            });
          }
          return existingOwnership ?? resolveTradingTargetOwnership(scannerCandidate, {
            strategySource: isAutoTargetOwned ? 'autobots' : 'manual_override',
            manualTp1Pct: brain.config.takeProfitPercent,
            manualTp2Pct: brain.config.takeProfitPercent,
            stopLossPct: brain.config.stopLossPercent,
            dynamicTrailingEnabled: Boolean((existingOwnership as any)?.dynamicTrailingEnabled ?? false),
            trailPullbackPct: 0.25,
            isScannerAutoTrade,
          });
        })()
      : null;
    if (scannerCandidate && !scannerCandidate.tradingTargetOwnership) {
      scannerCandidate.tradingTargetOwnership = preLockOwnership as ScannerCandidate['tradingTargetOwnership'];
      logger.info(`TRADING_TARGET_OWNERSHIP_FALLBACK_RESOLVED: symbol=${coin} stage=pre_order_lock autoBotsOn=${String(autoBotsOn)} isAutoTargetOwned=${String(isAutoTargetOwned)} autoManagedScannerEntry=${String(autoManagedScannerEntry)} strategySourceRaw=${ownershipResolution.strategySource} resolverPath=${ownershipResolution.resolverPath} tp1Value=${String((preLockOwnership as any)?.tp1Value ?? 'n/a')} tp1Source=${String((preLockOwnership as any)?.tp1Source ?? 'n/a')} reason=missing_candidate_ownership`);
    }
    const preLockRisk = resolveEntryRiskParams({
      autoBotsOn,
      ownership: preLockOwnership,
      userStopLossPct: brain.config.stopLossPercent,
      userTrailPullbackPct: 0.25,
    });
    logger.info(`AUTO_TARGET_OWNERSHIP_RESOLVED: symbol=${coin} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} strategySource=${ownershipResolution.strategySource} isAutoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} isManualTrade=${String(isManualTrade)} isManualOverride=${String(isManualOverride)} tp1Pct=${preLockRisk.tp1} tp1Source=${preLockRisk.sourceTp1} tp2Pct=${preLockRisk.tp2} slPct=${preLockRisk.sl} resolverPath=${ownershipResolution.resolverPath}`);
    if (isScannerAutoTrade && preLockRisk.sourceTp1 === 'user') {
      logger.warn(`AUTO_TARGET_OWNERSHIP_HARD_BLOCK_MANUAL_TP1: symbol=${coin} tp1=${preLockRisk.tp1} tp1Source=${preLockRisk.sourceTp1} reason=scanner_auto_requires_autobots_tp1 stage=pre_order_lock`);
      return;
    }
    if (isScannerAutoTrade && preLockRisk.tp2 !== 0) {
      logger.warn(`AUTO_TARGET_OWNERSHIP_HARD_BLOCK_NONZERO_TP2: symbol=${coin} tp2=${preLockRisk.tp2} tp2Source=${preLockRisk.sourceTp2} reason=scanner_auto_requires_tp2_zero stage=pre_order_lock`);
      return;
    }
    if (isScannerAutoTrade && preLockRisk.sourceTp2 === 'user') {
      logger.warn(`AUTO_TARGET_OWNERSHIP_HARD_BLOCK_MANUAL_TP2: symbol=${coin} tp2=${preLockRisk.tp2} tp2Source=${preLockRisk.sourceTp2} reason=scanner_auto_requires_autobots_tp2_zero stage=pre_order_lock`);
      return;
    }
    if (autoBotsOn && !preLockRisk.tp1Valid) {
      logger.warn(`AUTOBOTS_TP1_INVALID_BLOCKED: symbol=${coin} tp1=${preLockRisk.tp1} sourceTp1=${preLockRisk.sourceTp1} reason=${preLockRisk.tp1InvalidReason} buyAllowed=false stage=pre_order_lock`);
      logger.warn(`BUY_BLOCKED_FINAL_EXECUTABLE_FALSE: symbol=${coin} reason=tp1_missing_or_zero strategy=${scannerCandidate?.selectedStrategy ?? action.strategy}`);
      return;
    }
    logger.info(`ENTRY_RISK_PARAMS_RESOLVED: symbol=${coin} executionPath=${ownershipResolution.executionPath} ownerType=${ownershipResolution.ownerType} ownerName=${ownershipResolution.ownerName} source=${ownershipResolution.source} mode=${ownershipResolution.mode} isAutoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} isManualOverride=${String(isManualOverride)} resolverPath=${ownershipResolution.resolverPath} tp1Pct=${preLockRisk.tp1} tp1Source=${preLockRisk.sourceTp1} tp2Pct=${preLockRisk.tp2} tp2Source=${preLockRisk.sourceTp2} slPct=${preLockRisk.sl} slSource=${preLockRisk.sourceSl}`);
    const manualOwnership = !scannerCandidate
      ? {
        strategySource: 'manual_override' as const,
        tp1Source: 'user' as const,
        tp1Value: brain.config.takeProfitPercent,
        tp2Source: 'user' as const,
        tp2Value: brain.config.takeProfitPercent,
        slSource: 'user' as const,
        slValue: brain.config.stopLossPercent,
        dynamicTrailingEnabled: false,
        trailingStartSource: 'user' as const,
        trailingStartsAt: brain.config.takeProfitPercent,
        trailPullbackSource: 'user' as const,
        trailPullbackValue: 0.25,
        reason: 'manual_override_user_targets',
      }
      : null;
    const banVerdict = isSymbolBannedForTrading(coin, undefined, 'USDT', this.getBanlist());
    if (banVerdict.banned) {
      const msg = `BUY blocked: ${coin} is banned / hard-blocked asset`;
      this.lastPreAdapterBlockReason = banVerdict.reason === 'hard_blocked_asset' ? 'GLOBAL_BANNED_ASSET' : `GLOBAL_BANNED_SYMBOL:${banVerdict.reason}`;
      if (banVerdict.reason === 'hard_blocked_asset') logger.warn(`BUY_BLOCKED_HARD_BLOCKED_ASSET: symbol=${coin} reason=${banVerdict.reason}`);
      else logger.warn(`BUY_BLOCKED_BANNED_SYMBOL: symbol=${coin} reason=${banVerdict.reason}`);
      logger.info(`BANLIST_ENFORCEMENT_AUDIT: symbol=${coin} stage=TradingEngine.executeEntry blocked=true reason=${banVerdict.reason}`);
      logger.warn(msg);
      return;
    }

    // Pre-adapter checks: PositionManager + OrderLockManager
    if (this.positionManager.hasOpenPosition(coin)) {
      this.lastPreAdapterBlockReason = 'DUPLICATE_OPEN_POSITION';
      logger.warn(`BUY_BLOCKED_BY_POSITION_MANAGER: ${coin} — position already open`);
      return;
    }

    const lockResult = this.orderLockManager.acquireLock({
      symbol: coin,
      side: 'BUY',
      mode: brain.mode,
      adapter: this.adapter.isLive ? 'live' : 'paper',
      reason: `entry:${action.strategy}`,
      ownerId: brain.mode,
    });

    if (!lockResult.acquired) {
      this.lastPreAdapterBlockReason = 'PENDING_ORDER_LOCK';
      logger.warn(`BUY_BLOCKED_BY_ORDER_LOCK: ${coin} — ${lockResult.reason}`);
      return;
    }

    const acquiredLock = lockResult.lock!;
    let lockReleased = false;
    const releaseLock = () => {
      if (!lockReleased) {
        this.orderLockManager.releaseLock(acquiredLock.lockId, 'entry_complete');
        lockReleased = true;
      }
    };

    try {
      if (scannerCandidate && scalperCandidate) {
        this.lastPreAdapterBlockReason = 'SOURCE_CROSS_CONTAMINATION';
        logger.warn(`SOURCE_CROSS_CONTAMINATION_BLOCKED: symbol=${coin} scannerCandidate=true scalperCandidate=true buyAllowed=false reason=dual_candidate_sources_detected`);
        releaseLock();
        return;
      }
      const canonicalEntryConfigSnapshot = executionContext?.scannerAutoEntryConfigSnapshot ?? null;
      let strategyAuditSnapshot: ReturnType<typeof buildStrategyAuditSnapshotFromCandidate> | null = null;
      if (scannerCandidate) {
        strategyAuditSnapshot = canonicalEntryConfigSnapshot?.strategyAuditSnapshot
          ? canonicalEntryConfigSnapshot.strategyAuditSnapshot as unknown as ReturnType<typeof buildStrategyAuditSnapshotFromCandidate>
          : buildStrategyAuditSnapshotFromCandidate(scannerCandidate);
        if (canonicalEntryConfigSnapshot) {
          const contractHash = buildEntryConfigSnapshotContractHash(canonicalEntryConfigSnapshot);
          logger.info(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${coin} boundary=before_precondition_check snapshotPresent=true selectedStrategy=${canonicalEntryConfigSnapshot.selectedStrategy} finalEntryRule=${canonicalEntryConfigSnapshot.finalEntryRule} contractHash=${contractHash} contractValid=${String(canonicalEntryConfigSnapshot.finalExecutable && canonicalEntryConfigSnapshot.buyAllowed && canonicalEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))} semanticValid=${String(canonicalEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait' && !canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))}`);
        } else {
          logger.error(`ENTRY_CONFIG_SNAPSHOT_CONTRACT_AUDIT: symbol=${coin} boundary=before_precondition_check snapshotPresent=false selectedStrategy=missing finalEntryRule=missing contractHash=missing contractValid=false`);
        }
        if (!strategyAuditSnapshot.finalExecutableAtEntry) {
          this.lastPreAdapterBlockReason = `STRATEGY_SETUP_NOT_MET:${strategyAuditSnapshot.strategySelected}:${strategyAuditSnapshot.setupMissing.map((s) => s.key).join('|') || 'unknown'}`;
          logger.warn(
            `BUY_BLOCKED_STRATEGY_SETUP_NOT_MET: symbol=${coin} strategy=${strategyAuditSnapshot.strategySelected} actualDipPct=${String(strategyAuditSnapshot.setupMetrics.find((m) => m.key === 'actualDipPct')?.actualValue ?? 'n/a')} requiredDipPct=${String(strategyAuditSnapshot.setupMetrics.find((m) => m.key === 'requiredDipPct')?.requiredValue ?? 'n/a')} actualReboundPct=${String(strategyAuditSnapshot.setupMetrics.find((m) => m.key === 'actualReboundPct')?.actualValue ?? 'n/a')} requiredReboundPct=${String(strategyAuditSnapshot.setupMetrics.find((m) => m.key === 'requiredReboundPct')?.requiredValue ?? 'n/a')} setupMissing=${strategyAuditSnapshot.setupMissing.map((s) => s.key).join('|') || 'none'} finalExecutable=${String(strategyAuditSnapshot.finalExecutableAtEntry)}`
          );
          releaseLock();
          return;
        }
      }

      const ownership = scannerCandidate?.tradingTargetOwnership ?? preLockOwnership ?? manualOwnership;
      const resolvedRisk = resolveEntryRiskParams({
        autoBotsOn,
        ownership,
        userStopLossPct: brain.config.stopLossPercent,
        userTrailPullbackPct: 0.25,
      });
      logger.info(`ENTRY_RISK_PARAMS_RESOLVED: symbol=${coin} autoBotsOn=${String(autoBotsOn)} isAutoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} isManualTrade=${String(isManualTrade)} resolverPath=${ownershipResolution.resolverPath} strategy=${scannerCandidate?.selectedStrategy ?? action.strategy} tp1=${resolvedRisk.tp1} tp2=${resolvedRisk.tp2} sl=${resolvedRisk.sl} userSL=${brain.config.stopLossPercent} dynamicTrailingEnabled=${String(resolvedRisk.dynamicTrailingEnabled)} trailStart=${String(resolvedRisk.trailStart)} trailPullback=${resolvedRisk.trailPullback} sourceTp1=${resolvedRisk.sourceTp1} sourceTp2=${resolvedRisk.sourceTp2} sourceSl=${resolvedRisk.sourceSl} sourceTrailPullback=${resolvedRisk.sourceTrailPullback} corrected=${String(resolvedRisk.corrected)} reason=${resolvedRisk.correctionReason}`);
      logger.info(`AUTOBOTS_TP2_ZERO_ENFORCEMENT_AUDIT: symbol=${coin} autoBotsOn=${String(autoBotsOn)} tp2=${resolvedRisk.tp2} corrected=${String(resolvedRisk.corrected)} reason=${resolvedRisk.correctionReason}`);
      if (autoBotsOn && resolvedRisk.tp2 !== 0) logger.warn(`TP2_AUTOBOTS_RULE_VIOLATION: symbol=${coin} tp2=${resolvedRisk.tp2} expected=0`);
      if (autoBotsOn && !resolvedRisk.tp1Valid) {
        this.lastPreAdapterBlockReason = 'TP1_INVALID';
        logger.warn(`AUTOBOTS_TP1_INVALID_BLOCKED: symbol=${coin} tp1=${resolvedRisk.tp1} sourceTp1=${resolvedRisk.sourceTp1} reason=${resolvedRisk.tp1InvalidReason} buyAllowed=false stage=pre_position_manager_add`);
        releaseLock();
        return;
      }

      const req: OrderRequest = {
        coin,
        side: action.side,
        quantity: action.quantity,
        price: action.price,
        mode: brain.mode,
      };

      const openPosSymbols = this.positionManager.getOpenPositions().map(p => p.coin);
      const groupExposures = this.buildGroupExposures();
      const symbolFilters = this.feed.getSymbolFilters(coin);
      const riskInput: RiskInput = {
        symbol: coin,
        mode: brain.mode,
        side: action.side,
        quantity: action.quantity,
        price: action.price,
        estimatedValue: action.price * action.quantity,
        mlConfidence: action.mlConfidence ?? 0,
        riskGroup: scannerCandidate?.riskGroup ?? scalperCandidate?.riskGroup ?? null,
        currentPositions: this.positionManager.getOpenPositions().length,
        totalOpenPositions: this.positionManager.getOpenPositions().length,
        dailyPnlUsd: this._dailyPnlUsd,
        accountBalance: this._accountBalance,
        consecutiveLosses: this._consecutiveLosses,
        winRate: this._winRate,
        dailyTradeCount: this._dailyTradeCount,
        maxDrawdownPercent: this._maxDrawdownPercent,
        groupExposures,
        config: this.riskEngine.getConfig(),
        filters: symbolFilters,
        positionSymbols: openPosSymbols,
      };
      const preAdapterRiskDecision = this.riskEngine.evaluateRisk(riskInput);

      if (preAdapterRiskDecision.verdict === 'BLOCK') {
        this.lastRiskBlockReason = String(preAdapterRiskDecision.explanation ?? preAdapterRiskDecision.blockReasons?.join('|') ?? 'risk_engine_block');
        const riskGroup = scannerCandidate?.riskGroup ?? 'unknown';
        const groupExposuresSnapshot = groupExposures.find(g => g.riskGroup === riskGroup);
        const maxGroupPos = this.riskEngine.getConfig().maxPositionsPerRiskGroup[riskGroup] ?? 3;
        const maxGroupExp = this.riskEngine.getConfig().maxExposurePerRiskGroup?.[riskGroup] ?? 5000;
        const groupOpenCount = groupExposuresSnapshot?.currentPositions ?? 0;
        const groupExposureUsd = groupExposuresSnapshot?.currentExposureUsd ?? 0;
        logger.info(`RISK_GROUP_POSITION_LIMIT_AUDIT: symbol=${coin} riskGroup=${riskGroup} marketGroup=${scannerCandidate?.groupTrend ?? 'n/a'} currentOpenPositionsInGroup=${groupOpenCount} maxOpenPositionsInGroup=${maxGroupPos} wouldExceedGroupLimit=${String(groupOpenCount >= maxGroupPos)} blockReason=${preAdapterRiskDecision.blockReasons?.join('|') || preAdapterRiskDecision.explanation || 'none'} sourceOfLimit=RiskEngine maxPositionsPerRiskGroup userConfiguredLimit=${maxGroupPos} defaultLimit=3 positionManagerOpenCount=${this.positionManager.getOpenPositions().length}`);
        logger.info(`GROUP_RISK_CAP_AUDIT: symbol=${coin} groupName=${riskGroup} groupOpenCount=${groupOpenCount} groupMaxOpen=${maxGroupPos} groupExposureUsd=${groupExposureUsd.toFixed(2)} groupMaxExposureUsd=${maxGroupExp} globalOpenCount=${this.positionManager.getOpenPositions().length} globalMaxOpen=50 capitalAvailable=${this._accountBalance} blocked=true exactBlockReason=${preAdapterRiskDecision.blockReasons?.join('|') || preAdapterRiskDecision.explanation || 'risk_engine_blocked'}`);
        logger.warn(`Entry blocked by RiskEngine BEFORE adapter [${coin}]: ${preAdapterRiskDecision.explanation}`);
        logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=pre_risk_blocked entryConfigSnapshotComplete=false riskSnapshotComplete=false preRiskValidationPassed=false preRiskBlockReason=${preAdapterRiskDecision.explanation.replace(/\s+/g, '_')} adapterWillBeCalled=false adapterCalled=false adapterStatus=NOT_SUBMITTED brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
        releaseLock();
        return;
      }

      const riskGroup = scannerCandidate?.riskGroup ?? scalperCandidate?.riskGroup ?? 'unknown';
      const groupExposuresSnapshot = groupExposures.find(g => g.riskGroup === riskGroup);
      logger.info(`GROUP_RISK_CAP_AUDIT: symbol=${coin} groupName=${riskGroup} groupOpenCount=${groupExposuresSnapshot?.currentPositions ?? 0} groupMaxOpen=${this.riskEngine.getConfig().maxPositionsPerRiskGroup[riskGroup] ?? 999} groupExposureUsd=${(groupExposuresSnapshot?.currentExposureUsd ?? 0).toFixed(2)} groupMaxExposureUsd=${this.riskEngine.getConfig().maxExposurePerRiskGroup?.[riskGroup] ?? 999999} totalOpenCount=${this.positionManager.getOpenPositions().length} maxOpenPositions=50 totalUsedCapitalUsd=${this.positionManager.getExposureSummary().totalExposure} tradingCapitalUsd=${this._accountBalance} maxCapitalAtRiskUsd=${this.riskEngine.getConfig().maxCapitalAtRiskTotal} maxCapitalAtRiskPct=${this.riskEngine.getConfig().maxCapitalAtRiskTotal > 0 && this._accountBalance > 0 ? (this.positionManager.getExposureSummary().totalExposure / this._accountBalance * 100).toFixed(1) : 'n/a'} groupPositionsOk=true groupExposureOk=true capitalAtRiskOk=true blocked=false exactBlockReason=none`);

      const preconditionMissingFields: string[] = [];
      const preEntryStrategy = strategyAuditSnapshot;
      const preEffectiveStrategy = String(canonicalEntryConfigSnapshot?.selectedStrategy ?? preEntryStrategy?.strategySelected ?? (preEntryStrategy as any)?.selectedStrategy ?? action.strategy ?? '').trim();
      const preEffectiveEntryRule = String(canonicalEntryConfigSnapshot?.finalEntryRule ?? preEntryStrategy?.finalEntryRule ?? (preEntryStrategy as any)?.setupResult ?? ((decision as any)?.ruleDecisionTrace?.unifiedSignal?.reasonCode as string | undefined) ?? decision?.selectedPlaybook ?? '').trim();
      const strategySnapshotPresent = !scannerCandidate || !!preEntryStrategy;
      const entryConfigSnapshotPresent = !scannerCandidate || !!canonicalEntryConfigSnapshot;
      if (scannerCandidate && (!preEffectiveStrategy || preEffectiveStrategy.toLowerCase() === 'unknown' || preEffectiveStrategy === 'wait')) preconditionMissingFields.push('selectedStrategy');
      if (scannerCandidate && (!preEffectiveEntryRule || preEffectiveEntryRule.toUpperCase().includes('UNKNOWN') || preEffectiveEntryRule.toUpperCase().includes('WAITING_FOR_SETUP'))) preconditionMissingFields.push('finalEntryRule');
      const preFinalExecutableAtEntry = Boolean(canonicalEntryConfigSnapshot?.finalExecutableAtEntry ?? (preEntryStrategy as any)?.finalExecutableAtEntry ?? (preEntryStrategy as any)?.finalExecutable);
      const preEntryConfirmedAtEntry = Boolean(canonicalEntryConfigSnapshot?.entryConfirmedAtEntry ?? (preEntryStrategy as any)?.entryConfirmedAtEntry);
      if (scannerCandidate && !entryConfigSnapshotPresent) preconditionMissingFields.push('entryConfigSnapshot');
      if (scannerCandidate && !preFinalExecutableAtEntry) preconditionMissingFields.push('finalExecutableAtEntry');
      if (scannerCandidate && !preEntryConfirmedAtEntry) preconditionMissingFields.push('entryConfirmedAtEntry');
      const tp1Present = Number.isFinite(Number(resolvedRisk.tp1)) && Number(resolvedRisk.tp1) > 0;
      const tp2IsZero = Number(resolvedRisk.tp2) === 0;
      const slPresent = Number.isFinite(Number(resolvedRisk.sl)) && Number(resolvedRisk.sl) > 0;
      if (autoBotsOn && !tp1Present) preconditionMissingFields.push('tp1');
      if (isScannerAutoTrade && !tp2IsZero) preconditionMissingFields.push('tp2IsZero');
      if (!slPresent) preconditionMissingFields.push('sl');
      const riskSnapshotComplete = tp1Present && slPresent && (!isScannerAutoTrade || tp2IsZero);
      const entryConfigSnapshotComplete = entryConfigSnapshotPresent && strategySnapshotPresent && (!scannerCandidate || preconditionMissingFields.filter((field) => field !== 'tp1' && field !== 'tp2IsZero' && field !== 'sl').length === 0);
      const snapshotContractValid = scannerCandidate && canonicalEntryConfigSnapshot
        ? canonicalEntryConfigSnapshot.finalExecutable && canonicalEntryConfigSnapshot.buyAllowed
          && canonicalEntryConfigSnapshot.selectedStrategy.toLowerCase() !== 'wait'
          && !canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')
        : !scannerCandidate;
      const adapterWillBeCalled = entryConfigSnapshotComplete && riskSnapshotComplete;
      logger.info(`SNAPSHOT_PRECONDITION_AUDIT: symbol=${coin} entryConfigSnapshotPresent=${String(entryConfigSnapshotPresent)} strategySnapshotPresent=${String(strategySnapshotPresent)} riskSnapshotPresent=${String(riskSnapshotComplete)} tp1Present=${String(tp1Present)} tp2IsZero=${String(tp2IsZero)} slPresent=${String(slPresent)} autoTargetOwned=${String(isAutoTargetOwned)} isScannerAutoTrade=${String(isScannerAutoTrade)} missingFields=${preconditionMissingFields.join('|') || 'none'} snapshotContractValid=${String(snapshotContractValid)} adapterWillBeCalled=${String(adapterWillBeCalled)}`);
      if (!adapterWillBeCalled) {
        this.lastPreAdapterBlockReason = `PRECONDITION_INCOMPLETE:${preconditionMissingFields.join('|') || 'unknown'}`;
        logger.warn(`POSITION_ENTRY_SNAPSHOT_INCOMPLETE_BLOCKED: symbol=${coin} positionId=not_created missingFields=${preconditionMissingFields.join('|') || 'none'} selectedStrategy=${preEffectiveStrategy || 'missing'} finalEntryRule=${preEffectiveEntryRule || 'missing'} setupResult=${String((preEntryStrategy as any)?.setupResult ?? 'n/a')} sourceCandidateId=${scannerCandidate?.candidateId ?? 'none'} executionPath=${executionContext?.executionPath ?? 'executeEntry'} ownerDisplay=${ownershipResolution.ownerName ?? 'unknown'} stage=pre_adapter buyAllowed=false snapshotContractValid=${String(snapshotContractValid)} strategySnapshotPresent=${String(strategySnapshotPresent)}`);
        logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=precondition_blocked entryConfigSnapshotComplete=${String(entryConfigSnapshotComplete)} riskSnapshotComplete=${String(riskSnapshotComplete)} preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=false adapterCalled=false adapterStatus=NOT_SUBMITTED brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
        releaseLock();
        return;
      }

      const tradeId = nextTradeId();
      const buildRiskParamsSnapshot = (entryPrice: number) => {
        const tp1PctAtSnapshot = Number(resolvedRisk.tp1);
        return {
          schemaVersion: 'cryptobud-v4-risk-snapshot-v1',
          positionId: tradeId,
          symbol: coin,
          entryPrice,
          tp1Pct: tp1PctAtSnapshot,
          tp1TargetPrice: Number(entryPrice * (1 + (tp1PctAtSnapshot / 100))),
          tp1Source: resolvedRisk.sourceTp1,
          sourceTp1: resolvedRisk.sourceTp1,
          tp1Min: Number.isFinite(Number((ownership as any)?.tp1Min)) ? Number((ownership as any).tp1Min) : null,
          tp1Max: Number.isFinite(Number((ownership as any)?.tp1Max)) ? Number((ownership as any).tp1Max) : null,
          tp1Reason: String((ownership as any)?.tp1Reason ?? ownership?.reason ?? 'n/a'),
          tp2Pct: Number(resolvedRisk.tp2),
          tp2Source: resolvedRisk.sourceTp2,
          sourceTp2: resolvedRisk.sourceTp2,
          slPct: Number(resolvedRisk.sl),
          slSource: resolvedRisk.sourceSl,
          sourceSl: resolvedRisk.sourceSl,
          dynamicTrailingEnabled: Boolean(resolvedRisk.dynamicTrailingEnabled),
          trailStartPct: resolvedRisk.trailStart,
          trailPullbackPct: Number(resolvedRisk.trailPullback),
          sourceTrailPullback: resolvedRisk.sourceTrailPullback,
          tradingTargetOwnership: ownership ?? null,
          autoBotsOnAtEntry: autoBotsOn,
          createdAt: new Date().toISOString(),
        };
      };
      const preAdapterRiskParamsSnapshot = buildRiskParamsSnapshot(action.price);
      const preAdapterEntryConfigSnapshot = scannerCandidate && strategyAuditSnapshot ? {
        ...(canonicalEntryConfigSnapshot ?? {
          schemaVersion: 'cryptobud-v4-scanner-auto-entry-config-v1',
          symbol: coin,
          scanId: scannerSnapshot?.scanId ?? null,
          sourceCandidateId: scannerCandidate?.candidateId ?? null,
          selectedStrategy: strategyAuditSnapshot.selectedStrategy,
          finalEntryRule: strategyAuditSnapshot.finalEntryRule,
          setupResult: String((strategyAuditSnapshot as any).setupResult ?? strategyAuditSnapshot.finalEntryRule),
          finalExecutable: strategyAuditSnapshot.finalExecutable,
          finalExecutableAtEntry: strategyAuditSnapshot.finalExecutableAtEntry,
          buyAllowed: strategyAuditSnapshot.buyAllowed,
          entryConfirmedAtEntry: Boolean(strategyAuditSnapshot.entryConfirmedAtEntry),
          entryStatus: scannerCandidate.status,
          entryGateDecision: gateResult?.decision ?? scannerCandidate.entryGateDecision?.decision ?? 'ALLOW',
          confidence: scannerCandidate.confidence,
          executionPath: 'scanner_auto',
          ownerType: 'scanner',
          ownerName: 'The Dipper',
          source: 'AutoBots',
          strategySource: String(scannerCandidate.strategySource ?? 'unknown'),
          strategySourceDetail: scannerCandidate.strategySourceDetail ?? null,
          strategyReason: scannerCandidate.strategyReason ?? null,
          entryPrice: action.price,
          quantity: action.quantity,
          capitalAllocated: Number((scannerCandidate as any).capitalAllocation ?? action.price * action.quantity),
          tp1Pct: Number(resolvedRisk.tp1),
          tp1Source: String(resolvedRisk.sourceTp1),
          tp2Pct: Number(resolvedRisk.tp2),
          tp2Source: String(resolvedRisk.sourceTp2),
          slPct: Number(resolvedRisk.sl),
          slSource: String(resolvedRisk.sourceSl),
          dynamicTrailingEnabled: Boolean(resolvedRisk.dynamicTrailingEnabled),
          trailStart: resolvedRisk.trailStart,
          trailPullbackPct: Number(resolvedRisk.trailPullback),
          riskParams: preAdapterRiskParamsSnapshot,
          strategyAuditSnapshot: strategyAuditSnapshot as unknown as Record<string, unknown>,
          createdAt: strategyAuditSnapshot.createdAt,
        }),
        riskParams: preAdapterRiskParamsSnapshot,
        strategyAuditSnapshot,
        entryPrice: action.price,
        quantity: action.quantity,
        capitalAllocated: Number((canonicalEntryConfigSnapshot as any)?.capitalAllocated ?? (scannerCandidate as any).capitalAllocation ?? action.price * action.quantity),
        tp1Pct: Number(resolvedRisk.tp1),
        tp1Source: String(resolvedRisk.sourceTp1),
        tp2Pct: Number(resolvedRisk.tp2),
        tp2Source: String(resolvedRisk.sourceTp2),
        slPct: Number(resolvedRisk.sl),
        slSource: String(resolvedRisk.sourceSl),
      } : null;
      logger.info(`SNAPSHOT_PRECONDITION_MATERIALIZED_AUDIT: symbol=${coin} positionId=${tradeId} scanId=${scannerSnapshot?.scanId ?? 'n/a'} entryConfigSnapshotPresent=${String(!scannerCandidate || !!preAdapterEntryConfigSnapshot)} riskSnapshotPresent=${String(!!preAdapterRiskParamsSnapshot)} strategySnapshotPresent=${String(!scannerCandidate || !!preAdapterEntryConfigSnapshot?.strategyAuditSnapshot)} entryPrice=${preAdapterRiskParamsSnapshot.entryPrice} tp1Pct=${preAdapterRiskParamsSnapshot.tp1Pct} tp2Pct=${preAdapterRiskParamsSnapshot.tp2Pct} slPct=${preAdapterRiskParamsSnapshot.slPct} adapterWillBeCalled=true`);
      logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=pre_adapter_validated entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=false adapterStatus=READY brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);

      const result = await this.adapter.submitOrder(req);
      if (result.status !== 'filled') {
        logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=adapter_rejected entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
        releaseLock();
        return;
      }
      emitVisualExecutionEvent({
        symbol: coin,
        tradeId,
        event: "BUY_FILLED",
        timestamp: Date.now(),
        scanId: scannerSnapshot?.scanId ?? undefined,
        mode: brain.mode,
        sourcePath: "TradingEngine.executePlannedScannerBuy",
      });
      logger.info(`ENTRY_PRICE_SOURCE_AUDIT: symbol=${coin} rawEntryPrice=${result.price} entryPriceSource=${result.price > 0 ? 'adapter_result_price' : 'invalid'} adapterType=${this.adapter.name} qty=${result.quantity} notional=${(result.price * result.quantity).toFixed(8)} mode=${brain.mode} isDemo=${this.adapter.name === 'Paper' ? 'true' : 'false'}`);
      logger.info(`CAPITAL_PER_COIN_ENTRY_AUDIT: symbol=${coin} mode=${brain.mode.toLowerCase()} strategySource=${scannerCandidate?.strategySource ?? 'engine_entry'} userCapitalPerCoin=${Number((scannerCandidate as any)?.capitalAllocation ?? 0)} resolvedCapitalPerCoin=${(result.price * result.quantity).toFixed(4)} finalOrderNotionalUsd=${(result.price * result.quantity).toFixed(4)} qty=${result.quantity} entryPrice=${result.price} minNotional=${this.feed.getSymbolFilters(coin)?.minNotional ?? 0} maxOpenPositions=10 availableCapital=${this._accountBalance} usedCapitalBefore=${usedCapitalBefore} usedCapitalAfter=${usedCapitalBefore} reason=entry_submitted source=execution_result`);

      const price = await this.feed.getPrice(coin);
      {
        const refPrice = price.last > 0 ? price.last : (scannerCandidate ? (Number(scannerCandidate.price) || 0) : 0);
        if (refPrice > 0 && result.price > 0) {
          const deviationPct = Math.abs(result.price - refPrice) / refPrice * 100;
          const maxAllowedDeviationPct = 5;
          if (deviationPct > maxAllowedDeviationPct) {
            logger.error(`ENTRY_PRICE_DEVIATION_BLOCKED: symbol=${coin} entryPrice=${result.price} refPrice=${refPrice} lastPrice=${result.price} bookBid=${price.bid} bookAsk=${price.ask} deviationPct=${deviationPct.toFixed(2)} maxAllowedDeviationPct=${maxAllowedDeviationPct} entryPriceSource=adapter_result_price mode=${brain.mode} positionCreateAllowed=false reason=price_deviation_exceeds_threshold`);
            logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=entry_price_deviation_blocked entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=entry_price_deviation openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
            releaseLock();
            return;
          }
        }
      }
      const mlPred = this.ml.predict(coin);

      const poolSize = scannerSnapshot?.candidates.length ?? scalperSnapshot?.candidates.length ?? null;
      const topCandidateSymbols = scannerSnapshot
        ? scannerSnapshot.candidates.slice(0, 5).map(c => c.symbol)
        : scalperSnapshot
          ? scalperSnapshot.candidates.slice(0, 5).map(c => c.symbol)
          : [];

      const openPosSymbolsPost = this.positionManager.getOpenPositions().map(p => p.coin);
      const riskInputPost: RiskInput = {
        symbol: coin,
        mode: brain.mode,
        side: action.side,
        quantity: action.quantity,
        price: result.price,
        estimatedValue: result.price * result.quantity,
        mlConfidence: action.mlConfidence ?? 0,
        riskGroup: scannerCandidate?.riskGroup ?? scalperCandidate?.riskGroup ?? null,
        currentPositions: this.positionManager.getOpenPositions().length,
        totalOpenPositions: this.positionManager.getOpenPositions().length,
        dailyPnlUsd: this._dailyPnlUsd,
        accountBalance: this._accountBalance,
        consecutiveLosses: this._consecutiveLosses,
        winRate: this._winRate,
        dailyTradeCount: this._dailyTradeCount,
        maxDrawdownPercent: this._maxDrawdownPercent,
        groupExposures: this.buildGroupExposures(),
        config: this.riskEngine.getConfig(),
        filters: this.feed.getSymbolFilters(coin),
        positionSymbols: openPosSymbolsPost,
      };
      const riskDecision = this.riskEngine.evaluateRisk(riskInputPost);

      if (riskDecision.verdict === 'BLOCK') {
        logger.warn(`POST_FILL_RISK_SANITY_WARNING: symbol=${coin} explanation=${riskDecision.explanation} — preAdapterCheckPassed=true, continuing with position creation`);
      }

      const scalperFields = scalperCandidate ? {
        scalperCandidateId: scalperCandidate.candidateId,
        scalperSnapshotId: scalperSnapshot?.snapshotId ?? null,
        scalpScore: scalperCandidate.scalpScore,
        scalpScoreThreshold: scalperCandidate.scalpScoreThreshold,
        componentScores: scalperCandidate.componentScores,
        componentPass: scalperCandidate.componentPass,
        radarStats: scalperSnapshot?.radarStats ?? null,
        volumeSurgePct: scalperCandidate.volumeSurgePct,
        spreadPct: scalperCandidate.spreadPct,
        momentumScore: scalperCandidate.momentumScore,
        priceAgeMs: scalperCandidate.priceAgeMs,
        scalperConfigSnapshot: {
          tp1Pct: scalperCandidate.tp1Pct,
          tp2Pct: scalperCandidate.tp2Pct,
          stopLossPct: scalperCandidate.stopLossPct,
          maxHoldSec: scalperCandidate.maxHoldSec,
          trailTriggerPct: scalperCandidate.trailTriggerPct,
          trailPullbackPct: scalperCandidate.trailPullbackPct,
        },
      } : {};

      const manualFields = manualBuyRequest ? {
        manualAnalysisId: manualBuyRequest.analysisId,
        manualUserConfirmed: manualBuyRequest.manualUserConfirmed,
      } : {};

      const buySnapshot: BuySnapshot = {
        schemaVersion: 'cryptobud-v4-buy-v1',
        tradeId,
        createdAt: new Date().toISOString(),
        symbol: action.coin,
        mode: brain.mode,
        adapter: this.adapter.name,
        riskGroup: scannerCandidate?.riskGroup ?? scalperCandidate?.riskGroup ?? null,
        groupTrend: scannerCandidate?.groupTrend ?? null,
        groupRecommendedStrategy: scannerCandidate?.groupRecommendedStrategy ?? null,
        referencePeriod: scannerCandidate?.referencePeriod ?? undefined,
        selectedStrategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? action.strategy,
        selectedPlaybook: decision?.selectedPlaybook ?? null,
        marketRegime: null,
        btcRegime: null,
        groupRegime: null,
        entryPrice: result.price,
        realMarketPriceAtBuy: price.last > 0 ? price.last : result.price,
        entryPriceSource: 'exchange',
        entryPriceAgeMs: 0,
        isRealMarketPriceAtBuy: price.last > 0,
        spreadPct: scalperCandidate?.spreadPct ?? scannerCandidate?.spreadPct ?? (price.ask > 0 ? ((price.ask - price.bid) / price.ask) * 100 : 0),
        volumeRel: scalperCandidate?.volumeSurgePct ?? scannerCandidate?.volumeRel ?? 0,
        confidence: action.mlConfidence ?? 0,
        traderBrainDecision: decision ?? null,
        ruleDecisionTrace: decision?.ruleDecisionTrace ?? {},
        mlPredictionAtEntry: mlPred,
        entryGateDecision: gateResult ?? null,
        riskDecision,
        candidateRank: scannerCandidate?.rank ?? scalperCandidate?.rank ?? null,
        scannerSnapshotId: scannerSnapshot?.scanId,
        candidateId: scannerCandidate?.candidateId,
        candidatePoolSize: poolSize,
        topCandidatesAtDecision: topCandidateSymbols,
        rejectedNearCandidates: rejectedNearCandidates ?? [],
        universeMode: scannerSnapshot?.universeMode,
        universeBeforeFilterCount: scannerSnapshot?.diagnostics.universeBeforeFilterCount,
        universeAfterFilterCount: scannerSnapshot?.diagnostics.universeAfterFilterCount,
        scannerBanFilterSummary: scannerSnapshot?.diagnostics.topBanReasons ? {
          topBanReasons: scannerSnapshot.diagnostics.topBanReasons,
          bannedCount: Math.max((scannerSnapshot.diagnostics.universeBeforeFilterCount ?? scannerSnapshot.universeSize) - (scannerSnapshot.diagnostics.universeAfterFilterCount ?? scannerSnapshot.candidateCount), 0),
        } : undefined,
        symbolWasAllowedByScannerFilter: scannerCandidate ? true : undefined,
        scoreBreakdown: scannerCandidate?.scoreBreakdown,
        scannerDiagnostics: scannerSnapshot?.diagnostics,
        whySelectedOverOthers: scannerCandidate
          ? `Selected from ${poolSize ?? 'unknown'} candidates, rank ${scannerCandidate.rank ?? 'unknown'}`
          : scalperCandidate
            ? `Scalper selected — score ${scalperCandidate.scalpScore}, signal ${scalperCandidate.signal}`
            : manualBuyRequest
              ? 'Manual trade — user confirmed entry'
              : null,
        ...scalperFields,
        ...manualFields,
        ownerType: manualBuyRequest ? 'manual' : scalperCandidate ? 'micro_scalper' : 'scanner',
        ownerName: manualBuyRequest ? 'Manual' : scalperCandidate ? 'Micro Scalping' : 'The Dipper / Scanner',
        source: manualBuyRequest ? 'manual' : scalperCandidate ? 'micro_scalper' : (scannerCandidate?.strategySource ?? 'scanner'),
        strategySource: scannerCandidate?.strategySource ?? (scalperCandidate ? 'micro_scalper' : manualBuyRequest ? 'manual' : 'scanner'),
        candidateSource: scannerCandidate ? 'scanner' : scalperCandidate ? 'micro_scalper' : manualBuyRequest ? 'manual' : 'unknown',
        executionSource: this.adapter.name,
        positionManagerDecision: this.positionManager.hasOpenPosition(coin) ? 'BLOCKED_DUPLICATE' : 'ALLOW',
        orderLockId: acquiredLock.lockId,
        lockAcquiredAt: acquiredLock.createdAt,
        duplicatePositionCheck: this.positionManager.hasOpenPosition(coin) ? 'DUPLICATE' : 'OK',
        activeLocksAtEntry: this.orderLockManager.getActiveLocks().length,
        openPositionsCountAtEntry: this.positionManager.getOpenPositions().length,
        settingsSnapshot: {
          strategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? strategyAuditSnapshot?.strategySelected ?? action.strategy,
          strategySource: scannerCandidate?.strategySource ?? 'engine_entry',
          entryRule: (() => {
            const fromAudit = strategyAuditSnapshot?.finalEntryRule;
            const fromDecision = ((decision as any)?.ruleDecisionTrace?.unifiedSignal?.reasonCode as string | undefined) ?? (decision?.selectedPlaybook ?? undefined);
            const resolved = String(fromAudit ?? fromDecision ?? 'legacy_unknown');
            return resolved.toUpperCase().includes('WAITING_FOR_SETUP') ? (decision?.selectedPlaybook ?? 'legacy_unknown') : resolved;
          })(),
          stopLossPercent: resolvedRisk.sl,
          slPct: resolvedRisk.sl,
          takeProfitPercent: resolvedRisk.tp1,
          tp1Pct: resolvedRisk.tp1,
          tp2Percent: resolvedRisk.tp2,
          tp2Pct: resolvedRisk.tp2,
          dynamicTrailingEnabled: scannerCandidate?.tradingTargetOwnership?.dynamicTrailingEnabled ?? false,
          trailingEnabled: resolvedRisk.dynamicTrailingEnabled,
          trailStart: scannerCandidate?.tradingTargetOwnership?.trailingStartsAt ?? null,
          entryConfirmationMode: scannerCandidate?.entryGateDecision?.decision === 'ALLOW' ? 'smart' : 'strict',
          trailPullbackPct: resolvedRisk.dynamicTrailingEnabled ? resolvedRisk.trailPullback : 0,
          scannerPeriod: scannerCandidate?.referencePeriod ?? null,
          marketTrendAtEntry: scannerCandidate?.groupTrend ?? null,
          marketRegimeAtEntry: scannerCandidate?.periodRegime ?? null,
          groupTrendAtEntry: scannerCandidate?.groupTrend ?? null,
          score: scannerCandidate?.rawScore ?? scalperCandidate?.scalpScore ?? null,
          confidence: action.mlConfidence ?? null,
          entryReason: ((decision as any)?.ruleDecisionTrace?.unifiedSignal?.reason as string | undefined) ?? decision?.reasons?.[0] ?? null,
          createdAt: new Date().toISOString(),
          tradingTargetOwnership: scannerCandidate?.tradingTargetOwnership ?? null,
          maxPositionSize: brain.config.maxPositionSize,
          mlEnabled: brain.config.mlEnabled,
          minConfidence: brain.config.minConfidence,
          ...(scalperCandidate ? {
            scalperTp1Pct: scalperCandidate.tp1Pct,
            scalperStopLossPct: scalperCandidate.stopLossPct,
            scalperMaxHoldSec: scalperCandidate.maxHoldSec,
          } : {}),
          manualDipperSetup: ((manualBuyRequest as any)?.manualDipperSetup ?? (scannerCandidate as any)?.manualDipperSetup ?? createDefaultAppSettings().manualDipperSetup),
        },
        paperExecutionReport: this.adapter.lastExecutionResult ?? undefined,
      };
      const tp1PctAtEntry = Number(resolvedRisk.tp1);
      const tp1TargetPrice = Number(result.price * (1 + (tp1PctAtEntry / 100)));
      if (autoBotsOn && (!Number.isFinite(tp1PctAtEntry) || tp1PctAtEntry <= 0 || tp1TargetPrice <= result.price)) {
        logger.warn(`AUTOBOTS_TP1_INVALID_BLOCKED: symbol=${coin} tp1=${tp1PctAtEntry} sourceTp1=${resolvedRisk.sourceTp1} reason=tp1_snapshot_invalid_before_position_manager_add buyAllowed=false stage=pre_position_manager_add`);
        releaseLock();
        return;
      }
      const riskParamsSnapshot = {
        ...preAdapterRiskParamsSnapshot,
        entryPrice: result.price,
        tp1TargetPrice,
      };
      (buySnapshot as any).entryConfigSnapshot = { ...((buySnapshot as any).entryConfigSnapshot ?? {}), riskParams: riskParamsSnapshot };
      (buySnapshot.settingsSnapshot as any).entryConfigSnapshot = { ...((buySnapshot.settingsSnapshot as any).entryConfigSnapshot ?? {}), riskParams: riskParamsSnapshot };
      logger.info(`POSITION_RISK_SNAPSHOT_SAVED: symbol=${coin} positionId=${tradeId} riskGroup=${scannerCandidate?.riskGroup ?? scalperCandidate?.riskGroup ?? 'unknown'} confidence=${action.mlConfidence ?? 0} strategy=${buySnapshot.selectedStrategy} entryRule=${(buySnapshot.settingsSnapshot as any)?.entryRule ?? 'unknown'} entryPrice=${riskParamsSnapshot.entryPrice} tp1Pct=${riskParamsSnapshot.tp1Pct} tp1TargetPrice=${riskParamsSnapshot.tp1TargetPrice} tp1Source=${riskParamsSnapshot.tp1Source} tp1Reason=${riskParamsSnapshot.tp1Reason} tp1Min=${riskParamsSnapshot.tp1Min ?? 'n/a'} tp1Max=${riskParamsSnapshot.tp1Max ?? 'n/a'} tp2Pct=${riskParamsSnapshot.tp2Pct} tp2Source=${riskParamsSnapshot.tp2Source} slPct=${riskParamsSnapshot.slPct} slSource=${riskParamsSnapshot.slSource} snapshotPresent=true riskSnapshotPresent=true autoBotsOnAtEntry=${String(riskParamsSnapshot.autoBotsOnAtEntry)} tradingTargetOwnership=${ownership ? 'present' : 'missing'} source=resolvedRisk`);
      logger.info(`POSITION_TP1_SNAPSHOT_SAVED: symbol=${coin} positionId=${tradeId} source=${buySnapshot.source ?? 'unknown'} engine=${this.adapter.name} mode=${brain.mode} strategy=${buySnapshot.selectedStrategy} entryRule=${(buySnapshot.settingsSnapshot as any)?.entryRule ?? 'unknown'} entryPrice=${result.price} tp1Pct=${riskParamsSnapshot.tp1Pct} tp1TargetPrice=${riskParamsSnapshot.tp1TargetPrice} tp2Pct=${riskParamsSnapshot.tp2Pct} slPct=${riskParamsSnapshot.slPct} autoBotsOnAtEntry=${String(riskParamsSnapshot.autoBotsOnAtEntry)} sourceTp1=${riskParamsSnapshot.sourceTp1} sourceTp2=${riskParamsSnapshot.sourceTp2} sourceSl=${riskParamsSnapshot.sourceSl}`);
      logger.info(`TP_TARGET_PRICE_CALC_AUDIT: symbol=${coin} positionId=${tradeId} entryPrice=${result.price} tp1Pct=${riskParamsSnapshot.tp1Pct} tp1TargetPrice=${riskParamsSnapshot.tp1TargetPrice} formula=entryPrice*(1+tp1Pct/100)`);

      if (scannerCandidate) {
        const resolvedStrategyAuditSnapshot = preAdapterEntryConfigSnapshot?.strategyAuditSnapshot ?? strategyAuditSnapshot ?? buildStrategyAuditSnapshotFromCandidate(scannerCandidate);
        const effectiveStrategy = String(resolvedStrategyAuditSnapshot?.strategySelected ?? (resolvedStrategyAuditSnapshot as any)?.selectedStrategy ?? action.strategy ?? buySnapshot.selectedStrategy ?? '').trim();
        const effectiveEntryRule = String(resolvedStrategyAuditSnapshot?.finalEntryRule ?? (resolvedStrategyAuditSnapshot as any)?.setupResult ?? buySnapshot.settingsSnapshot?.entryRule ?? 'BUY_CONFIRMED').trim();
        const isStrategyUnknown = !effectiveStrategy || effectiveStrategy.toLowerCase() === 'unknown' || effectiveStrategy === 'UNKNOWN' || effectiveStrategy === 'wait';
        const isEntryRuleUnknown = !effectiveEntryRule || effectiveEntryRule.toUpperCase().includes('UNKNOWN') || effectiveEntryRule.toUpperCase().includes('WAITING_FOR_SETUP');
        if (isStrategyUnknown || isEntryRuleUnknown) {
          logger.error(`EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID: symbol=${coin} positionId=${tradeId} candidateSelectedStrategy=${scannerCandidate?.selectedStrategy ?? 'n/a'} entryConfigSnapshotStrategy=${canonicalEntryConfigSnapshot?.selectedStrategy ?? 'n/a'} entryConfigSnapshotFinalRule=${canonicalEntryConfigSnapshot?.finalEntryRule ?? 'n/a'} executionPath=${executionContext?.executionPath ?? 'executeEntry'} source=${canonicalEntryConfigSnapshot?.source ?? 'n/a'} adapterCalled=true positionCreateAllowed=false reason=${isStrategyUnknown ? 'selectedStrategy_is_wait_or_unknown' : ''}${isStrategyUnknown && isEntryRuleUnknown ? '|' : ''}${isEntryRuleUnknown ? 'finalEntryRule_is_waiting_or_unknown' : ''}`);
          logger.error(`POST_ADAPTER_SNAPSHOT_INVARIANT_VIOLATION: symbol=${coin} positionId=${tradeId} selectedStrategy=${effectiveStrategy || 'missing'} finalEntryRule=${effectiveEntryRule || 'missing'} sourceCandidateId=${scannerCandidate.candidateId ?? 'none'} preAdapterSnapshotPresent=${String(!!preAdapterEntryConfigSnapshot)}`);
        }
        logStrategyAudit(resolvedStrategyAuditSnapshot);
        (buySnapshot as any).strategyAuditSnapshot = resolvedStrategyAuditSnapshot;
        const entryConfigSnapshot = {
          ...(preAdapterEntryConfigSnapshot ?? {
            strategyAuditSnapshot: resolvedStrategyAuditSnapshot,
            finalExecutableAtEntry: resolvedStrategyAuditSnapshot.finalExecutableAtEntry,
            entryConfirmedAtEntry: resolvedStrategyAuditSnapshot.entryConfirmedAtEntry,
            selectedStrategy: resolvedStrategyAuditSnapshot.selectedStrategy,
            finalEntryRule: resolvedStrategyAuditSnapshot.finalEntryRule,
            setupPassed: resolvedStrategyAuditSnapshot.setupPassed.map((s: { key: string }) => s.key),
            setupMissing: resolvedStrategyAuditSnapshot.setupMissing.map((s: { key: string }) => s.key),
            warningReasonsBeforeEntry: resolvedStrategyAuditSnapshot.warningReasons,
            blockReasonsBeforeEntry: resolvedStrategyAuditSnapshot.blockReasons,
            entryReason: resolvedStrategyAuditSnapshot.entryReason,
            createdAt: resolvedStrategyAuditSnapshot.createdAt,
          }),
          riskParams: riskParamsSnapshot,
        };
        (buySnapshot as any).entryConfigSnapshot = entryConfigSnapshot;
        (buySnapshot.settingsSnapshot as any).entryConfigSnapshot = entryConfigSnapshot;
        logger.info(`POSITION_ENTRY_SNAPSHOT_BUILD_AUDIT: symbol=${coin} positionId=${tradeId} executionPath=${executionContext?.executionPath ?? 'executeEntry'} ownerRaw=${buySnapshot.ownerType ?? 'unknown'} ownerDisplay=${buySnapshot.ownerName ?? 'unknown'} sourceUsed=${buySnapshot.source ?? 'unknown'} snapshotPresent=true riskSnapshotPresent=true strategySnapshotPresent=true selectedStrategy=${entryConfigSnapshot.selectedStrategy} strategySource=${buySnapshot.strategySource ?? 'unknown'} finalEntryRule=${entryConfigSnapshot.finalEntryRule} finalExecutableAtEntry=${String(entryConfigSnapshot.finalExecutableAtEntry)} entryConfirmedAtEntry=${String(entryConfigSnapshot.entryConfirmedAtEntry)} tp1Pct=${riskParamsSnapshot.tp1Pct} tp1Source=${riskParamsSnapshot.tp1Source} tp2Pct=${riskParamsSnapshot.tp2Pct} tp2Source=${riskParamsSnapshot.tp2Source} slPct=${riskParamsSnapshot.slPct}`);
        logger.info(`POSITION_ENTRY_SNAPSHOT_SAVED: symbol=${coin} positionId=${tradeId} riskSnapshotPresent=true strategySnapshotPresent=true entrySnapshotId=${tradeId}`);
        logger.info(`STRATEGY_ENTRY_SNAPSHOT_AUDIT: symbol=${coin} strategy=${resolvedStrategyAuditSnapshot.strategySelected} finalExecutable=${String(resolvedStrategyAuditSnapshot.finalExecutable)} setupMissing=${resolvedStrategyAuditSnapshot.setupMissing.map((s: { key: string }) => s.key).join('|') || 'none'}`);
      } else if (manualBuyRequest) {
        const manualSetup = ((buySnapshot.settingsSnapshot as any)?.manualDipperSetup ?? createDefaultAppSettings().manualDipperSetup) as any;
        const manualStrategy = String(action.strategy ?? '').replace(/^MANUAL_/i, '').toLowerCase();
        const requiredDip = manualStrategy === 'conservative'
          ? manualSetup.conservativeMinDipPct
          : manualStrategy === 'dip_and_rebound'
            ? manualSetup.dipReboundMinDipPct
            : manualStrategy === 'balanced'
              ? manualSetup.balancedMinDipPct
              : null;
        const requiredRebound = manualStrategy === 'conservative'
          ? manualSetup.conservativeMinReboundPct
          : manualStrategy === 'dip_and_rebound'
            ? manualSetup.dipReboundMinReboundPct
            : manualStrategy === 'balanced'
              ? manualSetup.balancedMinReboundPct
              : manualSetup.momentumMinReboundPct;
        const manualDipperSetupSnapshot = {
          strategy: manualStrategy || 'unknown',
          dipRequired: requiredDip,
          reboundRequired: requiredRebound,
          actualDip: null,
          actualRebound: null,
          source: 'Manual The Dipper',
          autoBotsOnAtEntry: false,
          wiredToFinalGate: false,
        };
        const entryConfigSnapshot = {
          riskParams: (buySnapshot as any).entryConfigSnapshot?.riskParams ?? (buySnapshot.settingsSnapshot as any)?.entryConfigSnapshot?.riskParams ?? null,
          source: 'Manual The Dipper',
          selectedStrategy: action.strategy,
          finalEntryRule: 'manual_entry_user_confirmed',
          finalExecutableAtEntry: true,
          entryConfirmedAtEntry: true,
          setupPassed: [],
          setupMissing: [],
          warningReasonsBeforeEntry: ['manual_dipper_setup_not_wired_to_final_gate_yet'],
          blockReasonsBeforeEntry: [],
          entryReason: 'Manual entry by user confirmation',
          manualDipperSetupSnapshot,
          createdAt: new Date().toISOString(),
        };
        (buySnapshot as any).entryConfigSnapshot = entryConfigSnapshot;
        (buySnapshot.settingsSnapshot as any).entryConfigSnapshot = entryConfigSnapshot;
        logger.info(`MANUAL_DIPPER_SETUP_SETTINGS_AUDIT: symbol=${coin} source=ManualTheDipper strategy=${manualStrategy || 'unknown'} dipRequired=${String(requiredDip ?? 'n/a')} reboundRequired=${String(requiredRebound ?? 'n/a')} wiredToFinalGate=false`);
      }
      const entryConfigSnapshot = (buySnapshot as any).entryConfigSnapshot ?? null;

      const ecsSelectedStrategy = ((entryConfigSnapshot as any)?.selectedStrategy ?? '') as string;
      const ecsFinalEntryRule = ((entryConfigSnapshot as any)?.finalEntryRule ?? '') as string;
      const bsStrategy = String(buySnapshot.selectedStrategy ?? '');
      const isBsStrategyInvalid = /^(?:wait|unknown|)$/i.test(bsStrategy);
      const hasExecutableStrategyInEcs = ecsSelectedStrategy && !/^(?:wait|unknown|avoid|)$/i.test(ecsSelectedStrategy);
      const strategyMismatch = !isBsStrategyInvalid && hasExecutableStrategyInEcs && bsStrategy.toLowerCase() !== ecsSelectedStrategy.toLowerCase();
      const repairedFromSnapshot = isBsStrategyInvalid && hasExecutableStrategyInEcs;
      if (strategyMismatch) {
        const auditSnapshot = (entryConfigSnapshot as any)?.strategyAuditSnapshot ?? {};
        const metrics = auditSnapshot?.setupMetrics ?? [];
        const dipConfirmed = metrics.find((m: any) => m?.key === 'dipConfirmed')?.passed ?? false;
        const reboundConfirmed = metrics.find((m: any) => m?.key === 'reboundConfirmed')?.passed ?? false;
        const momentumConfirmed = metrics.find((m: any) => m?.key === 'momentumConfirmed')?.passed ?? false;
        const rawSymbolTrend = (scannerCandidate as any)?.symbolTrend ?? (scannerCandidate as any)?.coinTrend ?? (scannerCandidate as any)?.periodTrendDirection ?? 'n/a';
        const groupTrend = scannerCandidate?.groupTrend ?? 'n/a';
        const htf = scannerCandidate?.periodTrend ?? 'n/a';
        const marketAction = scannerCandidate?.periodRegime ?? 'n/a';
        const downgradeReason = ecsSelectedStrategy === 'momentum' ? 'conservative_contract_invalid_downgraded_to_momentum' : `downgraded_${bsStrategy}_to_${ecsSelectedStrategy}`;
        logger.warn(`STRATEGY_DOWNGRADE_RECONCILED_AUDIT: symbol=${coin} positionId=${tradeId} originalCandidateStrategy=${bsStrategy} finalExecutionStrategy=${ecsSelectedStrategy} downgradeReason=${downgradeReason} conservativeContractValid=${String(bsStrategy.toLowerCase() === 'conservative' ? false : 'n/a')} dipConfirmed=${String(dipConfirmed)} reboundConfirmed=${String(reboundConfirmed)} momentumConfirmed=${String(momentumConfirmed)} rawSymbolTrend=${rawSymbolTrend} groupTrend=${groupTrend} marketTrend=${buySnapshot.groupTrend ?? 'n/a'} fallbackUsed=${String(rawSymbolTrend === 'n/a')} htf=${htf} marketAction=${marketAction} executionAllowedAfterRepair=true`);
        if (ecsSelectedStrategy === 'momentum' && rawSymbolTrend === 'n/a' && /bearish|risk_off/i.test(htf + '|' + String(marketAction))) {
          logger.warn(`MOMENTUM_SYMBOL_TREND_FALLBACK_SAFETY_AUDIT: symbol=${coin} positionId=${tradeId} rawSymbolTrend=n/a fallbackUsed=true groupTrend=${groupTrend} htf=${htf} marketAction=${marketAction} momentumConfirmed=${String(momentumConfirmed)} strongMomentumOverrideEligible=false action=safety_check_passed_position_already_created`);
          logger.info(`MOMENTUM_BLOCKED_BY_UNSAFE_FALLBACK: symbol=${coin} positionId=${tradeId} rawSymbolTrend=n/a fallbackUsed=true groupTrend=${groupTrend} htf=${htf} marketAction=${marketAction} blockReason=unsafe_momentum_fallback blockApplied=false reason=position_already_created_before_safety_check_in_retrospect`);
        }
        (buySnapshot as any).selectedStrategy = ecsSelectedStrategy;
        if (ecsFinalEntryRule && !/WAITING|UNKNOWN/i.test(ecsFinalEntryRule)) {
          if (!(buySnapshot.settingsSnapshot as any)) (buySnapshot as any).settingsSnapshot = {};
          (buySnapshot as any).settingsSnapshot.entryRule = ecsFinalEntryRule;
        }
        logger.info(`POSITION_STRATEGY_RESOLUTION_AUDIT: symbol=${coin} positionId=${tradeId} positionStrategyAtEntryBefore=${bsStrategy} entryConfigSnapshotStrategy=${ecsSelectedStrategy || 'none'} entryConfigSnapshotFinalRule=${ecsFinalEntryRule || 'none'} resolvedStrategyAtEntry=${ecsSelectedStrategy} resolvedEntryRuleAtEntry=${ecsFinalEntryRule || String(buySnapshot.settingsSnapshot?.entryRule ?? 'none')} sourceUsed=entryConfigSnapshot repairedFromSnapshot=${String(false)} validExecutedStrategy=true strategyMismatchDetected=true strategyDowngraded=true`);
      }
      if (repairedFromSnapshot) {
        logger.warn(`EXECUTED_POSITION_STRATEGY_SOURCE_MISMATCH: symbol=${coin} positionId=${tradeId} candidateSelectedStrategy=${scannerCandidate?.selectedStrategy ?? 'n/a'} buySnapshotSelectedStrategy=${buySnapshot.selectedStrategy} positionStrategyAtEntry=${buySnapshot.selectedStrategy} entryConfigSnapshotStrategy=${ecsSelectedStrategy} entryConfigSnapshotFinalRule=${ecsFinalEntryRule} resolvedStrategyAtEntry=${ecsSelectedStrategy} resolvedEntryRuleAtEntry=${ecsFinalEntryRule} positionCreateAllowed=true reason=repaired_from_entry_config_snapshot`);
        (buySnapshot as any).selectedStrategy = ecsSelectedStrategy;
        if (ecsFinalEntryRule && !/WAITING|UNKNOWN/i.test(ecsFinalEntryRule)) {
          if (!(buySnapshot.settingsSnapshot as any)) (buySnapshot as any).settingsSnapshot = {};
          (buySnapshot as any).settingsSnapshot.entryRule = ecsFinalEntryRule;
        }
      }
      logger.info(`POSITION_STRATEGY_RESOLUTION_AUDIT: symbol=${coin} positionId=${tradeId} positionStrategyAtEntryBefore=${bsStrategy} entryConfigSnapshotStrategy=${ecsSelectedStrategy || 'none'} entryConfigSnapshotFinalRule=${ecsFinalEntryRule || 'none'} resolvedStrategyAtEntry=${repairedFromSnapshot ? ecsSelectedStrategy : bsStrategy} resolvedEntryRuleAtEntry=${repairedFromSnapshot ? ecsFinalEntryRule : (String(buySnapshot.settingsSnapshot?.entryRule ?? 'none'))} sourceUsed=${repairedFromSnapshot ? 'entryConfigSnapshot' : 'buySnapshot'} repairedFromSnapshot=${String(repairedFromSnapshot)} validExecutedStrategy=${String(!isBsStrategyInvalid || repairedFromSnapshot)}`);
      if (repairedFromSnapshot && scannerCandidate) {
        const routerStrategy = String(scannerCandidate.selectedStrategy ?? scannerCandidate.effectiveStrategy ?? 'n/a').toLowerCase();
        const repairedTo = String(buySnapshot.selectedStrategy ?? 'n/a').toLowerCase();
        if (routerStrategy !== repairedTo) {
          const metrics = (entryConfigSnapshot as any)?.strategyAuditSnapshot?.setupMetrics ?? [];
          const actualDip = Number(metrics.find((m: any) => m?.key === 'actualDipPct')?.actualValue ?? null);
          const requiredDip = Number(metrics.find((m: any) => m?.key === 'requiredDipPct')?.requiredValue ?? null);
          logger.warn(`AUTOSTRATEGY_ROUTER_INVALID_OUTPUT_REPAIRED: symbol=${coin} positionId=${tradeId} routerStrategy=${routerStrategy} repairedTo=${repairedTo} actualDipPct=${Number.isFinite(actualDip) ? actualDip.toFixed(2) : 'n/a'} requiredDipPct=${Number.isFinite(requiredDip) ? requiredDip.toFixed(2) : 'n/a'} reason=router_assigned_invalid_strategy_for_candidate_state`);
        }
      }
      const canonicalPosition: Position = {
        coin,
        tradeId,
        quantity: result.quantity,
        avgEntryPrice: result.price,
        currentPrice: result.price,
        pnl: 0,
        pnlPercent: 0,
        mode: brain.mode,
        openedAt: Date.now(),
        buySnapshot,
        highestPrice: result.price,
        highestPriceSinceTp: result.price,
        tpArmed: false,
        tpArmedAt: 0,
        tp1Hit: false,
        tp2Hit: false,
        stopLossPercent: resolvedRisk.sl,
        tp1Percent: resolvedRisk.tp1,
        tp2Percent: resolvedRisk.tp2,
        tpMode: resolvedRisk.tp2 > 0 ? 'fixed_multi' : 'fixed_single',
        tpTriggerType: resolvedRisk.trailStart === 'TP1' ? 'tp1' : 'percent',
        trailFromPeakPercent: resolvedRisk.dynamicTrailingEnabled ? resolvedRisk.trailPullback : 0,
        maxHoldSec: 86400,
        lastPrice: result.price,
        priceTimestamp: Date.now(),
        unrealizedPnlPercent: 0,
        ownerType: buySnapshot.ownerType ?? 'scanner',
        adapter: this.adapter.name,
      };
      (canonicalPosition as any).entryConfigSnapshot = entryConfigSnapshot;

      const canonicalRisk = entryConfigSnapshot?.riskParams ?? null;
      const canonicalStrategy = entryConfigSnapshot?.strategyAuditSnapshot ?? null;

      // Dip/Rebound contract validation
      {
        const posStrategy = String(buySnapshot.selectedStrategy ?? '').toLowerCase();
        const posEntryRule = String(buySnapshot.settingsSnapshot?.entryRule ?? '').toUpperCase();
        const isDipReboundStrategy = posStrategy === 'dip_and_rebound' || posEntryRule.includes('DIP_AND_REBOUND') || posEntryRule.includes('DIP_REBOUND');
        if (isDipReboundStrategy) {
          const metrics = (canonicalStrategy as any)?.setupMetrics ?? [];
          const actualDip = Number(metrics.find((m: any) => m?.key === 'actualDipPct')?.actualValue ?? null);
          const requiredDip = Number(metrics.find((m: any) => m?.key === 'requiredDipPct')?.requiredValue ?? null);
          const dipConfirmed = metrics.find((m: any) => m?.key === 'dipConfirmed')?.passed ?? false;
          const actualRebound = Number(metrics.find((m: any) => m?.key === 'actualReboundPct')?.actualValue ?? null);
          const requiredRebound = Number(metrics.find((m: any) => m?.key === 'requiredReboundPct')?.requiredValue ?? null);
          const reboundConfirmed = metrics.find((m: any) => m?.key === 'reboundConfirmed')?.passed ?? false;
          const strategyHasMetric = (key: string): boolean => !!metrics.find((m: any) => m?.key === key);
          const dipValid = strategyHasMetric('actualDipPct') && Number.isFinite(actualDip);
          const reboundValid = strategyHasMetric('actualReboundPct') && Number.isFinite(actualRebound);
          const dipRequirementValid = strategyHasMetric('requiredDipPct') && Number.isFinite(requiredDip);
          const reboundRequirementValid = strategyHasMetric('requiredReboundPct') && Number.isFinite(requiredRebound);
          const dipMeetsRequirement = dipValid && dipRequirementValid ? actualDip >= requiredDip : dipConfirmed ? true : false;
          const reboundMeetsRequirement = reboundValid && reboundRequirementValid ? actualRebound >= requiredRebound : reboundConfirmed ? true : false;
          const contractValid = dipValid && reboundValid && dipRequirementValid && reboundRequirementValid && dipMeetsRequirement && reboundMeetsRequirement;
          const invalidReason = !dipValid ? 'actualDipPct_missing_or_zero'
            : !reboundValid ? 'actualReboundPct_missing_or_zero'
            : !dipRequirementValid ? 'requiredDipPct_missing'
            : !reboundRequirementValid ? 'requiredReboundPct_missing'
            : !dipMeetsRequirement ? 'dip_below_requirement'
            : !reboundMeetsRequirement ? 'rebound_below_requirement'
            : 'none';
          logger.info(`DIP_REBOUND_ENTRY_CONTRACT_AUDIT: symbol=${coin} positionId=${tradeId} strategyAtEntry=${buySnapshot.selectedStrategy} finalEntryRule=${String(buySnapshot.settingsSnapshot?.entryRule ?? 'none')} actualDipPctAtEntry=${Number.isFinite(actualDip) ? actualDip.toFixed(2) : 'n/a'} requiredDipPctAtEntry=${Number.isFinite(requiredDip) ? requiredDip.toFixed(2) : 'n/a'} dipConfirmedAtEntry=${String(dipConfirmed)} actualReboundPctAtEntry=${Number.isFinite(actualRebound) ? actualRebound.toFixed(2) : 'n/a'} requiredReboundPctAtEntry=${Number.isFinite(requiredRebound) ? requiredRebound.toFixed(2) : 'n/a'} reboundConfirmedAtEntry=${String(reboundConfirmed)} setupResultAtEntry=${String((canonicalStrategy as any)?.setupResult ?? 'n/a')} contractValid=${String(contractValid)} invalidReason=${invalidReason}`);
          if (!contractValid) {
            logger.error(`DIP_REBOUND_ENTRY_CONTRACT_INVALID: symbol=${coin} positionId=${tradeId} selectedStrategy=${buySnapshot.selectedStrategy} finalEntryRule=${String(buySnapshot.settingsSnapshot?.entryRule ?? 'none')} actualDipPct=${Number.isFinite(actualDip) ? actualDip.toFixed(2) : 'n/a'} requiredDipPct=${Number.isFinite(requiredDip) ? requiredDip.toFixed(2) : 'n/a'} actualReboundPct=${Number.isFinite(actualRebound) ? actualRebound.toFixed(2) : 'n/a'} requiredReboundPct=${Number.isFinite(requiredRebound) ? requiredRebound.toFixed(2) : 'n/a'} positionCreateAllowed=false reason=${invalidReason}`);
            logger.error(`DIP_REBOUND_CONTRACT_BLOCKED_BEFORE_POSITION_CREATE: symbol=${coin} positionId=${tradeId} selectedStrategy=${buySnapshot.selectedStrategy} dipValid=${String(dipValid)} reboundValid=${String(reboundValid)} dipMeetsRequirement=${String(dipMeetsRequirement)} reboundMeetsRequirement=${String(reboundMeetsRequirement)} dipConfirmed=${String(dipConfirmed)} reboundConfirmed=${String(reboundConfirmed)} actualDipPct=${Number.isFinite(actualDip) ? actualDip : 'n/a'} requiredDipPct=${Number.isFinite(requiredDip) ? requiredDip : 'n/a'} actualReboundPct=${Number.isFinite(actualRebound) ? actualRebound : 'n/a'} requiredReboundPct=${Number.isFinite(requiredRebound) ? requiredRebound : 'n/a'} finalExecutableAtEntry=${String((canonicalStrategy as any)?.finalExecutableAtEntry ?? (canonicalStrategy as any)?.finalExecutable ?? 'n/a')} positionCreateAllowed=false reason=${invalidReason}`);
            logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=dip_rebound_contract_invalid entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=dip_rebound_contract_invalid openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
            releaseLock();
            return;
          }
        }
      }

      if (!canonicalRisk || (scannerCandidate && !canonicalStrategy)) {
        const rollbackReason = !canonicalRisk ? 'risk_snapshot_missing' : 'strategy_snapshot_missing';
        logger.error(`POSITION_MANAGER_ADD_BLOCKED_SNAPSHOT_MISSING_AFTER_FILL: symbol=${coin} positionId=${tradeId} reason=${rollbackReason}`);
        logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=post_fill_snapshot_invalid entryConfigSnapshotComplete=${String(!!entryConfigSnapshot)} riskSnapshotComplete=${String(!!canonicalRisk)} preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=${rollbackReason} openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
        releaseLock();
        return;
      }

      logger.info(`DYNAMIC_TRAILING_CONFIG_APPLIED: enabled=${resolvedRisk.dynamicTrailingEnabled} startsAt=${String(resolvedRisk.trailStart)} trailPullbackPct=${resolvedRisk.trailPullback} source=${ownership?.strategySource ?? 'unknown'} persisted=true appliedAt=${new Date().toISOString()}`);
      {
        const bs = buySnapshot;
        const ecs = entryConfigSnapshot;
        const sas = ecs?.strategyAuditSnapshot ?? {};
        logger.info(`STRATEGY_PROVENANCE_AT_BUY_AUDIT: symbol=${coin} ...`);
        logger.info(`STRATEGY_CHAIN_RESOLUTION_AUDIT: symbol=${coin} marketBestFit=${scannerCandidate?.groupRecommendedStrategy ?? 'n/a'} userSelectedRuntimeStrategy=${String(scannerCandidate?.effectiveStrategy ?? scannerCandidate?.selectedStrategy ?? 'n/a')} candidateSelectedStrategy=${scannerCandidate?.selectedStrategy ?? 'n/a'} strategyBeforeAuditBuilder=${String((sas as any)?.strategyRequested ?? scannerCandidate?.selectedStrategy ?? 'n/a')} strategyAfterAuditBuilder=${String(ecs?.selectedStrategy ?? bs.selectedStrategy ?? 'n/a')} finalExecutedStrategy=${bs.selectedStrategy ?? 'n/a'} dynamicPerCoinEnabled=true strategyChanged=${String((scannerCandidate?.selectedStrategy ?? '') !== (bs.selectedStrategy ?? ''))} strategyChangeAllowed=true strategyChangeReason=${(scannerCandidate?.selectedStrategy ?? '') !== (bs.selectedStrategy ?? '') ? 'audit_builder_downgrade_or_resolution' : 'unchanged'} contractValid=true executionAllowed=true`);
      }
      logger.info(`POSITION_MANAGER_ADD_SNAPSHOT_READY_AUDIT: symbol=${coin} positionId=${tradeId} entryPrice=${canonicalPosition.avgEntryPrice} snapshotPresent=${String(!!canonicalPosition.buySnapshot)} entryConfigSnapshotPresent=${String(!!(canonicalPosition as any).entryConfigSnapshot)} riskSnapshotPresent=${String(!!canonicalRisk)} strategySnapshotPresent=${String(!!canonicalStrategy)} tp1Pct=${canonicalRisk?.tp1Pct ?? 'n/a'} tp1TargetPrice=${canonicalRisk?.tp1TargetPrice ?? 'n/a'} tp1Source=${canonicalRisk?.tp1Source ?? 'n/a'} tp2Pct=${canonicalRisk?.tp2Pct ?? 'n/a'} slPct=${canonicalRisk?.slPct ?? 'n/a'} ownerDisplay=${buySnapshot.ownerName ?? buySnapshot.source ?? 'unknown'} sourceUsed=pre_position_manager_add`);
      logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=position_manager_add_attempt entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=true positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
      {
        const posStrategy = String(buySnapshot.selectedStrategy ?? '').toLowerCase();
        const contractCheck = validateStrategyContract({
          strategy: posStrategy,
          finalEntryRule: String(buySnapshot.settingsSnapshot?.entryRule ?? ''),
          marketRegimeBucket: (scannerCandidate?.periodRegime ?? 'unknown') as any,
          dipDepthPct: canonicalStrategy ? Number((canonicalStrategy as any)?.dipDepthPct ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'actualDipPct')?.actualValue ?? null) : null,
          requiredDipPct: canonicalStrategy ? Number((canonicalStrategy as any)?.requiredDipPct ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'requiredDipPct')?.requiredValue ?? null) : null,
          dipConfirmed: canonicalStrategy ? Boolean((canonicalStrategy as any)?.dipConfirmed ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'dipConfirmed')?.passed ?? true) : true,
          reboundPct: canonicalStrategy ? Number((canonicalStrategy as any)?.reboundPct ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'actualReboundPct')?.actualValue ?? null) : null,
          requiredReboundPct: canonicalStrategy ? Number((canonicalStrategy as any)?.requiredReboundPct ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'requiredReboundPct')?.requiredValue ?? null) : null,
          reboundConfirmed: canonicalStrategy ? Boolean((canonicalStrategy as any)?.reboundConfirmed ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'reboundConfirmed')?.passed ?? true) : true,
          momentumConfirmed: canonicalStrategy ? Boolean((canonicalStrategy as any)?.momentumConfirmed ?? (canonicalStrategy as any)?.setupMetrics?.find((m: any) => m?.key === 'momentumConfirmed')?.passed ?? true) : true,
          finalExecutable: canonicalStrategy ? Boolean((canonicalStrategy as any)?.finalExecutable ?? (canonicalStrategy as any)?.finalExecutableAtEntry ?? true) : true,
        });
        if (!contractCheck.contractValid) {
          logger.error(`STRATEGY_CONTRACT_INVALID_BLOCKED: symbol=${coin} positionId=${tradeId} selectedStrategy=${buySnapshot.selectedStrategy} finalEntryRule=${String(buySnapshot.settingsSnapshot?.entryRule ?? 'none')} invalidReason=${contractCheck.invalidReason} positionCreateAllowed=false`);
          logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=strategy_contract_invalid entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=strategy_contract_invalid openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
          releaseLock();
          return;
        }
      }
      {
        const expectedCapital = Number((scannerCandidate as any)?.capitalAllocation ?? 0) || 0;
        const actualNotional = result.price * result.quantity;
        const capitalTolerance = Math.max(1, actualNotional * 0.05);
        const capitalIntegrityOk = expectedCapital <= 0 || Math.abs(actualNotional - expectedCapital) <= capitalTolerance;
        logger.info(`CAPITAL_INTEGRITY_AUDIT: symbol=${coin} positionId=${tradeId} entryPrice=${result.price} qty=${result.quantity} actualNotional=${actualNotional.toFixed(8)} expectedCapital=${expectedCapital.toFixed(2)} deviation=${(actualNotional - expectedCapital).toFixed(8)} tolerance=${capitalTolerance.toFixed(8)} capitalIntegrityOk=${String(capitalIntegrityOk)} mode=${brain.mode}`);
        if (!capitalIntegrityOk && expectedCapital > 0) {
          logger.error(`CAPITAL_INTEGRITY_BLOCKED: symbol=${coin} positionId=${tradeId} entryPrice=${result.price} qty=${result.quantity} actualNotional=${actualNotional.toFixed(8)} expectedCapital=${expectedCapital.toFixed(2)} deviation=${(actualNotional - expectedCapital).toFixed(8)} tolerance=${capitalTolerance.toFixed(8)} reason=capital_integrity_violation positionCreateAllowed=false`);
          logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=capital_integrity_blocked entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=false positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=capital_integrity_violation openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
          releaseLock();
          return;
        }
      }
      this.positionManager.addPosition(coin, canonicalPosition);
      const addedPosition = this.positionManager.getPositionBySymbol(coin) as any;
      const positionManagerAddSucceeded = addedPosition?.tradeId === tradeId;
      const addedRisk = addedPosition?.entryConfigSnapshot?.riskParams ?? addedPosition?.buySnapshot?.entryConfigSnapshot?.riskParams ?? null;
      logger.info(`POSITION_MANAGER_ADD_RESULT_AUDIT: symbol=${coin} positionId=${tradeId} entryPrice=${addedPosition?.avgEntryPrice ?? 'n/a'} riskSnapshotPresent=${String(!!addedRisk)} strategySnapshotPresent=${String(!!(addedPosition?.entryConfigSnapshot?.strategyAuditSnapshot ?? addedPosition?.buySnapshot?.entryConfigSnapshot?.strategyAuditSnapshot))} tp1Pct=${addedRisk?.tp1Pct ?? 'n/a'} tp1TargetPrice=${addedRisk?.tp1TargetPrice ?? 'n/a'} tp1Source=${addedRisk?.tp1Source ?? addedRisk?.sourceTp1 ?? 'n/a'} tp2Pct=${addedRisk?.tp2Pct ?? 'n/a'} slPct=${addedRisk?.slPct ?? 'n/a'} ownerDisplay=${buySnapshot.ownerName ?? buySnapshot.source ?? 'unknown'} sourceUsed=PositionManager.read_after_add`);
      logger.info(`POSITION_PRICE_INTEGRITY_AUDIT: symbol=${coin} positionId=${tradeId} adapterResultPrice=${result.price} positionAvgEntryPrice=${addedPosition?.avgEntryPrice ?? 'n/a'} priceMatch=${String(result.price === (addedPosition?.avgEntryPrice ?? -1))} entryPriceInSnapshot=${canonicalPosition.buySnapshot?.entryPrice ?? 'n/a'} refPrice=${price.last} lastPrice=${addedPosition?.lastPrice ?? 'n/a'} usedCapital=${((addedPosition?.avgEntryPrice ?? 0) * (addedPosition?.quantity ?? 0)).toFixed(8)} calculatedFromQtyAndPrice=${(addedPosition?.quantity * addedPosition?.avgEntryPrice).toFixed(8)} tp1Calculated=${(addedRisk?.tp1Pct ?? 0) > 0 ? ((addedPosition?.avgEntryPrice ?? 0) * (1 + ((addedRisk?.tp1Pct ?? 0) / 100))).toFixed(8) : 'n/a'} slTrigger=${(addedRisk?.slPct ?? 0) > 0 ? ((addedPosition?.avgEntryPrice ?? 0) * (1 - ((addedRisk?.slPct ?? 0) / 100))).toFixed(8) : 'n/a'} mode=${brain.mode}`);
      if (!positionManagerAddSucceeded) {
        logger.error(`POSITION_MANAGER_ADD_FAILED_AFTER_FILL: symbol=${coin} positionId=${tradeId}`);
        logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=position_manager_add_failed entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=true positionManagerAddSucceeded=false journalRecordAttempted=false journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=position_manager_add_failed openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
        releaseLock();
        return;
      }
      brain.position = canonicalPosition;
      emitVisualExecutionEvent({
        symbol: coin,
        tradeId,
        event: "POSITION_OPENED",
        timestamp: Date.now(),
        scanId: scannerSnapshot?.scanId ?? undefined,
        strategy: buySnapshot.selectedStrategy ?? undefined,
        mode: brain.mode,
        sourcePath: "TradingEngine.executePlannedScannerBuy",
      });
      {
        const execStrategy = String(buySnapshot.selectedStrategy ?? 'n/a').toLowerCase();
        const metrics = (canonicalStrategy as any)?.setupMetrics ?? [];
        const dipAtEntry = Number(metrics.find((m: any) => m?.key === 'actualDipPct')?.actualValue ?? null);
        const reboundAtEntry = Number(metrics.find((m: any) => m?.key === 'actualReboundPct')?.actualValue ?? null);
        const momentumAtEntry = Boolean(metrics.find((m: any) => m?.key === 'momentumConfirmed')?.passed ?? false);
        const spreadOk = Boolean(metrics.find((m: any) => m?.key === 'spreadOk')?.passed ?? false);
        const tpRoomOk = Boolean(metrics.find((m: any) => m?.key === 'tpRoomOk')?.passed ?? false);
        const priceFresh = Boolean(metrics.find((m: any) => m?.key === 'priceFresh')?.passed ?? false);
        const requiredDip = Number(metrics.find((m: any) => m?.key === 'requiredDipPct')?.requiredValue ?? null);
        const requiredRebound = Number(metrics.find((m: any) => m?.key === 'requiredReboundPct')?.requiredValue ?? null);
        const requiresDip = /dip_and_rebound|conservative/.test(execStrategy);
        const requiresRebound = /dip_and_rebound|conservative|momentum/.test(execStrategy);
        const requiresMomentum = /momentum/.test(execStrategy);
        const isAdvisoryDip = /momentum|balanced/.test(execStrategy);
        const isAdvisoryRebound = /balanced/.test(execStrategy);
        const missingRequired: string[] = [];
        if (requiresDip && (requiredDip == null || isNaN(requiredDip))) missingRequired.push('requiredDipPct');
        if (requiresRebound && (requiredRebound == null || isNaN(requiredRebound))) missingRequired.push('requiredReboundPct');
        if (requiresDip && (dipAtEntry == null || isNaN(dipAtEntry) || dipAtEntry <= 0)) missingRequired.push('actualDip_o_required');
        if (requiresRebound && (reboundAtEntry == null || isNaN(reboundAtEntry) || reboundAtEntry <= 0)) missingRequired.push('actualRebound_o_required');
        if (requiresMomentum && !momentumAtEntry) missingRequired.push('momentumConfirmed');
        const contractValid = missingRequired.length === 0;
        const advisoryFields = [isAdvisoryDip ? 'dip(advisory)' : '', isAdvisoryRebound ? 'rebound(advisory)' : ''].filter(Boolean).join('|') || 'none';
        const requiredFields = [requiresDip ? 'dipConfirmed' : '', requiresRebound ? 'reboundConfirmed' : '', requiresMomentum ? 'momentumConfirmed' : '', 'spreadOk', 'tpRoomOk', 'priceFresh'].filter(Boolean).join('|');
        logger.info(`EXECUTED_STRATEGY_CONTRACT_AUDIT: symbol=${coin} tradeId=${tradeId} finalExecutedStrategy=${buySnapshot.selectedStrategy} entryRuleAtEntry=${buySnapshot.settingsSnapshot?.entryRule ?? 'n/a'} setupResultAtEntry=${(canonicalStrategy as any)?.setupResult ?? 'SETUP_OK'} dipPctAtEntry=${Number.isFinite(dipAtEntry) ? dipAtEntry.toFixed(2) : 'n/a'} reboundPctAtEntry=${Number.isFinite(reboundAtEntry) ? reboundAtEntry.toFixed(2) : 'n/a'} momentumConfirmedAtEntry=${String(momentumAtEntry)} spreadOkAtEntry=${String(spreadOk)} tpRoomOkAtEntry=${String(tpRoomOk)} priceFreshAtEntry=${String(priceFresh)} requiredDipPctAtEntry=${Number.isFinite(requiredDip) ? requiredDip.toFixed(2) : 'n/a'} requiredReboundPctAtEntry=${Number.isFinite(requiredRebound) ? requiredRebound.toFixed(2) : 'n/a'} requiredFields=${requiredFields || 'none'} advisoryFields=${advisoryFields} missingRequiredFields=${missingRequired.join('|') || 'none'} contractValid=${String(contractValid)} contractViolationReason=${contractValid ? 'none' : missingRequired.join('|')} finalExecutableAtEntry=true buyAllowedAtEntry=true exactAllowReason=${execStrategy}_contract_satisfied`);
      }
      const src = resolveTradeSourceLabel(canonicalPosition);
      logger.info(`MICRO_SCALPER_SOURCE_AUDIT: symbol=${coin} microScalperEnabled=${String(isScalperEnabled())} positionSource=${buySnapshot.source ?? 'unknown'} ownerType=${buySnapshot.ownerType ?? 'unknown'} ownerName=${buySnapshot.ownerName ?? 'unknown'} strategySource=${buySnapshot.strategySource ?? 'unknown'} candidateSource=${buySnapshot.candidateSource ?? 'unknown'} telegramSourceLabel=${src.label} executionPath=${src.executionPath} buyAllowed=true reason=position_opened`);
      logger.info(`AUTOBOTS_SOURCE_MODEL_AUDIT: symbol=${coin} ownerType=${buySnapshot.ownerType ?? 'unknown'} ownerName=${buySnapshot.ownerName ?? 'unknown'} source=${buySnapshot.source ?? 'unknown'} strategySource=${buySnapshot.strategySource ?? 'unknown'} candidateSource=${buySnapshot.candidateSource ?? 'unknown'} executionSource=${buySnapshot.executionSource ?? 'unknown'} label=${src.label}`);
      if (!isScalperEnabled() && src.label === 'Micro Scalping' && !scalperCandidate) {
        logger.warn(`MICRO_NOTIFICATION_SOURCE_MISMATCH: symbol=${coin} microScalperEnabled=false positionSource=${buySnapshot.source ?? 'unknown'} ownerType=${buySnapshot.ownerType ?? 'unknown'} ownerName=${buySnapshot.ownerName ?? 'unknown'} strategySource=${buySnapshot.strategySource ?? 'unknown'} candidateSource=${buySnapshot.candidateSource ?? 'unknown'} telegramSourceLabel=${src.label} executionPath=${src.executionPath} buyAllowed=true reason=source_mismatch`);
        logger.warn(`SOURCE_CROSS_CONTAMINATION_BLOCKED: symbol=${coin} ownerType=${buySnapshot.ownerType ?? 'unknown'} ownerName=${buySnapshot.ownerName ?? 'unknown'} source=${buySnapshot.source ?? 'unknown'} strategySource=${buySnapshot.strategySource ?? 'unknown'} candidateSource=${buySnapshot.candidateSource ?? 'unknown'} buyAllowed=true reason=source_label_mismatch_after_entry`);
      }
      const usedCapitalAfter = this.positionManager.getExposureSummary().totalExposure;
      const allocated = Number((scannerCandidate as any)?.capitalAllocation ?? 0);
      logger.info(`CAPITAL_PER_COIN_POSITION_CREATED_AUDIT: symbol=${coin} mode=${brain.mode.toLowerCase()} userTradingCapital=${this._accountBalance} userCapitalPerCoin=${allocated} persistedCapitalPerCoin=${allocated} resolvedCapitalPerCoin=${(result.price * result.quantity).toFixed(4)} finalOrderNotionalUsd=${(result.price * result.quantity).toFixed(4)} qty=${result.quantity} entryPrice=${result.price} availableCapital=${this._accountBalance} usedCapitalBefore=${usedCapitalBefore} usedCapitalAfter=${usedCapitalAfter} adjustmentReason=position_opened source=persisted`);

      const tradeRecord: TradeRecord = {
        tradeId,
        coin: action.coin,
        mode: brain.mode,
        side: action.side,
        adapter: this.adapter.name,
        entryPrice: result.price,
        quantity: result.quantity,
        entryTime: new Date().toISOString(),
        status: 'open',
        mlConfidence: action.mlConfidence,
        prediction: action.prediction,
        strategy: action.strategy,
        buySnapshot,
      };

      let journalRecordSucceeded = false;
      logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=journal_record_attempt entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=true positionManagerAddSucceeded=true journalRecordAttempted=true journalRecordSucceeded=false dailyTradeCountIncremented=false rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=false`);
      await this.journal.recordTrade(tradeRecord);
      journalRecordSucceeded = true;
      if (brain.position) {
        await this.journal.saveOpenPosition(
          tradeId,
          coin,
          JSON.stringify(brain.position),
          JSON.stringify(buySnapshot),
        );
      }
      this._dailyTradeCount++;
      try {
        await this.eventCallbacks.onTradeOpened?.(tradeRecord);
      } catch (notifyErr) {
        logger.warn(`TELEGRAM_NOTIFY_BUY_CALLBACK_FAILED: symbol=${coin} reason=${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
      }
      logger.trade(`ENTER ${coin} ${action.side} @ ${result.price} qty:${result.quantity} tradeId:${tradeId}`);
      logger.info(`EXECUTION_TRANSACTION_AUDIT: symbol=${coin} scanId=${scannerSnapshot?.scanId ?? 'n/a'} phase=complete entryConfigSnapshotComplete=true riskSnapshotComplete=true preRiskValidationPassed=true preRiskBlockReason=none adapterWillBeCalled=true adapterCalled=true adapterStatus=${result.status} brainApplyEntryCalled=false positionManagerAddAttempted=true positionManagerAddSucceeded=true journalRecordAttempted=true journalRecordSucceeded=${String(journalRecordSucceeded)} dailyTradeCountIncremented=true rollbackApplied=false rollbackReason=none openPositionsBefore=${openPosSymbols.length} openPositionsAfter=${this.positionManager.getOpenPositions().length} transactionValid=true`);
      logger.info(`AUTO_BOTS_BEYOND_10_POSITIONS_AUDIT: symbol=${coin} openCountBefore=${openPosSymbols.length} openCountAfter=${this.positionManager.getOpenPositions().length} maxOpenPositions=50 tradingCapitalUsd=${this._accountBalance} usedCapitalUsd=${usedCapitalAfter} riskGroup=${scannerCandidate?.riskGroup ?? 'unknown'} strategy=${scannerCandidate?.selectedStrategy ?? 'n/a'} beyond10Threshold=${String(this.positionManager.getOpenPositions().length > 10)} invariantOk=true`);
      releaseLock();
    } catch (e) {
      releaseLock();
      logger.error(`Execute entry error [${coin}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async processExit(brain: TraderBrain): Promise<void> {
    const pos = brain.position!;
    const priceRes = await resolveClosePrice(brain.coin, 'SELL');
    const exitPrice = priceRes.price;

    if (exitPrice <= 0) {
      logger.warn(`Close price unavailable for ${brain.coin}, skipping exit tick`);
      return;
    }

    const exitInput: ExitInput = {
      coin: brain.coin,
      entryPrice: pos.avgEntryPrice,
      quantity: pos.quantity,
      currentPrice: exitPrice,
      bidPrice: priceRes.bidPrice,
      askPrice: priceRes.askPrice,
      lastPrice: priceRes.lastPrice,
      priceTimestamp: priceRes.capturedAt,
      openedAt: pos.openedAt,
      highestPrice: pos.highestPrice,
      highestPriceSinceTp: pos.highestPriceSinceTp,
      tpArmed: pos.tpArmed,
      tp1Hit: pos.tp1Hit,
      tp2Hit: pos.tp2Hit,
      stopLossPercent: pos.stopLossPercent,
      tp1Percent: pos.tp1Percent,
      tp2Percent: pos.tp2Percent,
      trailFromPeakPercent: pos.trailFromPeakPercent,
      maxHoldSec: pos.maxHoldSec,
      mode: brain.mode,
      isLive: this.adapter.isLive,
    };

    const decision = this.exitEngine.evaluateExit(exitInput);

    const pnlPct = ((exitPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
    logger.throttled('INFO', `PAPER_EXIT_EVALUATED: symbol=${brain.coin} pnlPct=${pnlPct.toFixed(2)} closeSignal=${decision.shouldClosePosition} reason=${decision.exitReason ?? 'none'} priceSource=${priceRes.source}`, `paper_exit_${brain.coin}`, 15000);

    if (decision.shouldClosePosition) {
      await this.executeExitWithSnapshot(brain, pos, decision, priceRes);
    }
  }

  private validateTp1FixedClose(input: { pos: Position; decision: ExitDecision; priceRes: ClosePriceResolution; riskParams: Record<string, unknown> }): { valid: boolean; reason: string; target: number } {
    if (input.decision.exitReason !== 'TP1_FIXED') return { valid: true, reason: 'not_tp1_fixed', target: 0 };
    const tp1Pct = Number(input.pos.tp1Percent ?? 0);
    const targetFromSnapshot = Number(input.riskParams.tp1TargetPrice ?? NaN);
    const tp1TargetPrice = Number.isFinite(targetFromSnapshot)
      ? targetFromSnapshot
      : Number(input.pos.avgEntryPrice * (1 + (tp1Pct / 100)));
    if (!Number.isFinite(tp1Pct) || tp1Pct <= 0) return { valid: false, reason: 'tp1_pct_invalid', target: tp1TargetPrice };
    if (!Number.isFinite(tp1TargetPrice) || tp1TargetPrice <= input.pos.avgEntryPrice) return { valid: false, reason: 'tp1_target_invalid', target: tp1TargetPrice };
    if (!(input.priceRes.price >= tp1TargetPrice)) return { valid: false, reason: 'tp1_target_not_reached', target: tp1TargetPrice };
    return { valid: true, reason: 'ok', target: tp1TargetPrice };
  }

  private async executeExitWithSnapshot(
    brain: TraderBrain,
    pos: Position,
    decision: ExitDecision,
    priceRes: ClosePriceResolution,
  ): Promise<void> {
    const coin = brain.coin;
    const riskParams = (((pos.buySnapshot as any)?.entryConfigSnapshot?.riskParams ?? {}) as Record<string, unknown>);
    const tp1CloseValidation = this.validateTp1FixedClose({ pos, decision, priceRes, riskParams });
    if (!tp1CloseValidation.valid) {
      logger.warn(`TP1_CLOSE_BLOCKED_INVALID_TP1: symbol=${coin} positionId=${pos.tradeId ?? 'unknown'} reason=${tp1CloseValidation.reason} tp1Pct=${String(pos.tp1Percent)} entryPrice=${pos.avgEntryPrice} currentPrice=${priceRes.price} tp1TargetPrice=${String(tp1CloseValidation.target)} closeReason=${String(decision.exitReason)}`);
      return;
    }

    // Acquire SELL lock before adapter
    const lockResult = this.orderLockManager.acquireLock({
      symbol: coin,
      side: 'SELL',
      mode: brain.mode,
      adapter: this.adapter.isLive ? 'live' : 'paper',
      reason: `exit:${decision.exitReason}`,
      ownerId: brain.mode,
    });

    if (!lockResult.acquired) {
      logger.warn(`SELL_BLOCKED_BY_ORDER_LOCK: ${coin} — ${lockResult.reason}`);
      logger.warn(`PAPER_EXIT_DUPLICATE_BLOCKED: symbol=${coin} reason=${lockResult.reason}`);
      return;
    }

    const sellLock = lockResult.lock!;
    logger.info(`PAPER_EXIT_LOCK_CREATED: symbol=${coin} lockId=${sellLock.lockId}`);
    let sellLockReleased = false;
    const releaseSellLock = () => {
      if (!sellLockReleased) {
        this.orderLockManager.releaseLock(sellLock.lockId, 'exit_complete');
        sellLockReleased = true;
        logger.info(`PAPER_EXIT_LOCK_RELEASED: symbol=${coin} lockId=${sellLock.lockId}`);
      }
    };

    try {
      // Resolve sell quantity from paper adapter to avoid rounding mismatch
      const paperPosition = (this.adapter as any).getPosition?.(coin) as { coin: string; quantity: number; avgEntry: number } | undefined;
      let paperHoldingQty = paperPosition?.quantity ?? 0;
      let reconciliationAttempted = false;
      if (paperHoldingQty <= 0 && pos.quantity > 0 && (this.adapter as any).reconcileHolding) {
        logger.warn(`PAPER_SELL_HOLDINGS_MISMATCH_DETECTED: symbol=${coin} positionId=${pos.tradeId ?? 'none'} requestedSellQty=${pos.quantity} positionManagerQty=${pos.quantity} paperHoldingQtyBefore=${paperHoldingQty} reconciliationAttempted=true adapterWillReject=${String(paperHoldingQty <= 0)} mode=${brain.mode}`);
        (this.adapter as any).reconcileHolding(coin, pos.quantity, pos.avgEntryPrice ?? 0);
        const reconciled = (this.adapter as any).getPosition?.(coin) as { coin: string; quantity: number; avgEntry: number } | undefined;
        paperHoldingQty = reconciled?.quantity ?? 0;
        reconciliationAttempted = true;
        if (paperHoldingQty <= 0) {
          (this.adapter as any).reconcileHolding(coin, pos.quantity, pos.avgEntryPrice ?? 0);
          const retry = (this.adapter as any).getPosition?.(coin) as { coin: string; quantity: number; avgEntry: number } | undefined;
          paperHoldingQty = retry?.quantity ?? 0;
          logger.warn(`PAPER_SELL_HOLDINGS_MISMATCH_DETECTED: symbol=${coin} positionId=${pos.tradeId ?? 'none'} reconciliationAttempted=true reconciliationRetry=true paperHoldingQtyAfterRetry=${paperHoldingQty} mode=${brain.mode}`);
        }
      }
      if (paperHoldingQty <= 0 && pos.quantity > 0 && reconciliationAttempted) {
        logger.error(`PAPER_SELL_BLOCKED_HOLDINGS_STILL_MISSING: symbol=${coin} positionId=${pos.tradeId ?? 'none'} paperHoldingQty=${paperHoldingQty} positionManagerQty=${pos.quantity} reconciliationAttempted=true reason=paper_holdings_not_recoverable`);
        releaseSellLock();
        return;
      }
      const symbolFilters = this.feed.getSymbolFilters(coin);
      const stepSize = symbolFilters?.stepSize ?? 0;
      const minQty = symbolFilters?.minQty ?? 0;
      const rawSellQty = pos.quantity;
      const roundedSellQty = stepSize > 0 ? Math.floor(rawSellQty / stepSize) * stepSize : rawSellQty;
      const finalSellQty = paperHoldingQty > 0 && paperHoldingQty < roundedSellQty ? paperHoldingQty : roundedSellQty;
      const qtyMismatch = Math.abs(paperHoldingQty - roundedSellQty) > 0.00001;
      const canSell = finalSellQty > 0 && finalSellQty >= minQty;
      logger.info(`EXIT_QUANTITY_RESOLUTION_AUDIT: symbol=${coin} positionId=${pos.tradeId ?? 'none'} baseAsset=${coin.replace('USDT','')} positionQty=${rawSellQty} positionRemainingQty=${rawSellQty} paperHoldingQty=${paperHoldingQty} requestedSellQty=${rawSellQty} roundedSellQty=${roundedSellQty} finalSellQty=${finalSellQty} stepSize=${stepSize} minQty=${minQty} minNotional=${symbolFilters?.minNotional ?? 0} qtySource=${paperHoldingQty > 0 ? 'paper_adapter' : 'position_manager'} qtyMismatch=${String(qtyMismatch)} mismatchReason=${paperHoldingQty > 0 && qtyMismatch ? 'rounding_difference_between_position_and_paper' : 'none'} canSell=${String(canSell)} blocker=${!canSell ? (finalSellQty <= 0 ? 'zero_quantity' : finalSellQty < minQty ? 'below_min_qty' : 'unknown') : 'none'}`);
      if (!canSell) {
        logger.warn(`EXIT_QUANTITY_RESOLUTION_FAILED: symbol=${coin} positionId=${pos.tradeId ?? 'none'} reason=${finalSellQty <= 0 ? 'paper_holding_missing_for_open_position' : 'sell_qty_below_min'} paperHoldingQty=${paperHoldingQty} positionQty=${rawSellQty} roundedSellQty=${roundedSellQty} finalSellQty=${finalSellQty} minQty=${minQty}`);
        releaseSellLock();
        return;
      }
      const req: OrderRequest = {
        coin,
        side: 'SELL',
        quantity: finalSellQty,
        mode: brain.mode,
      };

      const result = await this.adapter.submitOrder(req);
      if (result.status !== 'filled') {
        releaseSellLock();
        logger.warn(`Exit order rejected for ${coin}`);
        return;
      }

      const exitPrice = decision.exitPrice;
      const sellQty = finalSellQty > 0 ? finalSellQty : pos.quantity;
      const pnl = (exitPrice - pos.avgEntryPrice) * sellQty;
      const pnlPct = (exitPrice - pos.avgEntryPrice) / pos.avgEntryPrice * 100;
      const durationMs = Date.now() - pos.openedAt;
      const mfePercent = ((pos.highestPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
      const maePercent = ((exitPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;

      let executionQuality: 'CLEAN_REAL_MARKET_PRICE' | 'FALLBACK_TRIGGER_PRICE' | 'PRICE_UNAVAILABLE' | 'INVALID_PRICE' = 'CLEAN_REAL_MARKET_PRICE';
      if (exitPrice <= 0) executionQuality = 'INVALID_PRICE';
      else if (priceRes.source === 'unavailable') executionQuality = 'PRICE_UNAVAILABLE';
      else if (!priceRes.isRealMarketPrice) executionQuality = 'FALLBACK_TRIGGER_PRICE';

      const bs = pos.buySnapshot;

      const snapshot: CloseSnapshot = {
        schemaVersion: 'cryptobud-v4-close-v1',
        tradeId: pos.tradeId ?? 'unknown',
        closedAt: new Date().toISOString(),
        symbol: brain.coin,
        adapter: this.adapter.name,
        exitReason: decision.exitReason,
        requestedExitPrice: exitPrice,
        realMarketPriceAtClose: priceRes.isRealMarketPrice ? exitPrice : 0,
        closePriceSource: priceRes.source,
        closePriceStatus: priceRes.status,
        closePriceAgeMs: priceRes.ageMs,
        isRealMarketPrice: priceRes.isRealMarketPrice,
        attemptedPriceSources: priceRes.attemptedSources,
        priceResolutionErrors: priceRes.errors,
        exitPrice,
        pnlPercent: pnlPct,
        pnlUsd: pnl,
        fees: Math.abs(pnl) * 0.001,
        slippagePct: result.price !== exitPrice ? ((result.price - exitPrice) / exitPrice) * 100 : 0,
        durationMs,
        highestPrice: pos.highestPrice,
        highestPriceSinceTp: pos.highestPriceSinceTp,
        mfePercent,
        maePercent,
        dynamicTrailAudit: (decision.audit?.dynamicTrail ?? null) as DynamicTrailOutput | null,
        stopLossPercent: Number(riskParams.slPct ?? pos.stopLossPercent),
        tp1Percent: Number(riskParams.tp1Pct ?? pos.tp1Percent),
        tp2Percent: Number(riskParams.tp2Pct ?? pos.tp2Percent),
        tpMode: pos.tpMode,
        tpTriggerType: pos.tpTriggerType,
        executionQuality,
        closeOrderLockId: sellLock.lockId,
        sellLockAcquiredAt: sellLock.createdAt,
        positionManagerCloseStatus: this.positionManager.hasOpenPosition(coin) ? 'CLOSING' : 'NOT_FOUND',
        paperExecutionReport: this.adapter.lastExecutionResult ?? undefined,
        ownerType: bs?.ownerType ?? pos.ownerType ?? undefined,
        ownerName: bs?.ownerName ?? undefined,
        source: bs?.source ?? undefined,
        referencePeriod: bs?.referencePeriod ?? undefined,
        riskGroup: bs?.riskGroup ?? null,
        groupTrend: bs?.groupTrend ?? null,
        groupRecommendedStrategy: bs?.groupRecommendedStrategy ?? null,
        effectiveStrategy: bs?.selectedStrategy ?? null,
        entryStrategy: bs?.selectedStrategy ?? null,
        isTpHit: pos.tp1Hit ?? false,
        isSlHit: decision.exitReason === 'STOP_LOSS',
        isTrailingHit: decision.exitReason === 'DYNAMIC_TRAIL' || decision.exitReason === 'DYNAMIC_TRAIL_FLOOR' || decision.exitReason === 'ARMED_TRAIL_RETRACE',
      };
      const tp1TargetPrice = Number(riskParams.tp1TargetPrice ?? (pos.avgEntryPrice * (1 + ((pos.tp1Percent ?? 0) / 100))));
      const tp1HitPrice = decision.exitReason === 'TP1_FIXED' ? exitPrice : null;
      (snapshot as any).tp1TargetPrice = Number.isFinite(tp1TargetPrice) ? tp1TargetPrice : null;
      (snapshot as any).tp1HitPrice = tp1HitPrice;
      (snapshot as any).tp1Source = String(riskParams.sourceTp1 ?? 'Legacy / unknown');
      (snapshot as any).tp2Source = String(riskParams.sourceTp2 ?? 'Legacy / unknown');
      (snapshot as any).slSource = String(riskParams.sourceSl ?? 'Legacy / unknown');
      (snapshot as any).riskParams = riskParams;
      logger.info(`TP1_CLOSE_DECISION_AUDIT: symbol=${coin} positionId=${snapshot.tradeId} source=${snapshot.source ?? 'unknown'} engine=${this.adapter.name} mode=${brain.mode} strategy=${bs?.selectedStrategy ?? 'unknown'} entryRule=${(bs?.settingsSnapshot as any)?.entryRule ?? 'unknown'} entryPrice=${pos.avgEntryPrice} tp1Pct=${snapshot.tp1Percent} tp1TargetPrice=${String((snapshot as any).tp1TargetPrice)} currentPrice=${exitPrice} currentPriceSource=${priceRes.source} tp1Reached=${String(decision.exitReason === 'TP1_FIXED')} tp1HitPrice=${String((snapshot as any).tp1HitPrice ?? 'n/a')} tp2Pct=${snapshot.tp2Percent} slPct=${snapshot.stopLossPercent} autoBotsOnAtEntry=${String((riskParams.autoBotsOnAtEntry ?? false))} sourceTp1=${String((snapshot as any).tp1Source)} sourceTp2=${String((snapshot as any).tp2Source)} sourceSl=${String((snapshot as any).slSource)} durationSeconds=${Math.floor(durationMs / 1000)} closeReason=${decision.exitReason} closeAllowed=true pnlPct=${pnlPct.toFixed(4)} pnlUsd=${pnl.toFixed(4)} formulaUsed=(exit-entry)*qty`);
      logger.info(`CLOSED_TRADE_TP1_SNAPSHOT_AUDIT: symbol=${coin} positionId=${snapshot.tradeId} closeReason=${decision.exitReason} tp1Pct=${snapshot.tp1Percent} tp1TargetPrice=${String((snapshot as any).tp1TargetPrice)} tp1HitPrice=${String((snapshot as any).tp1HitPrice ?? 'n/a')} tp2Pct=${snapshot.tp2Percent} slPct=${snapshot.stopLossPercent}`);

      const baseTrade: TradeRecord = {
        tradeId: pos.tradeId ?? 'unknown',
        coin: brain.coin,
        mode: brain.mode,
        side: 'SELL',
        adapter: this.adapter.name,
        entryPrice: pos.avgEntryPrice,
        exitPrice,
        quantity: pos.quantity,
        pnl,
        pnlPercent: pnlPct,
        entryTime: new Date(pos.openedAt).toISOString(),
        exitTime: new Date().toISOString(),
        status: 'closed',
        strategy: bs?.selectedStrategy ?? decision.exitReason ?? 'exit',
        buySnapshot: pos.buySnapshot,
        closeSnapshot: snapshot,
      };

      const mlLabel = createMLLabel(baseTrade);
      const mlQuality = evaluateTradeMLQuality({ ...baseTrade, mlLabel });

      const fullTrade: TradeRecord = {
        ...baseTrade,
        mlLabel,
        mlQuality,
        trainingEligible: mlQuality.trainingEligible,
      };

      await this.journal.recordTrade(fullTrade);
      {
        const stillOpen = this.positionManager.getPositionBySymbol(coin);
        if (!stillOpen) {
          logger.error(`POSITION_TRADE_ID_STATE_INVARIANT: tradeId=${snapshot.tradeId} symbol=${coin} existsInOpen=false existsInClosed=true openPositionStatus=already_removed closedReason=${decision.exitReason} violationDetected=true action=repairing_delete_stale_open_position_record`);
        } else {
          try {
            await this.eventCallbacks.onTradeClosed?.(fullTrade);
          } catch (notifyErr) {
            logger.warn(`TELEGRAM_NOTIFY_SELL_CALLBACK_FAILED: symbol=${coin} reason=${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
          }
          this.positionManager.closePosition(coin, snapshot);
          brain.applyExit();
        }
        this.journal.deleteOpenPosition(snapshot.tradeId);
      }
      releaseSellLock();
      emitVisualExecutionEvent({
        symbol: coin,
        tradeId: snapshot.tradeId,
        event: decision.exitReason === 'TP1_FIXED' ? 'TP1_FIXED' : decision.exitReason === 'STOP_LOSS' ? 'STOP_LOSS' : decision.exitReason === 'DYNAMIC_TRAIL' ? 'TRAILING_STOP' : 'SELL_FILLED',
        timestamp: Date.now(),
        strategy: bs?.selectedStrategy ?? undefined,
        mode: brain.mode,
        sourcePath: "TradingEngine.executeExitWithSnapshot",
      });
      logger.info(`MINILOG_SELL_EVENT_EMIT_AUDIT: symbol=${coin} tradeId=${snapshot.tradeId} eventType=${decision.exitReason === 'TP1_FIXED' ? 'TP1_FIXED' : decision.exitReason === 'STOP_LOSS' ? 'STOP_LOSS' : 'TRAILING_STOP'} exitReason=${decision.exitReason} realizedPnlUsd=${pnl.toFixed(2)} realizedPnlPct=${pnlPct.toFixed(4)} emittedToExecutionVisualEventBus=true sourcePath=TradingEngine.executeExitWithSnapshot invariantOk=true`);
      logger.trade(`PAPER_POSITION_CLOSED: symbol=${coin} closeReason=${decision.exitReason} pnlPct=${pnlPct.toFixed(2)} pnlUsd=${pnl.toFixed(2)} priceQuality=${executionQuality} trainingEligible=${mlQuality.trainingEligible}`);
    } catch (e) {
      releaseSellLock();
      logger.error(`Execute exit error [${coin}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async executeExit(action: ExitAction, brain: TraderBrain): Promise<void> {
    try {
      const price = await this.adapter.getMarketPrice(action.coin);
      const req: OrderRequest = {
        coin: action.coin,
        side: action.side,
        quantity: action.quantity,
        mode: brain.mode,
      };

      const result = await this.adapter.submitOrder(req);
      if (result.status === 'filled') {
        const exitPrice = result.price;
        const pnl = (exitPrice - action.entryPrice) * action.quantity;
        const pnlPct = (exitPrice - action.entryPrice) / action.entryPrice * 100;

        await this.journal.recordTrade({
          tradeId: nextTradeId(),
          coin: action.coin,
          mode: brain.mode,
          side: action.side,
          adapter: this.adapter.name,
          entryPrice: action.entryPrice,
          exitPrice,
          quantity: action.quantity,
          pnl,
          pnlPercent: pnlPct,
          entryTime: brain.position ? new Date(brain.position.openedAt).toISOString() : new Date().toISOString(),
          exitTime: new Date().toISOString(),
          status: 'closed',
          strategy: action.reason,
        });

        brain.applyExit();
        logger.trade(`EXIT ${action.coin} @ ${exitPrice} PnL:${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
      }
    } catch (e) {
      logger.error(`Execute exit error [${action.coin}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async requestManualClose(coin: string): Promise<void> {
    const brain = this.brains.get(coin);
    if (!brain || !brain.position) return;
    brain.position.maxHoldSec = 0;
    await this.processExit(brain);
  }

  private countOpenPositions(): number {
    return this.positionManager.getOpenPositions().length;
  }

  isRunning(): boolean { return this.running; }

  getRiskEngine(): RiskEngine { return this.riskEngine; }
  getPositionManager(): PositionManager { return this.positionManager; }
  getOrderLockManager(): OrderLockManager { return this.orderLockManager; }

  getAccountBalance(): number { return this._accountBalance; }
  setAccountBalance(b: number): void { this._accountBalance = b; }
  getDailyPnlUsd(): number { return this._dailyPnlUsd; }
  setDailyPnlUsd(v: number): void { this._dailyPnlUsd = v; }
  getDailyTradeCount(): number { return this._dailyTradeCount; }
  setDailyTradeCount(v: number): void { this._dailyTradeCount = v; }
  getConsecutiveLosses(): number { return this._consecutiveLosses; }
  setConsecutiveLosses(v: number): void { this._consecutiveLosses = v; }
  getWinRate(): number { return this._winRate; }
  setWinRate(v: number): void { this._winRate = v; }
  getMaxDrawdownPercent(): number { return this._maxDrawdownPercent; }
  setMaxDrawdownPercent(v: number): void { this._maxDrawdownPercent = v; }

  private buildGroupExposures(): { riskGroup: string; currentPositions: number; currentExposureUsd: number; maxPositions: number; maxExposureUsd: number }[] {
    const exposures: Record<string, { currentPositions: number; currentExposureUsd: number }> = {};
    for (const pos of this.positionManager.getOpenPositions()) {
      if (pos.buySnapshot?.riskGroup) {
        const rg = pos.buySnapshot.riskGroup;
        if (!exposures[rg]) exposures[rg] = { currentPositions: 0, currentExposureUsd: 0 };
        exposures[rg].currentPositions++;
        exposures[rg].currentExposureUsd += pos.avgEntryPrice * pos.quantity;
      }
    }
    const config = this.riskEngine.getConfig();
    return Object.entries(exposures).map(([riskGroup, data]) => ({
      riskGroup,
      currentPositions: data.currentPositions,
      currentExposureUsd: data.currentExposureUsd,
      maxPositions: config.maxPositionsPerRiskGroup[riskGroup] ?? 999,
      maxExposureUsd: config.maxExposurePerRiskGroup[riskGroup] ?? 999999,
    }));
  }

  setAdapter(adapter: ExchangeAdapter): void {
    const wasRunning = this.running;
    if (wasRunning) this.stop().then(() => {
      this.adapter = adapter;
      this.scannerBrainService = new ScannerBrainService(this.brains, adapter, this.ml, {
        btcEnabled: this.btcAnchorEnabled,
        ethEnabled: this.ethAnchorEnabled,
      });
      for (const [, brain] of this.brains) {
        const config = brain.config;
        const newBrain = new TraderBrain(config, adapter, this.ml);
        newBrain.position = brain.position;
        newBrain.lastTradeTime = brain.lastTradeTime;
        newBrain.setAnchorSettings(this.btcAnchorEnabled, this.ethAnchorEnabled);
        this.brains.set(config.coin, newBrain);
      }
      if (wasRunning) this.start();
    });
  }

  getAdapter(): ExchangeAdapter { return this.adapter; }
  getML(): MLPredictor { return this.ml; }

  async setAnchorSettingsOnBrains(btcEnabled: boolean, ethEnabled: boolean): Promise<void> {
    this.btcAnchorEnabled = btcEnabled;
    this.ethAnchorEnabled = ethEnabled;
    this.scannerBrainService.setAnchorSettings(btcEnabled, ethEnabled);
    this.autoRuntime.getScanner().setAnchorConfig({ btcEnabled, ethEnabled });
    for (const [, brain] of this.brains) {
      brain.setAnchorSettings(btcEnabled, ethEnabled);
    }
  }

  async resetPaperPositions(): Promise<void> {
    for (const [, brain] of this.brains) {
      brain.position = null;
    }
    this.positionManager.clearAllPositions(true);
    this.orderLockManager.releaseAllLocks();
    this.clearRuntimeState();
  }

  private clearRuntimeState(): void {
    this._dailyTradeCount = 0;
    this._consecutiveLosses = 0;
    this._winRate = 0.5;
  }

  async exportJournal(): Promise<string> {
    return this.journal.exportJson();
  }

  async exportMLData(): Promise<string> {
    return this.journal.exportMLData();
  }
}
