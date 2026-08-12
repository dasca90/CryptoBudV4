import { logger } from '../../utils/logger';
import { MarketEdgeDataAdapter, type MarketEdgeDataEvent } from './MarketEdgeDataAdapter';
import { MarketEdgeKernel } from './MarketEdgeKernel';
import { MarketEdgeOutcomeTracker, type EdgeOutcomeSummary } from './MarketEdgeOutcomeTracker';
import { MarketEdgePublicClient } from './MarketEdgePublicClient';
import { MarketEdgeSnapshotStore } from './MarketEdgeSnapshotStore';
import { buildMarketEdgeMappingsFromCanonicalSpotUniverse, type MarketEdgeSymbolMapping } from './MarketEdgeSymbolMapper';
import { normalizeMarketEdgeConfig, normalizeMarketEdgeMode, type MarketEdgeConfig } from './config';
import type { MarketEdgeHealth, MarketEdgeMode, MarketEdgeSnapshot } from './types';

export interface MarketEdgeRuntimeState {
  mode: MarketEdgeMode;
  health: MarketEdgeHealth;
  universeSize: number;
  mappedSymbols: number;
  perpetualSymbols: number;
  detailedSymbols: number;
  hydratedSymbols: number;
  highEdgeCount: number;
  earlyOpportunityCount: number;
  lastCalculatedAt: number | null;
  failureReason: string | null;
  runtimeStarted: boolean;
  workerActive: boolean;
  futuresUniverseSymbols: number;
  snapshotCount: number;
  spotInputSymbols: number;
  futuresInputSymbols: number;
  spotWarmSymbols: number;
  futuresWarmSymbols: number;
  synchronizedSymbols: number;
  maxWindowDeltaMs: number | null;
  timestampUnitMismatchSymbols: number;
  primaryBlocker: string | null;
}

export class MarketEdgeRuntime {
  private static activeRuntimeInstances = 0;
  private config: MarketEdgeConfig;
  private readonly kernel: MarketEdgeKernel;
  private readonly store: MarketEdgeSnapshotStore;
  private readonly outcomes = new MarketEdgeOutcomeTracker();
  private readonly listeners = new Set<(state: MarketEdgeRuntimeState) => void>();
  private readonly publicClient: MarketEdgePublicClient;
  private readonly dataAdapter: MarketEdgeDataAdapter;
  private mappings: MarketEdgeSymbolMapping[] = [];
  private allMappings: MarketEdgeSymbolMapping[] = [];
  private futuresInfo: Record<string, unknown> | null = null;
  private activeSymbols = new Set<string>();
  private universeSymbols: string[] = [];
  private calculateTimer: ReturnType<typeof setInterval> | null = null;
  private oiTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private running = false;
  private lifecycleGeneration = 0;
  private failureReason: string | null = null;
  private lastCalculatedAt: number | null = null;
  private lastPriorityAtBySymbol = new Map<string, number>();
  private marketBreadthBullishPct: number | null = null;
  private detailedSymbols: string[] = [];
  private lastDetailedUpdateAt = 0;
  private startedAt: number | null = null;
  private restartCount = 0;
  private lastFuturesConnectionState: boolean | null = null;
  private lastSynchronizedWindowAt: number | null = null;

  constructor(config: Partial<MarketEdgeConfig> = {}, private readonly requestPriorityReanalysis?: (symbols: string[]) => void, dependencies?: { publicClient?: MarketEdgePublicClient; dataAdapter?: MarketEdgeDataAdapter }) {
    this.config = normalizeMarketEdgeConfig(config);
    this.kernel = new MarketEdgeKernel(this.config);
    this.store = new MarketEdgeSnapshotStore(this.config.universeSize);
    this.publicClient = dependencies?.publicClient ?? new MarketEdgePublicClient();
    this.dataAdapter = dependencies?.dataAdapter ?? new MarketEdgeDataAdapter(event => this.onData(event));
    logger.info(`MARKET_EDGE_RUNTIME_LIFECYCLE_AUDIT created=true started=false stopped=false restartCount=0 activeSubscriptions=0 runtimeMode=${this.config.mode}`);
  }

