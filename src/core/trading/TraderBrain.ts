import type { ExchangeAdapter } from '../exchange/ExchangeAdapter';
import type {
  Position, TraderBrainConfig, OrderSide, TraderAction, EnterAction, MLPrediction,
  OrderResult, TraderBrainDecision, CoinMarketContext, UnifiedEntryInput,
  BuyRuleName, PlaybookInput, AutobotsInput, MarketPrice, MLPredictionV2,
} from '../types';
import { MLPredictor } from '../ml/MLPredictor';
import { mlRuntimeGuard } from '../ml/ml-runtime-guard';
import { mlRuntimeEvents } from '../ml/ml-runtime-events';
import { evaluateUnifiedEntrySignal, getBuyRuleEntryDefinition } from '../strategy-selector/buy-rule-matrix';
import { selectPlaybook } from '../strategy-selector/strategy-playbooks';
import { evaluateAutobots } from '../strategy-selector/autobots-selector';

const DEFAULT_BUY_RULE: BuyRuleName = 'balanced';

export class TraderBrain {
  readonly config: TraderBrainConfig;
  private adapter: ExchangeAdapter;
  private ml: MLPredictor;

  position: Position | null = null;
  lastTradeTime = 0;
  isProcessing = false;
  lastDecision: TraderBrainDecision | null = null;
  btcAnchorEnabled = true;
  ethAnchorEnabled = true;

  constructor(config: TraderBrainConfig, adapter: ExchangeAdapter, ml: MLPredictor) {
    this.config = config;
    this.adapter = adapter;
    this.ml = ml;
  }

  get coin() { return this.config.coin; }
  get mode() { return this.config.mode; }

  setAnchorSettings(btcEnabled: boolean, ethEnabled: boolean): void {
    this.btcAnchorEnabled = btcEnabled;
    this.ethAnchorEnabled = ethEnabled;
  }

  async tick(): Promise<TraderAction> {
    if (!this.config.enabled || this.isProcessing) {
      return { type: 'NOOP', coin: this.coin, reason: 'disabled' };
    }

    const now = Date.now();
    if (now - this.lastTradeTime < this.config.cooldownSeconds * 1000) {
      return { type: 'NOOP', coin: this.coin, reason: 'cooldown' };
    }

    const prediction = this.ml.predict(this.coin);
    if (!prediction) {
      return { type: 'NOOP', coin: this.coin, reason: 'no_prediction' };
    }

    this.isProcessing = true;
    try {
      if (this.position) {
        this.lastTradeTime = Date.now();
        return { type: 'NOOP', coin: this.coin, reason: 'exit_handled_by_engine' };
      }

      const price = await this.adapter.getMarketPrice(this.coin);

      this.lastDecision = await this.decide(price, prediction);

      if (this.lastDecision.status === 'BUY' && this.lastDecision.entryPlan) {
        return {
          type: 'ENTER',
          coin: this.coin,
          side: this.lastDecision.entryPlan.side,
          quantity: this.lastDecision.entryPlan.quantity,
          price: this.lastDecision.entryPlan.price,
          mlConfidence: this.lastDecision.confidence,
          prediction: prediction.prediction,
          strategy: this.lastDecision.selectedStrategy,
        };
      }

      this.lastTradeTime = Date.now();
      return { type: 'NOOP', coin: this.coin, reason: this.lastDecision.status === 'WAITING' ? (this.lastDecision.blockReasons[0] ?? 'waiting') : (this.lastDecision.blockReasons[0] ?? 'blocked') };
    } finally {
      this.isProcessing = false;
    }
  }

