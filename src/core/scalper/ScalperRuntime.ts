import type {
  ScalperState, ScalperCandidate, ScalperSnapshot, ScalperRadarStats, ScalperDiagnostics,
  ScalperComponentScores, ScalperComponentPass, ScalperSignal, CandidateStatus,
  MarketPrice, TraderBrainDecision, EntryGateOutput, ScalperHistogramBar,
} from '../types';
import { EntryGate } from '../entry-gate/EntryGate';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { getUniverseSymbols, getRiskGroup, isVeryHighRisk } from '../scanner/scanner-universe';
import { calculateScalpScore, DEFAULT_SCALPER_CONFIG, type ScalperScoreConfig } from './scalper-score';
import { logger } from '../../utils/logger';

let _snapshotIdCounter = 0;
function nextSnapshotId(): string {
  return `scalp_${Date.now()}_${++_snapshotIdCounter}`;
}

let _candidateIdCounter = 0;
function nextCandidateId(): string {
  return `scand_${Date.now()}_${++_candidateIdCounter}`;
}

export type ScalperBrainFn = (symbol: string, price: MarketPrice) => Promise<TraderBrainDecision>;

export interface ScalperRuntimeCallbacks {
  onSnapshotReady: (snapshot: ScalperSnapshot) => void;
  executeBuy: (candidate: ScalperCandidate) => Promise<void>;
}

export class ScalperRuntime {
  private state: ScalperState = 'OFF';
  private config: ScalperScoreConfig = { ...DEFAULT_SCALPER_CONFIG };
  private watchlist: string[] = [];
  private feed: MarketDataFeed;
  private entryGate: EntryGate;
  private brainFn: ScalperBrainFn | null = null;
  private callbacks: ScalperRuntimeCallbacks | null = null;
  private snapshots: ScalperSnapshot[] = [];
  private maxSnapshots = 20;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs = 5000;
  private running = false;

  constructor() {
    this.feed = MarketDataFeed.getInstance();
    this.entryGate = new EntryGate();
  }

  // ── Config ──

  getConfig(): ScalperScoreConfig { return { ...this.config }; }
  setConfig(cfg: Partial<ScalperScoreConfig>) { this.config = { ...this.config, ...cfg }; }

  setWatchlist(list: string[]) { this.watchlist = [...list]; }
  getWatchlist(): string[] { return [...this.watchlist]; }

  setBrainDecide(fn: ScalperBrainFn) { this.brainFn = fn; }
  setCallbacks(cb: ScalperRuntimeCallbacks) { this.callbacks = cb; }

  getState(): ScalperState { return this.state; }
  isRunning(): boolean { return this.running; }