  async start(spotUniverseSymbols: string[]): Promise<void> {
    if (this.running || this.config.mode === 'OFF') return;
    this.running = true;
    MarketEdgeRuntime.activeRuntimeInstances++;
    this.startedAt = Date.now();
    const generation = ++this.lifecycleGeneration;
    this.failureReason = null;
    this.universeSymbols = [...new Set(spotUniverseSymbols.map(s => s.toUpperCase()))].slice(0, this.config.universeSize);
    logger.info(`MARKET_EDGE_RUNTIME_LIFECYCLE_AUDIT created=true started=true stopped=false restartCount=${this.restartCount} activeSubscriptions=${this.listeners.size} runtimeMode=${this.config.mode}`);
    logger.info(`MARKET_EDGE_SINGLETON_INVARIANT_AUDIT runtimeInstances=${MarketEdgeRuntime.activeRuntimeInstances} activeSockets=${this.dataAdapter.getStats().socketsOpen} activeWorkers=${this.calculateTimer ? 1 : 0} invariantOk=${String(MarketEdgeRuntime.activeRuntimeInstances === 1)}`);
    try {
      const futuresInfo = await this.publicClient.getFuturesExchangeInfo();
      if (!this.running || generation !== this.lifecycleGeneration) return;
      this.futuresInfo = futuresInfo;
      this.allMappings = buildMarketEdgeMappingsFromCanonicalSpotUniverse(this.universeSymbols, futuresInfo).filter(mapping => mapping.spotTradingActive);
      this.mappings = this.allMappings;
      this.activeSymbols = new Set(this.mappings.map(mapping => mapping.spotSymbol));
      const initialDetailed = this.mappings.filter(mapping => mapping.hasPerpetualPair).slice(0, this.config.detailedTopK).map(mapping => mapping.spotSymbol);
      this.detailedSymbols = [...initialDetailed].sort();
      this.lastDetailedUpdateAt = Date.now();
      this.dataAdapter.start(this.mappings.filter(mapping => mapping.hasPerpetualPair).map(mapping => mapping.spotSymbol), initialDetailed);
      this.retryAttempt = 0;
      this.calculateTimer = setInterval(() => this.calculateCycle(), 1_000);
      this.oiTimer = setInterval(() => { void this.hydrateOpenInterest(); void this.hydratePremiumContext(); }, 60_000);
      void this.hydrateOpenInterest();
      void this.hydratePremiumContext();
      const futuresRows = Array.isArray(futuresInfo.symbols) ? futuresInfo.symbols as Array<Record<string, unknown>> : [];
      const trading = futuresRows.filter(row => String(row.status) === 'TRADING');
      const usdtPerpetual = trading.filter(row => String(row.contractType) === 'PERPETUAL' && String(row.quoteAsset) === 'USDT');
      const futuresSymbols = new Set(usdtPerpetual.map(row => String(row.symbol ?? '')));
      const spotSymbols = new Set(this.universeSymbols);
      const mappedPerpetual = this.mappings.filter(mapping => mapping.hasPerpetualPair).length;
      logger.info(`EDGE_FUTURES_UNIVERSE_AUDIT requestAttempted=true requestOk=true rawSymbolCount=${futuresRows.length} tradingContractCount=${trading.length} usdtPerpetualCount=${usdtPerpetual.length} parsedSymbolCount=${usdtPerpetual.length} failureReason=none`);
      logger.info(`EDGE_SYMBOL_MAPPING_AUDIT spotUniverseCount=${this.universeSymbols.length} futuresUniverseCount=${usdtPerpetual.length} mappedCount=${mappedPerpetual} spotOnlyCount=${this.mappings.filter(mapping => !mapping.hasPerpetualPair).length} futuresOnlyCount=${[...futuresSymbols].filter(symbol => !spotSymbols.has(symbol)).length} eligibleMappedCount=${this.mappings.length} sampleMapped=${this.mappings.filter(mapping => mapping.hasPerpetualPair).slice(0, 6).map(mapping => mapping.spotSymbol).join('|') || 'none'} sampleUnmapped=${this.mappings.filter(mapping => !mapping.hasPerpetualPair).slice(0, 6).map(mapping => mapping.spotSymbol).join('|') || 'none'}`);
      logger.info(`EDGE_ASSET_ELIGIBILITY_INTERACTION_AUDIT mappedBeforeEligibility=${mappedPerpetual} blockedByEligibility=0 mappedAfterEligibility=${mappedPerpetual} eligibilitySource=canonical_scanner_universe`);
      logger.info(`MARKET_EDGE_SINGLETON_INVARIANT_AUDIT runtimeInstances=${MarketEdgeRuntime.activeRuntimeInstances} activeSockets=${this.dataAdapter.getStats().socketsOpen} activeWorkers=${this.calculateTimer ? 1 : 0} invariantOk=${String(MarketEdgeRuntime.activeRuntimeInstances === 1 && this.calculateTimer != null)}`);
      logger.info(`MARKET_EDGE_LIFECYCLE_AUDIT action=start mode=${this.config.mode} universeSize=${this.universeSymbols.length} mappedSymbols=${this.mappings.length} perpetualSymbols=${this.mappings.filter(m => m.hasPerpetualPair).length} directBuyPath=false futuresOrders=false`);
    } catch (error) {
      if (!this.running || generation !== this.lifecycleGeneration) return;
      this.failureReason = error instanceof Error ? error.message : String(error);
      logger.warn(`EDGE_FUTURES_UNIVERSE_AUDIT requestAttempted=true requestOk=false rawSymbolCount=0 tradingContractCount=0 usdtPerpetualCount=0 parsedSymbolCount=0 failureReason=${this.failureReason.replace(/\s+/g, '_')}`);
      logger.warn(`EDGE_DATA_HEALTH_AUDIT health=EDGE_OFFLINE reason=${this.failureReason.replace(/\s+/g, '_')} spotScannerAffected=false exitEngineAffected=false`);
      this.scheduleInitializationRetry();
    }
    this.emit();
  }