  async decide(price?: MarketPrice, prediction?: MLPrediction | null): Promise<TraderBrainDecision> {
    if (!price) {
      price = await this.adapter.getMarketPrice(this.coin);
    }
    if (!prediction) {
      prediction = this.ml.predict(this.coin);
    }

    const ctx = this.buildMarketContext(price, prediction);

    const brainFeatures: Record<string, number | string | boolean> = {
      spreadPct: ctx.spreadPct,
      volumeRel: ctx.volumeRel,
      dipPercent: ctx.dipPercent,
      reboundPercent: ctx.reboundPct,
      m5Change: ctx.m5Change,
      m15Change: ctx.m15Change,
      h1Change: ctx.h1Change,
      change24h: ctx.change24h,
      confidence: ctx.quality,
      marketRegime: ctx.marketRegime,
      btcRegime: ctx.btcRegime,
      strategy: 'default',
    };
    const mlMode = mlRuntimeGuard.getMode();
    const shouldApplyML = mlRuntimeGuard.canMutateDecision();
    const shouldRunBrain = mlMode !== 'off';

    let mlBrainPrediction: MLPredictionV2;
    if (shouldRunBrain) {
      mlBrainPrediction = this.ml.predictWithBrain(this.coin, brainFeatures);
    } else {
      mlBrainPrediction = {
        symbol: this.coin,
        setupId: `off_${Date.now()}`,
        modelVersion: 'off',
        isTrained: false,
        winProbability: null,
        badEntryRisk: 0,
        expectedMovePct: null,
        expectedHoldMinutes: null,
        confidenceAdjustment: 0,
        suggestedAction: 'ALLOW',
        reasons: ['ML runtime mode is OFF'],
        rowsUsed: 0,
      };
    }

    let mlAdjustedConfidence = prediction?.confidence ?? 0.5;
    const mlWarnings: string[] = [];

    if (mlBrainPrediction.isTrained && mlBrainPrediction.reasons.length > 0) {
      if (mlBrainPrediction.suggestedAction === 'BLOCK') {
        mlWarnings.push(`ML BLOCK: ${mlBrainPrediction.reasons.join('; ')}`);
        if (shouldApplyML) {
          mlAdjustedConfidence = Math.max(0, mlAdjustedConfidence + mlBrainPrediction.confidenceAdjustment);
        }
      } else if (mlBrainPrediction.suggestedAction === 'WAIT') {
        mlWarnings.push(`ML WAIT: ${mlBrainPrediction.reasons.join('; ')}`);
        if (shouldApplyML) {
          mlAdjustedConfidence = Math.max(0, mlAdjustedConfidence + mlBrainPrediction.confidenceAdjustment);
        }
      } else {
        if (shouldApplyML) {
          mlAdjustedConfidence = Math.max(0, mlAdjustedConfidence + mlBrainPrediction.confidenceAdjustment);
        }
      }
    }

    if (this.mode === 'MANUAL') {
      return {
        symbol: this.coin,
        mode: 'MANUAL',
        selectedStrategy: 'manual',
        selectedPlaybook: null,
        confidence: 0,
        status: 'WAITING',
        entryPlan: null,
        exitPlan: null,
        reasons: [],
        blockReasons: ['manual_mode'],
        warnings: mlWarnings,
        requiredNextActions: [],
        ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
        mlPrediction: mlBrainPrediction,
        mlAdjustedConfidence,
        mlWarnings,
      };
    }

    const buyRule: BuyRuleName = this.mode === 'SCALPER' ? 'momentum'
      : ctx.momentumConfirmed && ctx.momentumScore > 2 ? 'momentum'
      : ctx.reboundConfirmed && ctx.dipDetected ? 'dip_and_rebound'
      : ctx.momentumScore > 0.5 && !ctx.isDowntrend ? 'momentum'
      : ctx.reboundConfirmed ? 'balanced'
      : DEFAULT_BUY_RULE;

    const unifiedInput: UnifiedEntryInput = {
      buyRule,
      dipDetected: ctx.dipDetected,
      dipPercent: ctx.dipPercent,
      reboundConfirmed: ctx.reboundConfirmed,
      reboundPct: ctx.reboundPct,
      momentum: ctx.momentumScore,
      momentumConfirmed: ctx.momentumConfirmed,
      isUptrend: ctx.isUptrend,
      isDowntrend: ctx.isDowntrend,
      isChoppy: ctx.isChoppy,
      isSideways: ctx.isSideways,
      volumeHigh: ctx.volumePass,
      priceFresh: ctx.priceFresh,
      btcDumping: ctx.btcDumping,
    };

    const unifiedSignal = evaluateUnifiedEntrySignal(unifiedInput);

    const playbookInput: PlaybookInput = {
      symbol: this.coin,
      marketRegime: ctx.marketRegime,
      btcRegime: ctx.btcRegime,
      groupRegime: ctx.groupRegime,
      confidence: unifiedSignal.confidence,
      volumeAvailable: ctx.volumeAvailable,
      volumePass: ctx.volumePass,
      momentumConfirmed: ctx.momentumConfirmed,
      overextended: ctx.overextended,
      dipDetected: ctx.dipDetected,
      reboundConfirmed: ctx.reboundConfirmed,
      reboundPct: ctx.reboundPct,
      tpRoomOk: ctx.tpRoomOk,
      spreadOk: ctx.spreadOk,
      priceFresh: ctx.priceFresh,
      relativeStrengthVsBtc: ctx.relativeStrengthVsBtc,
      entryTiming: ctx.entryTiming,
      btcDumping: ctx.btcDumping,
      isAlt: ctx.isAlt,
    };

    const playbookSelection = selectPlaybook(playbookInput);

    const autobotsInput: AutobotsInput = {
      symbol: this.coin,
      calibratedConfidence: unifiedSignal.confidence,
      dipPercent: ctx.dipPercent,
      reboundPercent: ctx.reboundPct,
      m5Change: ctx.m5Change,
      m15Change: ctx.m15Change,
      h1Change: ctx.h1Change,
      change24h: ctx.change24h,
      momentumScore: ctx.momentumScore,
      volumeRel: ctx.volumeRel,
      spreadPct: ctx.spreadPct,
      quality: ctx.quality,
      marketCondition: ctx.marketRegime,
      breakoutPercent: ctx.breakoutPercent,
      overextended: ctx.overextended,
      candleExhaustion: ctx.candleExhaustion,
      fallingKnife: ctx.fallingKnife,
      hasFreshPrice: ctx.priceFresh,
      tpRoomOk: ctx.tpRoomOk,
      marketRiskOff: ctx.marketRiskOff,
      mlBlocked: ctx.mlBlocked,
      groupEnabled: true,
      currentBuyRule: buyRule,
      extensionAboveRefPct: ctx.breakoutPercent,
      isChoppy: ctx.isChoppy,
      isSideways: ctx.isSideways,
      isUptrend: ctx.isUptrend,
      isDowntrend: ctx.isDowntrend,
      autoBotsRuntimeEnabled: true,
    };

    const autobotsResult = evaluateAutobots(autobotsInput);

    const allReasons: string[] = [];
    const allBlockReasons: string[] = [];
    const allWarnings: string[] = [];

    allReasons.push(unifiedSignal.reason);
    if (playbookSelection.selectedPlaybook) {
      allReasons.push(...playbookSelection.selectedPlaybook.reasons);
    }
    allReasons.push(autobotsResult.reason);

    if (playbookSelection.selectedPlaybook) {
      allBlockReasons.push(...playbookSelection.selectedPlaybook.blockReasons);
    }
    allBlockReasons.push(...autobotsResult.hardBlocks);
    allWarnings.push(...autobotsResult.warnings);

    let status: 'BUY' | 'WAITING' | 'BLOCK' | 'AVOID' = 'WAITING';
    let entryPlan = null;

    const canBuy = unifiedSignal.signal === 'BUY'
      && playbookSelection.selectedStrategy !== 'wait'
      && autobotsResult.ready;

    if (canBuy) {
      const side: OrderSide = 'BUY';
      const qty = this.config.maxPositionSize / price!.ask;
      entryPlan = { side, price: price!.ask, quantity: qty, reason: unifiedSignal.reason };
      status = 'BUY';
    } else if (allBlockReasons.length > 0) {
      status = allBlockReasons.some(r => r.includes('risk') || r.includes('dump') || r.includes('block')) ? 'BLOCK' : 'WAITING';
    } else {
      status = 'WAITING';
    }

    // ML can only downgrade, never upgrade to BUY
    if (mlBrainPrediction.isTrained) {
      const statusBeforeML = status;
      const wouldDowngradeToBlock = mlBrainPrediction.suggestedAction === 'BLOCK' && status !== 'BLOCK' && status === 'BUY';
      const wouldDowngradeToWait = mlBrainPrediction.suggestedAction === 'WAIT' && status === 'BUY';
      const wouldHaveChanged = wouldDowngradeToBlock || wouldDowngradeToWait;

      if (shouldApplyML) {
        if (wouldDowngradeToBlock) {
          status = 'BLOCK';
          allBlockReasons.push('ML_BAD_ENTRY_RISK');
          allWarnings.push('ML blocked: bad entry risk too high');
          entryPlan = null;
        } else if (wouldDowngradeToWait) {
          status = 'WAITING';
          allWarnings.push('ML suggests WAIT: bad entry risk elevated');
          entryPlan = null;
        }

        mlRuntimeEvents.recordActiveDowngrade({
          symbol: this.coin,
          originalDecision: statusBeforeML,
          mlPrediction: prediction?.prediction ?? null,
          finalDecision: status,
          downgraded: wouldHaveChanged,
          exitTriggered: false,
          upgradeBlocked: mlBrainPrediction.suggestedAction === 'ALLOW' && statusBeforeML !== 'BUY',
          reason: mlBrainPrediction.reasons.join('; ') || null,
        });
      } else if (wouldHaveChanged) {
        // Shadow/advisory: record what would have happened
        const wouldHaveChangedTo = wouldDowngradeToBlock ? 'BLOCK' : 'WAIT';
        if (mlMode === 'shadow_only') {
          mlRuntimeEvents.recordShadowDecision({
            symbol: this.coin,
            originalDecision: statusBeforeML,
            mlPrediction: prediction?.prediction ?? null,
            brainVerdict: mlBrainPrediction.suggestedAction,
            wouldHaveChangedDecision: true,
            wouldHaveChangedTo,
            actualDecisionApplied: statusBeforeML,
            reason: mlBrainPrediction.reasons.join('; ') || null,
          });
        } else if (mlMode === 'advisory_only') {
          mlRuntimeEvents.recordAdvisoryEvent({
            symbol: this.coin,
            originalDecision: statusBeforeML,
            mlPrediction: prediction?.prediction ?? null,
            brainVerdict: mlBrainPrediction.suggestedAction,
            wouldHaveChangedDecision: true,
            wouldHaveChangedTo,
            actualDecisionApplied: statusBeforeML,
            reason: mlBrainPrediction.reasons.join('; ') || null,
          });
        }
      }
    }

    return {
      symbol: this.coin,
      mode: this.mode,
      selectedStrategy: autobotsResult.selectedStrategy || playbookSelection.selectedStrategy,
      selectedPlaybook: playbookSelection.selectedStrategy !== 'wait' ? playbookSelection.selectedStrategy : null,
      confidence: unifiedSignal.confidence,
      status,
      entryPlan,
      exitPlan: null,
      reasons: allReasons,
      blockReasons: allBlockReasons,
      warnings: allWarnings,
      requiredNextActions: [],
      ruleDecisionTrace: {
        unifiedSignal,
        playbookResult: playbookSelection.selectedPlaybook,
        autobotsResult,
      },
      mlPrediction: mlBrainPrediction,
      mlAdjustedConfidence,
      mlWarnings,
    };
  }

