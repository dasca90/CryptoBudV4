import { MarketScanner, BrainDecideFn } from '../scanner/MarketScanner';
import { MarketDataFeed } from '../../utils/MarketDataFeed';
import { MLPredictor } from '../ml/MLPredictor';
import { logger } from '../../utils/logger';
import type {
  UniverseMode, ScannerSnapshot, ScannerCandidate, TraderBrainDecision, MarketPrice,
} from '../types';

export interface AutoRuntimeCallbacks {
  onCandidatesReady: (snapshot: ScannerSnapshot) => void;
  executeBuy?: (candidate: ScannerCandidate, snapshot?: ScannerSnapshot, rejectedNearCandidates?: string[]) => Promise<void>;
  getAvailableSlots?: () => number;
}

export class AutoRuntime {
  private scanner: MarketScanner;
  private ml: MLPredictor;
  private feed: MarketDataFeed;
  private running = false;
  private scanLoopTask: Promise<void> | null = null;
  private scanIntervalMs = 15000;
  private callbacks: AutoRuntimeCallbacks | null = null;
  private brainDecideFn: BrainDecideFn | null = null;

  constructor(ml: MLPredictor) {
    this.scanner = new MarketScanner();
    this.ml = ml;
    this.feed = MarketDataFeed.getInstance();
  }

  setCallbacks(cb: AutoRuntimeCallbacks) { this.callbacks = cb; }

  getScanner(): MarketScanner { return this.scanner; }

  isRunning(): boolean { return this.running; }

  setScanInterval(ms: number) { this.scanIntervalMs = ms; }
  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  setBrainDecide(fn: BrainDecideFn) {
    this.brainDecideFn = fn;
    this.scanner.setBrainDecide(fn);
  }

  async start(universeMode?: UniverseMode): Promise<void> {
    if (this.running) return;
    logger.info(`AUTO_RUNTIME: Starting scannerInstanceId=${this.scanner.getScannerInstanceId()} paperAutoExecutionEnabled=${String(this.scanner.isPaperAutoEnabled())} paperAutoBuyFnPresent=${String(this.scanner.hasPaperAutoBuyFn())} logSinkName=logger.getLogs/logger.export`);
    this.running = true;

    await this.scanner.start();
    this.scanner.startCandidateRevalidationLoop();

    logger.info('AUTO_RUNTIME: Started');
    this.scanLoopTask = this.runLoop(universeMode);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.scanLoopTask = null;
    this.scanner.stopCandidateRevalidationLoop();
    await this.scanner.stop();
    logger.info('AUTO_RUNTIME: Stopped');
  }

  private async runLoop(universeMode?: UniverseMode): Promise<void> {
    logger.info('SCANNER_LOOP_START');
    while (this.running) {
      const shouldContinue = await this.runScan(universeMode);
      if (!this.running) break;
      if (!shouldContinue) {
        logger.info('SCANNER_LOOP_STOP_BLOCKED: empty universe — waiting for user config change');
        this.running = false;
        break;
      }
      const mode = universeMode ?? this.scanner.getUniverseMode();
      const cooldownMs = Math.max(this.scanIntervalMs, this.scanner.getCooldownMsForMode(mode));
      if (mode === 'BINANCE_TOP_250' && this.scanIntervalMs < 60000 && cooldownMs >= 60000) {
        logger.throttled('INFO', `TOP_250_SCAN_COOLDOWN_ENFORCED: configuredScanInterval=${this.scanIntervalMs} effectiveCooldown=${cooldownMs}`, 'top250_cooldown', 300000);
      }
      logger.info(`SCANNER_COOLDOWN_START: ${cooldownMs}ms`);
      const nextAt = new Date(Date.now() + cooldownMs).toISOString();
      logger.info(`SCANNER_NEXT_SCAN_SCHEDULED: ${nextAt}`);
      await this.sleep(cooldownMs);
    }
  }

  private async runScan(universeMode?: UniverseMode): Promise<boolean> {
    try {
      const snapshot = await this.scanner.scan(universeMode);

      // Check for blocking empty universe — stop the loop
      const emptyReason = snapshot.emptyUniverseReason;
      if (emptyReason && ['WATCHLIST_EMPTY', 'ALL_RISK_GROUPS_DISABLED', 'ALL_SYMBOLS_FILTERED', 'UNKNOWN_EMPTY_UNIVERSE'].includes(emptyReason)) {
        if (this.callbacks) {
          this.callbacks.onCandidatesReady(snapshot);
        }
        return false;
      }

      // Notify UI
      if (this.callbacks) {
        this.callbacks.onCandidatesReady(snapshot);
      }

      // Build candidate pool from ranked candidates
      const allCandidates = snapshot.candidates;
      const buyReady = allCandidates.filter(c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW');
      const waitStrong = allCandidates.filter(c => c.status === 'WAIT' && c.confidence >= 0.65).slice(0, 5);
      const eligiblePool = [...buyReady, ...waitStrong];
      logger.info(`SCANNER_POOL_BUILT: scanId=${snapshot.scanId} universeMode=${snapshot.universeMode} totalScanned=${snapshot.scannedCount} totalCandidates=${snapshot.candidateCount} buyReady=${buyReady.length} waitCount=${snapshot.waitCount} blockCount=${snapshot.blockCount} avoidCount=${snapshot.avoidCount} eligiblePoolSize=${eligiblePool.length}`);
      logger.info(`SCANNER_POOL_RANKED: scanId=${snapshot.scanId} topSymbols=${allCandidates.slice(0, 5).map(c => c.symbol).join(',')} topScores=${allCandidates.slice(0, 5).map(c => c.rawScore ?? 0).join(',')} rankingReasons=${allCandidates.slice(0, 3).map(c => c.mainReason).join(' | ')}`);

      const buys = allCandidates.filter(
        c => c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW'
      );
      if (buys.length === 0) {
        logger.info(`SCANNER_NO_BUY_FROM_POOL: scanId=${snapshot.scanId} poolSize=${eligiblePool.length} topReasons=${snapshot.diagnostics.topBlockReasons.map(r => r.reason).join(',')} nearestCandidates=${allCandidates.slice(0, 3).map(c => c.symbol).join(',')}`);
        return true;
      }
      if (buys.length > 0) {
        logger.info(`AUTO_RUNTIME: ${buys.length} BUY candidates ready for execution`);
      }
      logger.info(`AUTO_RUNTIME_EXECUTION_DELEGATED: scanId=${snapshot.scanId} buyReady=${buys.length} canonicalExecutor=MarketScanner.ExecutionPlanner reason=avoid_duplicate_buy_by_symbol_path`);
      return true;
    } catch (err) {
      logger.warn(`AUTO_RUNTIME scan error: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }
}