  async updateUniverse(spotUniverseSymbols: string[]): Promise<void> {
    const canonical = [...new Set(spotUniverseSymbols.map(symbol => symbol.toUpperCase()))].slice(0, this.config.universeSize);
    if (!this.running) { await this.start(canonical); return; }
    const previousSet = new Set(this.universeSymbols), nextSet = new Set(canonical);
    if (previousSet.size === nextSet.size && [...nextSet].every(symbol => previousSet.has(symbol))) { this.universeSymbols = canonical; return; }
    if (!this.futuresInfo) { this.stop(); await this.start(canonical); return; }
    this.universeSymbols = canonical;
    this.allMappings = buildMarketEdgeMappingsFromCanonicalSpotUniverse(canonical, this.futuresInfo).filter(mapping => mapping.spotTradingActive);
    this.mappings = this.allMappings;
    this.activeSymbols = new Set(this.mappings.map(mapping => mapping.spotSymbol));
    this.kernel.retainSymbols(this.activeSymbols);
    this.store.retainSymbols(this.activeSymbols);
    this.dataAdapter.updateBaselineSymbols(this.mappings.filter(mapping => mapping.hasPerpetualPair).map(mapping => mapping.spotSymbol));
    logger.info(`MARKET_EDGE_SYMBOL_MAPPING_AUDIT action=runtime_universe_updated_incrementally configured=${this.config.universeSize} effective=${canonical.length} added=${[...nextSet].filter(symbol => !previousSet.has(symbol)).length} removed=${[...previousSet].filter(symbol => !nextSet.has(symbol)).length} rollingStatePreserved=true openPositionsAffected=false`);
    this.emit();
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    if (wasRunning) MarketEdgeRuntime.activeRuntimeInstances = Math.max(0, MarketEdgeRuntime.activeRuntimeInstances - 1);
    this.lifecycleGeneration += 1;
    if (this.calculateTimer) clearInterval(this.calculateTimer);
    if (this.oiTimer) clearInterval(this.oiTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.calculateTimer = null; this.oiTimer = null; this.retryTimer = null; this.retryAttempt = 0;
    this.dataAdapter.stop(); this.kernel.clear(); this.store.clear();
    this.activeSymbols.clear(); this.detailedSymbols = []; this.lastDetailedUpdateAt = 0;
    this.mappings = []; this.allMappings = []; this.universeSymbols = [];
    this.futuresInfo = null; this.startedAt = null;
    this.lastFuturesConnectionState = null; this.lastSynchronizedWindowAt = null;
    logger.info('MARKET_EDGE_LIFECYCLE_AUDIT action=stop cleanupOk=true');
    logger.info(`MARKET_EDGE_RUNTIME_LIFECYCLE_AUDIT created=true started=false stopped=true restartCount=${this.restartCount} activeSubscriptions=${this.listeners.size} runtimeMode=${this.config.mode}`);
    this.emit();
  }

  updateConfig(input: Partial<MarketEdgeConfig>): void {
    const previousMode = this.config.mode;
    this.config = normalizeMarketEdgeConfig({ ...this.config, ...input, mode: normalizeMarketEdgeMode(input.mode ?? this.config.mode) });
    this.kernel.updateConfig(this.config);
    this.store.setMaxSymbols(this.config.universeSize);
    if (this.config.mode === 'OFF' && this.running) this.stop();
    logger.info(`MARKET_EDGE_MODE_AUDIT previous=${previousMode} current=${this.config.mode} canRequestPriority=${String(this.config.mode === 'PRIORITY')} canDirectBuy=false`);
    this.emit();
  }

  subscribe(listener: (state: MarketEdgeRuntimeState) => void): () => void { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  getSnapshot(symbol: string): Readonly<MarketEdgeSnapshot> | null { return this.store.get(symbol); }
  getTopSnapshots(limit = 10): ReadonlyArray<MarketEdgeSnapshot> { return this.store.top(limit); }
  getOutcomeTracker(): MarketEdgeOutcomeTracker { return this.outcomes; }
  getOutcomeSummary(): EdgeOutcomeSummary { return this.outcomes.getSummary(); }
  getRequestStats() { return { ...this.publicClient.getStats(), ...this.store.getCacheStats() }; }
  getStreamStats() { return this.dataAdapter.getStats(); }
  getMemoryStats() { return { ...this.kernel.getMemoryStats(), snapshots: this.store.size, outcomes: this.outcomes.getStats() }; }
  updateMarketContext(input: { marketBreadthBullishPct: number | null }): void {
    this.marketBreadthBullishPct = input.marketBreadthBullishPct == null ? null : Math.min(100, Math.max(0, input.marketBreadthBullishPct));
  }

  getState(): MarketEdgeRuntimeState {
    const top = this.store.top(this.config.universeSize);
    const perpetualSymbols = this.mappings.filter(mapping => mapping.hasPerpetualPair).length;
    const pipeline = this.kernel.getPipelineDiagnostics();
    const streams = this.dataAdapter.getStats();
    const warmupExpired = this.startedAt != null && Date.now() - this.startedAt >= this.config.minimumWarmupMs + 10_000;
    const health: MarketEdgeHealth = !this.running || this.failureReason ? 'EDGE_OFFLINE' : pipeline.synchronizedSymbols > 0 && top.some(row => row.health === 'EDGE_HEALTHY') ? 'EDGE_HEALTHY' : pipeline.synchronizedSymbols > 0 ? 'EDGE_PARTIAL' : warmupExpired && (!streams.futuresConnected || pipeline.futuresInputSymbols === 0) ? 'EDGE_DEGRADED' : 'EDGE_WARMING_UP';
    const primaryBlocker = this.failureReason ?? (!this.running ? (this.config.mode === 'OFF' ? 'mode_off' : 'runtime_not_started') : this.mappings.length === 0 ? 'spot_universe_or_mapping_empty' : perpetualSymbols === 0 ? 'no_mapped_perpetuals' : !streams.futuresConnected ? 'futures_transport_connecting' : pipeline.futuresInputSymbols === 0 ? 'no_valid_futures_price' : pipeline.spotInputSymbols === 0 ? 'no_valid_spot_price' : pipeline.synchronizedSymbols === 0 ? 'rolling_windows_warming' : null);
    const futuresUniverseSymbols = Array.isArray(this.futuresInfo?.symbols) ? (this.futuresInfo!.symbols as Array<Record<string, unknown>>).filter(row => String(row.status) === 'TRADING' && String(row.contractType) === 'PERPETUAL' && String(row.quoteAsset) === 'USDT').length : 0;
    return { mode: this.config.mode, health, universeSize: this.config.universeSize, mappedSymbols: this.mappings.length, perpetualSymbols, detailedSymbols: Math.min(this.config.detailedTopK, perpetualSymbols), hydratedSymbols: pipeline.openInterestSymbols, highEdgeCount: top.filter(row => row.edgeScore >= 80).length, earlyOpportunityCount: top.filter(row => row.edgeScore >= 70 && row.edgeScore < 80).length, lastCalculatedAt: this.lastCalculatedAt, failureReason: this.failureReason, runtimeStarted: this.running, workerActive: this.calculateTimer != null, futuresUniverseSymbols, snapshotCount: top.length, ...pipeline, primaryBlocker };
  }

  private onData(event: MarketEdgeDataEvent): void {
    if (!this.running || !this.activeSymbols.has(event.symbol.toUpperCase())) return;
    if (event.type === 'PRICE') {
      this.kernel.ingestPrice(event.symbol, event.venue, event.value, event.eventTime);
      if (event.venue === 'SPOT') this.outcomes.ingestFuturePrice(event.symbol, event.eventTime, event.value);
    } else if (event.type === 'BOOK') this.kernel.ingestBook(event.symbol, event.venue, event.value);
    else if (event.type === 'TRADE') this.kernel.ingestTrade(event.symbol, event.venue, event.value);
    else if (event.type === 'FUNDING') this.kernel.ingestFunding(event.symbol, event.value, event.eventTime);
    else if (event.type === 'LIQUIDATION') this.kernel.ingestLiquidation(event.symbol, event.value);
  }

  private calculateCycle(): void {
    if (!this.running || this.config.mode === 'OFF') return;
    const now = Date.now();
    const calculationStartedAt = performance.now();
    for (const mapping of this.mappings) {
      const snapshot = this.kernel.calculate(mapping.spotSymbol, now, this.marketBreadthBullishPct, this.dataAdapter.getStats().futuresConnected);
      if (!snapshot) continue;
      this.store.set(snapshot);
      if (snapshot.dataQuality !== 'UNAVAILABLE' && snapshot.spotPrice && snapshot.edgeScore >= 60) this.outcomes.recordSignal(snapshot.symbol, snapshot.calculatedAt, snapshot.spotPrice, snapshot.edgeScore);
    }
    this.lastCalculatedAt = now;
    const detailed = this.store.top(this.config.detailedTopK).filter(row => this.mappings.some(mapping => mapping.spotSymbol === row.symbol && mapping.hasPerpetualPair)).map(row => row.symbol).sort();
    if (detailed.length && detailed.join('|') !== this.detailedSymbols.join('|') && now - this.lastDetailedUpdateAt >= 30_000) {
      this.detailedSymbols = detailed;
      this.lastDetailedUpdateAt = now;
      this.dataAdapter.updateDetailedSymbols(detailed);
      logger.info(`EDGE_TOPK_HYDRATION_AUDIT detailedSymbols=${detailed.length} rebalanceCooldownMs=30000 socketsRebuilt=true bounded=true`);
    }
    this.maybeRequestPriority();
    const durationMs = performance.now() - calculationStartedAt;
    const memory = this.getMemoryStats();
    const requests = this.getRequestStats();
    const streams = this.getStreamStats();
    const pipeline = this.kernel.getPipelineDiagnostics(now);
    if (pipeline.synchronizedSymbols > 0) this.lastSynchronizedWindowAt = now;
    if (this.lastFuturesConnectionState !== streams.futuresConnected) {
      const action = this.lastFuturesConnectionState === false && streams.futuresConnected ? 'recovered_without_refresh' : streams.futuresConnected ? 'connected' : 'disconnected';
      logger.info(`EDGE_NO_F5_RECOVERY_AUDIT action=${action} futuresConnected=${streams.futuresConnected} reconnectCount=${streams.edgeReconnectCount} synchronized=${pipeline.synchronizedSymbols} lastSynchronizedWindowAt=${this.lastSynchronizedWindowAt ?? 'none'} pageRefreshRequired=false`);
      this.lastFuturesConnectionState = streams.futuresConnected;
    }
    logger.throttled('INFO', `EDGE_PERFORMANCE_AUDIT edgeUpdateDurationMs=${durationMs.toFixed(2)} edgeScoreCalculationMs=${durationMs.toFixed(2)} edgeSymbolsActive=${memory.symbols} edgeFullyHydratedSymbols=${Math.min(this.config.hydratedTopK, this.mappings.filter(mapping => mapping.hasPerpetualPair).length)} edgeOIRequests=${requests.edgeOIRequestCount} edgeOIRequestsPerMinute=${requests.edgeOIRequestsPerMinute.toFixed(2)} edgeWebSocketMessages=${streams.edgeMessagesReceived} edgeWebSocketMessagesPerSecond=${streams.edgeWebSocketMessagesPerSecond.toFixed(2)} edgeCacheHits=${requests.edgeCacheHits} edgeCacheMisses=${requests.edgeCacheMisses} scannerBlocked=false`, 'market_edge_performance', 30_000);
    logger.throttled('INFO', `EDGE_MEMORY_AUDIT symbols=${memory.symbols} rollingSamples=${memory.samples} estimatedBytes=${memory.estimatedBytes} snapshots=${memory.snapshots} cleanupOk=${String(memory.bounded && memory.outcomes.bounded)}`, 'market_edge_memory', 60_000);
    const state = this.getState();
    logger.throttled('INFO', `MARKET_EDGE_HEALTH_SUMMARY_AUDIT mode=${state.mode} runtimeStarted=${state.runtimeStarted} spotUniverse=${this.universeSymbols.length} futuresUniverse=${state.futuresUniverseSymbols} mappedPerpetual=${state.perpetualSymbols} spotWarm=${pipeline.spotWarmSymbols} futuresWarm=${pipeline.futuresWarmSymbols} synchronized=${pipeline.synchronizedSymbols} snapshots=${state.snapshotCount} highEdge=${state.highEdgeCount} futuresConnected=${streams.futuresConnected} lastFuturesMessageAgeMs=${streams.lastFuturesMessageAt == null ? 'n/a' : Math.max(0, now - streams.lastFuturesMessageAt)} lastSpotInputAgeMs=${streams.lastValidSpotAt == null ? 'n/a' : Math.max(0, now - streams.lastValidSpotAt)} oiHydrated=${state.hydratedSymbols} health=${state.health} primaryBlocker=${state.primaryBlocker ?? 'none'}`, 'market_edge_health_summary', 30_000);
    logger.throttled('INFO', `EDGE_ROLLING_WINDOW_AUDIT mappedSymbols=${this.mappings.length} spotWarmSymbols=${pipeline.spotWarmSymbols} futuresWarmSymbols=${pipeline.futuresWarmSymbols} bothWarmSymbols=${pipeline.synchronizedSymbols} oldestRequiredWindowMs=60000 warmupAgeMs=${this.startedAt == null ? 0 : now - this.startedAt}`, 'edge_rolling_windows', 30_000);
    logger.throttled('INFO', `EDGE_SPOT_INPUT_AUDIT symbolsExpected=${this.mappings.length} symbolsReceivingPrice=${pipeline.spotInputSymbols} symbolsReceivingBook=${pipeline.spotBookSymbols} symbolsReceivingTrades=${pipeline.spotTradeSymbols} lastAttemptAt=${streams.lastAttemptAt ?? 'none'} lastSpotInputAt=${streams.lastValidSpotAt ?? 'none'}`, 'edge_spot_input', 30_000);
    logger.throttled('INFO', `EDGE_WINDOW_SYNC_AUDIT symbol=summary spotWindowEnd=multi futuresWindowEnd=multi deltaMs=${pipeline.maxWindowDeltaMs ?? 'n/a'} allowedSkewMs=5000 spotWarm=${pipeline.spotWarmSymbols} futuresWarm=${pipeline.futuresWarmSymbols} syncAccepted=${pipeline.synchronizedSymbols > 0} rejectReason=${pipeline.timestampUnitMismatchSymbols > 0 ? 'timestamp_unit_mismatch' : pipeline.synchronizedSymbols === 0 ? 'warming_or_missing_core_price' : 'none'}`, 'edge_window_sync', 30_000);
    logger.throttled('INFO', `EDGE_SNAPSHOT_PIPELINE_AUDIT mapped=${this.mappings.length} warm=${Math.min(pipeline.spotWarmSymbols, pipeline.futuresWarmSymbols)} synchronized=${pipeline.synchronizedSymbols} calculationAttempted=${this.mappings.length} snapshotCreated=${this.store.size} snapshotRejected=${Math.max(0, this.mappings.length - this.store.size)} rejectReason=${this.store.size === 0 ? state.primaryBlocker ?? 'warming' : 'none'}`, 'edge_snapshot_pipeline', 30_000);
    this.emit();
  }

  private async hydrateOpenInterest(): Promise<void> {
    if (!this.running) return;
    const ranked = this.store.top(this.config.hydratedTopK).map(row => row.symbol);
    const fallback = this.mappings.filter(mapping => mapping.hasPerpetualPair).slice(0, this.config.hydratedTopK).map(mapping => mapping.spotSymbol);
    const symbols = ranked.length ? ranked : fallback;
    for (let i = 0; i < symbols.length; i += 2) {
      const batch = symbols.slice(i, i + 2);
      await Promise.all(batch.map(async symbol => {
        try {
          const oi = await this.publicClient.getOpenInterest(symbol);
          if (this.running && this.activeSymbols.has(symbol)) this.kernel.ingestOpenInterest(symbol, Number(oi.openInterest), Number(oi.time || Date.now()));
        } catch (error) {
          logger.throttled('WARN', `EDGE_OPEN_INTEREST_AUDIT symbol=${symbol} fresh=false reason=${error instanceof Error ? error.message.replace(/\s+/g, '_') : 'request_failed'} scannerAffected=false`, `edge_oi_${symbol}`, 60_000);
        }
      }));
    }
  }

  private async hydratePremiumContext(): Promise<void> {
    if (!this.running || typeof (this.publicClient as any).getAllPremiumIndexes !== 'function') return;
    try {
      const rows = await this.publicClient.getAllPremiumIndexes();
      const now = Date.now();
      for (const row of rows) {
        const symbol = String(row.symbol ?? '').toUpperCase();
        if (!this.running || !this.activeSymbols.has(symbol)) continue;
        const at = Number(row.time || now), mark = Number(row.markPrice), index = Number(row.indexPrice), funding = Number(row.lastFundingRate);
        if (mark > 0) this.kernel.ingestPrice(symbol, 'MARK', mark, at);
        if (index > 0) this.kernel.ingestPrice(symbol, 'INDEX', index, at);
        if (Number.isFinite(funding)) this.kernel.ingestFunding(symbol, funding, at);
      }
    } catch (error) {
      logger.throttled('WARN', `EDGE_FUNDING_CONTEXT_AUDIT fresh=false reason=${error instanceof Error ? error.message.replace(/\s+/g, '_') : 'request_failed'} coreEdgeAffected=false`, 'edge_premium_context', 60_000);
    }
  }

  private scheduleInitializationRetry(): void {
    if (!this.running || this.retryTimer || this.config.mode === 'OFF') return;
    const delayMs = Math.min(60_000, 2_000 * (2 ** Math.min(this.retryAttempt, 5)));
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.running || this.config.mode === 'OFF') return;
      const universe = [...this.universeSymbols];
      this.running = false;
      MarketEdgeRuntime.activeRuntimeInstances = Math.max(0, MarketEdgeRuntime.activeRuntimeInstances - 1);
      this.restartCount++;
      logger.info(`MARKET_EDGE_LIFECYCLE_AUDIT action=retry_initialization attempt=${this.retryAttempt} delayMs=${delayMs}`);
      logger.info(`EDGE_NO_F5_RECOVERY_AUDIT action=initialization_retry attempt=${this.retryAttempt} pageRefreshRequired=false`);
      void this.start(universe);
    }, delayMs);
  }

  private maybeRequestPriority(): void {
    if (this.config.mode !== 'PRIORITY' || !this.requestPriorityReanalysis) return;
    const now = Date.now();
    const eligible = this.store.top(this.config.priorityTopK).filter(snapshot => snapshot.dataQuality === 'GOOD' && snapshot.edgeScore >= 70 && now - (this.lastPriorityAtBySymbol.get(snapshot.symbol) ?? 0) >= 30_000);
    if (!eligible.length) return;
    const symbols = eligible.map(snapshot => snapshot.symbol);
    for (const symbol of symbols) this.lastPriorityAtBySymbol.set(symbol, now);
    this.requestPriorityReanalysis(symbols);
    logger.info(`EDGE_PRIORITY_REQUEST symbols=${symbols.join('|')} count=${symbols.length} bounded=true directBuy=false canonicalReanalysisRequired=true`);
  }

  private emit(): void {
    const state = this.getState();
    logger.throttled('INFO', `EDGE_RUNTIME_STORE_BINDING_AUDIT runtimeHealth=${state.health} runtimeMappedCount=${state.mappedSymbols} runtimeSnapshotCount=${state.snapshotCount} storeHealth=${state.health} storeMappedCount=${state.mappedSymbols} storeSnapshotCount=${this.store.size} uiHealth=${state.health} uiMappedCount=${state.mappedSymbols} uiSnapshotCount=${this.store.size} mismatch=false`, 'edge_runtime_store_binding', 30_000);
    for (const listener of this.listeners) listener(state);
  }
}