  private evaluateExit(price: { bid: number; ask: number; last: number }): TraderAction {
    if (!this.position) return { type: 'NOOP', coin: this.coin, reason: 'no_position' };

    const entry = this.position.avgEntryPrice;
    const current = this.mode === 'MANUAL' ? price.last : price.bid;
    const pnlPercent = (current - entry) / entry * 100;

    let shouldExit = false;
    let reason = '';

    if (pnlPercent <= -this.config.stopLossPercent) {
      shouldExit = true;
      reason = 'stop_loss';
    } else if (pnlPercent >= this.config.takeProfitPercent) {
      shouldExit = true;
      reason = 'take_profit';
    }

    const prediction = this.ml.predict(this.coin);
    if (mlRuntimeGuard.canTriggerSell() && this.mode === 'AUTO' && prediction && prediction.prediction === 'SELL' && pnlPercent > 0) {
      shouldExit = true;
      reason = 'ml_reversal';
    }

    if (this.mode === 'SCALPER' && Math.abs(pnlPercent) >= 0.3) {
      shouldExit = true;
      reason = 'scalper_target';
    }

    if (!shouldExit) return { type: 'NOOP', coin: this.coin, reason: 'hold' };

    return {
      type: 'EXIT',
      coin: this.coin,
      side: 'SELL',
      quantity: this.position.quantity,
      entryPrice: this.position.avgEntryPrice,
      reason,
    };
  }