  getLastSnapshot(): ScalperSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }
  getSnapshots(): ScalperSnapshot[] { return [...this.snapshots]; }
  setTickInterval(ms: number) { this.tickIntervalMs = ms; }

  // ── Lifecycle ──

  async arm(): Promise<void> {
    if (this.state === 'ARMED' || this.state === 'RUNNING') return;
    this.state = 'ARMED';
    logger.info('SCALPER_ARMED');
  }

  async start(): Promise<void> {
    if (this.state === 'RUNNING') return;
    if (this.state !== 'ARMED') {
      logger.warn('SCALPER: must be ARMED before starting');
      return;
    }
    this.state = 'RUNNING';
    this.running = true;
    logger.info('SCALPER_STARTED');

    // Immediate first tick
    await this.runTick();

    // Periodic ticks
    this.tickInterval = setInterval(async () => {
      if (this.running) {
        await this.runTick();
      }
    }, this.tickIntervalMs);
  }

  async pause(): Promise<void> {
    this.state = 'PAUSED';
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.info('SCALPER_PAUSED');
  }

  async stop(): Promise<void> {
    this.state = 'OFF';
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.info('SCALPER_STOPPED');
  }

  async emergencyStop(): Promise<void> {
    this.state = 'FORCED_OFF';
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.warn('SCALPER_FORCED_OFF');
  }

  async error(err: string): Promise<void> {
    this.state = 'ERROR';
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.error(`SCALPER_ERROR: ${err}`);
  }

  // ── Radar scan tick ──

  private async runTick(): Promise<void> {
    if (!this.brainFn) {
      logger.warn('SCALPER: no brainDecide set');
      return;
    }
    if (this.state !== 'RUNNING') return;

    const tickStartTime = Date.now();
    logger.throttled('INFO', 'SCALPER_TICK_START', 'scalper_tick', 30000);
    const startedAt = new Date().toISOString();

    // Use HIGH_RISK and VERY_HIGH_RISK symbols
    const highRiskSymbols = getUniverseSymbols('HIGH_RISK', this.watchlist);
    const veryHighRiskSymbols = getUniverseSymbols('VERY_HIGH_RISK', this.watchlist);
    const allSymbols = [...new Set([...highRiskSymbols, ...veryHighRiskSymbols])];

    const candidates: ScalperCandidate[] = [];

    for (const symbol of allSymbols) {
      try {
        const candidate = await this.analyzeSymbol(symbol);
        if (candidate) candidates.push(candidate);
      } catch (err) {
        logger.warn(`SCALPER_ERROR: ${symbol} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Build snapshot
    const snapshot = this.buildSnapshot(startedAt, candidates, allSymbols.length);
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    const tickDurationMs = Date.now() - tickStartTime;
    logger.throttled('INFO', `SCALPER_TICK_FINISH: ${snapshot.candidateCount} candidates, ${snapshot.buyCount} BUY, ${snapshot.waitCount} WAIT, ${snapshot.blockCount} BLOCK (${tickDurationMs}ms)`, `scalper_tick_finish`, 30000);
    if (tickDurationMs > 1000) {
      logger.warn(`SCALPER_PERF_SUMMARY: tick took ${tickDurationMs}ms — consider reducing watchlist`);
    }
    logger.throttled('INFO', `SCALPER_RADAR_STATUS: ${snapshot.radarStats.dataSource} — ${snapshot.liveSignals} live signals`, `scalper_radar`, 60000);

    if (this.callbacks) {
      this.callbacks.onSnapshotReady(snapshot);
    }

    // Execute BUY candidates that passed EntryGate
    const buys = candidates.filter(
      c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW'
    );
    if (buys.length > 0) {
      logger.info(`SCALPER_ENTRY_ALLOWED: ${buys.length} BUY candidates ready for execution`);
    }
    for (const candidate of buys) {
      if (!this.running) break;
      if (this.callbacks) {
        logger.info(`SCALPER: executing BUY for ${candidate.symbol}`);
        await this.callbacks.executeBuy(candidate);
      }
    }

    this.state = 'RUNNING';
  }

  private async analyzeSymbol(symbol: string): Promise<ScalperCandidate | null> {
    const price = await this.feed.getPrice(symbol);
    if (!price || price.last <= 0) {
      logger.info(`SCALPER_CANDIDATE_CREATED: ${symbol} → BLOCK (no price data)`);
      return null;
    }

    const riskGroup = getRiskGroup(symbol);
    const spreadPct = price.ask > 0 ? ((price.ask - price.bid) / price.ask) * 100 : 0;
    const priceAgeMs = Date.now() - price.timestamp;
    const bookFresh = priceAgeMs < 10000;
    const priceFresh = priceAgeMs < 30000;
    const isVeryHighRiskSymbol = isVeryHighRisk(symbol);

    // Get TraderBrain decision
    let decision: TraderBrainDecision | null = null;
    if (this.brainFn) {
      decision = await this.brainFn(symbol, price);
    }

    // Calculate scalp score
    const scoreResult = calculateScalpScore({
      priceFresh,
      bookFresh,
      spreadPct,
      volumeSurgePct: 200,
      momentumScore: decision?.confidence ? decision.confidence * 100 : 50,
      pullbackPct: 0.3,
      confirmationCount: 2,
      priceAgeMs,
      riskGroup,
      btcDumping: decision?.blockReasons.some(r => r.includes('btc') || r.includes('dump')) ?? false,
      tpRoomOk: !(decision?.blockReasons.some(r => r.includes('tp')) ?? false),
      isLive: false,
      isVeryHighRisk: isVeryHighRiskSymbol,
    }, this.config);

    // EntryGate evaluation for BUY candidates
    let gateResult: EntryGateOutput | null = null;
    if (scoreResult.statusSuggestion === 'BUY' || scoreResult.statusSuggestion === 'WAIT') {
      gateResult = this.entryGate.evaluate({
        coin: symbol,
        side: 'BUY',
        price: price.last,
        quantity: 0.001,
        mode: 'SCALPER',
        mlConfidence: decision?.confidence ?? 0.5,
        prediction: scoreResult.signal,
        currentPositions: 0,
        maxPositions: 10,
        recentLoss: false,
        spreadOk: spreadPct <= this.config.spreadMaxPct,
        volumePass: scoreResult.componentPass.volumeSurge,
        priceFresh,
        btcDumping: scoreResult.blockReasons.some(r => r.includes('BTC') || r.includes('dump')),
        marketRegimeUnsafe: false,
        reboundConfirmed: true,
        momentumConfirmed: scoreResult.componentPass.momentum,
        tpRoomOk: !scoreResult.blockReasons.some(r => r.includes('TP') || r.includes('tp')),
        isVeryHighRisk: isVeryHighRiskSymbol,
        isLive: false,
      });
    }

    // Determine final status
    let status: CandidateStatus = scoreResult.statusSuggestion;
    if (gateResult && gateResult.decision !== 'ALLOW') {
      status = 'BLOCK';
    }

    const mainReason = status === 'BUY'
      ? `Scalp score ${scoreResult.scalpScore} — ${scoreResult.signal}`
      : (scoreResult.blockReasons[0] || 'waiting');

    const candidate: ScalperCandidate = {
      candidateId: nextCandidateId(),
      symbol,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'SCALPER',
      riskGroup,
      signal: scoreResult.signal,
      scalpScore: scoreResult.scalpScore,
      scalpScoreThreshold: this.config.scalpScoreThreshold,
      status,
      price: price.last,
      priceAgeMs,
      spreadPct,
      volumeSurgePct: 200,
      momentumScore: decision?.confidence ? decision.confidence * 100 : 50,
      pullbackPct: 0.3,
      confirmationCount: 2,
      tp1Pct: this.config.tp1Pct,
      tp2Pct: this.config.tp2Pct,
      stopLossPct: this.config.stopLossPct,
      maxHoldSec: this.config.maxHoldSec,
      trailTriggerPct: this.config.trailTriggerPct,
      trailPullbackPct: this.config.trailPullbackPct,
      traderBrainDecision: decision,
      entryGateDecision: gateResult,
      componentScores: scoreResult.componentScores,
      componentPass: scoreResult.componentPass,
      mainReason,
      blockReasons: scoreResult.blockReasons,
      warnings: scoreResult.warnings,
      requiredNextActions: gateResult?.requiredNextActions ?? (status === 'WAIT' ? ['Wait for setup'] : []),
    };

    this.logCandidate(candidate);
    return candidate;
  }

  private logCandidate(c: ScalperCandidate): void {
    logger.throttled('INFO', `SCALPER_CANDIDATE_CREATED: ${c.symbol} → ${c.status} (score=${c.scalpScore}, signal=${c.signal})`, `scalper_cand_${c.symbol}`, 60000);
    if (c.status === 'WAIT') logger.throttled('INFO', `SCALPER_CANDIDATE_WAIT: ${c.symbol} — ${c.mainReason}`, `scalper_wait_${c.symbol}`, 60000);
    if (c.status === 'BLOCK') logger.throttled('INFO', `SCALPER_CANDIDATE_BLOCK: ${c.symbol} — ${c.mainReason}`, `scalper_block_${c.symbol}`, 60000);
    if (c.status === 'BUY') logger.throttled('INFO', `SCALPER_ENTRY_ALLOWED: ${c.symbol} — ${c.mainReason}`, `scalper_buy_${c.symbol}`, 30000);
  }

  private buildSnapshot(
    startedAt: string,
    candidates: ScalperCandidate[],
    scannedCount: number,
  ): ScalperSnapshot {
    const buyCount = candidates.filter(c => c.status === 'BUY').length;
    const waitCount = candidates.filter(c => c.status === 'WAIT').length;
    const blockCount = candidates.filter(c => c.status === 'BLOCK').length;
    const avoidCount = candidates.filter(c => c.status === 'AVOID').length;

    const diag = this.buildDiagnostics(candidates);

    const radarStats = this.buildRadarStats(candidates);

    // Rank candidates by scalpScore descending
    const ranked = [...candidates].sort((a, b) => b.scalpScore - a.scalpScore);
    for (let i = 0; i < ranked.length; i++) {
      ranked[i].rank = i + 1;
    }

    return {
      snapshotId: nextSnapshotId(),
      startedAt,
      finishedAt: new Date().toISOString(),
      runtimeState: this.state,
      scannedCount,
      candidateCount: candidates.length,
      buyCount,
      waitCount,
      blockCount,
      avoidCount,
      liveSignals: candidates.filter(c => c.signal !== 'NONE').length,
      activeScalpPositions: 0,
      candidates: ranked,
      radarStats,
      diagnostics: diag,
    };
  }

  private buildDiagnostics(candidates: ScalperCandidate[]): ScalperDiagnostics {
    const diag: ScalperDiagnostics = {
      blockedByStalePrice: 0,
      blockedByMissingBook: 0,
      blockedBySpread: 0,
      blockedByVolumeTooLow: 0,
      blockedByBtcDump: 0,
      blockedByNoMomentum: 0,
      blockedByNoTpRoom: 0,
      blockedByScoreBelowThreshold: 0,
      blockedByVeryHighRiskLive: 0,
      blockedByScalperLiveDisabled: 0,
      blockedByPriceOffline: 0,
      blockedByMarketDataBad: 0,
      blockedBySymbolNotTradable: 0,
      blockedByMinNotional: 0,
      blockedByLotSize: 0,
      topBlockReasons: [],
    };

    const reasonCounts: Record<string, number> = {};
    for (const c of candidates) {
      for (const r of c.blockReasons) {
        const rl = r.toLowerCase();
        if (rl.includes('stale')) diag.blockedByStalePrice++;
        if (rl.includes('book')) diag.blockedByMissingBook++;
        if (rl.includes('spread')) diag.blockedBySpread++;
        if (rl.includes('volume')) diag.blockedByVolumeTooLow++;
        if (rl.includes('btc') || rl.includes('dump')) diag.blockedByBtcDump++;
        if (rl.includes('momentum')) diag.blockedByNoMomentum++;
        if (rl.includes('tp') || rl.includes('room')) diag.blockedByNoTpRoom++;
        if (rl.includes('score') || rl.includes('threshold')) diag.blockedByScoreBelowThreshold++;
        if (rl.includes('risk')) diag.blockedByVeryHighRiskLive++;
        if (rl.includes('scalper_live')) diag.blockedByScalperLiveDisabled++;
        if (rl.includes('offline')) diag.blockedByPriceOffline++;
        reasonCounts[r] = (reasonCounts[r] || 0) + 1;
      }
    }

    diag.topBlockReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return diag;
  }

  private buildRadarStats(candidates: ScalperCandidate[]): ScalperRadarStats {
    const now = Date.now();
    const allAges = candidates.map(c => c.priceAgeMs);
    const minAge = allAges.length > 0 ? Math.min(...allAges) : Infinity;

    let dataSource: ScalperRadarStats['dataSource'] = 'empty';
    if (candidates.length > 0) {
      if (minAge < 10000) dataSource = 'live';
      else if (minAge < 30000) dataSource = 'stale';
      else dataSource = 'dead';
    }

    return {
      dataSource,
      dataAgeMs: minAge === Infinity ? 0 : minAge,
      lastPricePollAt: candidates.length > 0 ? now : null,
      lastBookTickerAt: candidates.length > 0 ? now : null,
      pollFailureReason: null,
      isLive: dataSource === 'live',
      liveSignals: candidates.filter(c => c.signal !== 'NONE').length,
      scalpCandidates: candidates.length,
      activeScalpPositions: 0,
      closedToday: 0,
      pnlToday: 0,
      winRate: 0,
      avgHoldSec: 0,
      histogramBars: candidates.map(c => ({
        symbol: c.symbol,
        score: c.scalpScore,
        signal: c.signal,
        status: c.status,
      })).slice(0, 10),
    };
  }

  destroy(): void {
    this.state = 'OFF';
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.snapshots = [];
  }
}
