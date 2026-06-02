import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { EntryGate } from '../entry-gate/EntryGate';
import { logger } from '../../utils/logger';
import type {
  ManualRuntimeState, ManualAnalysisSnapshot, MarketPrice, TraderBrainDecision,
  EntryGateOutput, EntryGateInput,
} from '../types';

const STALE_AFTER_MS = 15000;

let _analysisIdCounter = 0;
function nextAnalysisId(): string {
  return `manual_${Date.now()}_${++_analysisIdCounter}`;
}

export type ManualBrainFn = (symbol: string, price: MarketPrice) => Promise<TraderBrainDecision>;

export class ManualRuntime {
  private state: ManualRuntimeState = 'OFF';
  private feed: MarketDataFeed;
  private entryGate: EntryGate;
  private brainFn: ManualBrainFn | null = null;
  private currentAnalysis: ManualAnalysisSnapshot | null = null;

  constructor() {
    this.feed = MarketDataFeed.getInstance();
    this.entryGate = new EntryGate();
  }

  getState(): ManualRuntimeState { return this.state; }

  setBrainDecide(fn: ManualBrainFn) { this.brainFn = fn; }

  getAnalysis(): ManualAnalysisSnapshot | null {
    return this.currentAnalysis;
  }

  isFresh(): boolean {
    if (!this.currentAnalysis) return false;
    return !this.currentAnalysis.isStale;
  }

  async analyzeSymbol(symbol: string): Promise<ManualAnalysisSnapshot> {
    this.state = 'ANALYZING';

    const price = await this.feed.getPrice(symbol);
    if (!price || price.last <= 0) {
      this.state = 'ERROR';
      const errorSnapshot: ManualAnalysisSnapshot = {
        analysisId: nextAnalysisId(),
        symbol,
        analyzedAt: new Date().toISOString(),
        price: 0,
        bid: 0,
        ask: 0,
        spreadPct: 0,
        traderBrainDecision: null,
        entryGateDecision: null,
        staleAfterMs: STALE_AFTER_MS,
        isStale: false,
      };
      this.currentAnalysis = errorSnapshot;
      return errorSnapshot;
    }

    let decision: TraderBrainDecision | null = null;
    if (this.brainFn) {
      decision = await this.brainFn(symbol, price);
    }

    const spreadPct = price.ask > 0 ? ((price.ask - price.bid) / price.ask) * 100 : 0;

    const gateInput: EntryGateInput = {
      coin: symbol,
      side: 'BUY',
      price: price.last,
      quantity: 0.001,
      mode: 'MANUAL',
      mlConfidence: decision?.confidence ?? 0.5,
      prediction: decision?.selectedStrategy ?? 'manual_analysis',
      currentPositions: 0,
      maxPositions: 10,
      recentLoss: false,
      spreadOk: spreadPct < 0.5,
      volumePass: !(decision?.blockReasons.some(r => r.includes('volume')) ?? false),
      priceFresh: Date.now() - price.timestamp < 30000,
      btcDumping: decision?.blockReasons.some(r => r.includes('btc') || r.includes('dump')) ?? false,
      marketRegimeUnsafe: decision?.blockReasons.some(r => r.includes('regime')) ?? false,
      reboundConfirmed: !(decision?.blockReasons.some(r => r.includes('rebound')) ?? false),
      momentumConfirmed: !(decision?.blockReasons.some(r => r.includes('momentum')) ?? false),
      tpRoomOk: !(decision?.blockReasons.some(r => r.includes('tp') || r.includes('room')) ?? false),
      isVeryHighRisk: decision?.blockReasons.some(r => r.includes('risk')) ?? false,
      isLive: false,
    };

    const gateResult = this.entryGate.evaluate(gateInput);

    const snapshot: ManualAnalysisSnapshot = {
      analysisId: nextAnalysisId(),
      symbol,
      analyzedAt: new Date().toISOString(),
      price: price.last,
      bid: price.bid,
      ask: price.ask,
      spreadPct,
      traderBrainDecision: decision,
      entryGateDecision: gateResult,
      staleAfterMs: STALE_AFTER_MS,
      isStale: false,
    };

    this.currentAnalysis = snapshot;
    this.state = 'READY';

    logger.info(`MANUAL_ANALYSIS: ${symbol} — ${gateResult.decision} (conf:${decision?.confidence?.toFixed(2) ?? 'N/A'})`);

    return snapshot;
  }

  markStale(): void {
    if (this.currentAnalysis && !this.currentAnalysis.isStale) {
      this.currentAnalysis.isStale = true;
      this.state = 'STALE';
      logger.info(`MANUAL_ANALYSIS_STALE: ${this.currentAnalysis.symbol}`);
    }
  }

  reset(): void {
    this.currentAnalysis = null;
    this.state = 'OFF';
  }

  destroy(): void {
    this.currentAnalysis = null;
    this.state = 'OFF';
  }
}