  evaluateManualClose(): TraderAction {
    if (!this.position) return { type: 'NOOP', coin: this.coin, reason: 'no_position' };
    return {
      type: 'EXIT',
      coin: this.coin,
      side: 'SELL',
      quantity: this.position.quantity,
      entryPrice: this.position.avgEntryPrice,
      reason: 'manual_close',
    };
  }

  applyEntry(action: EnterAction, result: OrderResult, tradeId?: string): void {
    this.position = {
      coin: this.coin,
      tradeId,
      quantity: result.quantity,
      avgEntryPrice: result.price,
      currentPrice: result.price,
      pnl: 0,
      pnlPercent: 0,
      mode: this.mode,
      openedAt: Date.now(),
      highestPrice: result.price,
      highestPriceSinceTp: result.price,
      tpArmed: false,
      tpArmedAt: 0,
      tp1Hit: false,
      tp2Hit: false,
      stopLossPercent: this.config.stopLossPercent,
      tp1Percent: this.config.takeProfitPercent * 0.5,
      tp2Percent: this.config.takeProfitPercent,
      tpMode: 'fixed',
      tpTriggerType: 'percent',
      trailFromPeakPercent: 1.0,
      maxHoldSec: 86400,
      lastPrice: result.price,
      priceTimestamp: Date.now(),
      unrealizedPnlPercent: 0,
      ownerType: 'trader_brain',
      adapter: this.adapter.name,
    };
  }

  applyExit(): void {
    this.position = null;
  }

  private buildMarketContext(price: MarketPrice, prediction: MLPrediction | null): CoinMarketContext {
    const momentumScore = prediction?.features.momentum ?? 0;

    return {
      symbol: this.coin,
      price: price.last,
      bid: price.bid,
      ask: price.ask,
      spreadPct: price.ask > 0 ? ((price.ask - price.bid) / price.ask) * 100 : 0,
      m5Change: momentumScore * 100,
      m15Change: momentumScore * 200,
      h1Change: prediction?.features.priceChange ?? 0,
      change24h: (prediction?.features.priceChange ?? 0) * 24,
      volumeRel: 1,
      momentumScore,
      marketRegime: momentumScore > 0.5 ? 'uptrend' : momentumScore < -0.5 ? 'downtrend' : 'sideways',
      btcRegime: 'sideways',
      groupRegime: 'sideways',
      isUptrend: momentumScore > 0.3,
      isDowntrend: momentumScore < -0.5,
      isChoppy: Math.abs(momentumScore) < 0.15,
      isSideways: Math.abs(momentumScore) < 0.5,
      isAlt: !this.coin.includes('BTC'),
      btcDumping: false,
      dipDetected: momentumScore < -0.002,
      dipPercent: momentumScore < 0 ? momentumScore * 100 : 0,
      reboundConfirmed: momentumScore > 0.001,
      reboundPct: momentumScore > 0 ? momentumScore * 100 : 0,
      momentumConfirmed: Math.abs(momentumScore) > 0.001,
      overextended: (prediction?.features.rsi ?? 50) > 75,
      candleExhaustion: (prediction?.features.rsi ?? 50) > 80 || (prediction?.features.rsi ?? 50) < 20,
      fallingKnife: momentumScore < -0.005,
      breakoutPercent: momentumScore > 0.005 ? momentumScore * 100 : 0,
      priceFresh: Date.now() - price.timestamp < 10000,
      tpRoomOk: true,
      spreadOk: price.ask > 0 ? (price.ask - price.bid) / price.ask < 0.003 : true,
      volumePass: true,
      volumeAvailable: true,
      relativeStrengthVsBtc: momentumScore * 10,
      entryTiming: momentumScore > 0.001 ? 'good' : 'neutral',
      quality: prediction?.confidence ?? 0.5,
      marketRiskOff: false,
      mlBlocked: false,
    };
  }
}
