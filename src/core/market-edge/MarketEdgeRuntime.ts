import { logger } from '../../utils/logger';
import { MarketEdgeDataAdapter, type MarketEdgeDataEvent } from './MarketEdgeDataAdapter';
import { MarketEdgeKernel } from './MarketEdgeKernel';
import { MarketEdgeOutcomeTracker, type EdgeOutcomeSummary } from './MarketEdgeOutcomeTracker';
import { MarketEdgePublicClient } from './MarketEdgePublicClient';
import { MarketEdgeSnapshotStore } from './MarketEdgeSnapshotStore';
import { buildMarketEdgeSymbolMappings, type MarketEdgeSymbolMapping } from './MarketEdgeSymbolMapper';
import { normalizeMarketEdgeConfig, type MarketEdgeConfig } from './config';
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
}

export class MarketEdgeRuntime {
  private config: MarketEdgeConfig;
  private readonly kernel: MarketEdgeKernel;
  private readonly store: MarketEdgeSnapshotStore;
  private readonly outcomes = new MarketEdgeOutcomeTracker();
  private readonly listeners = new Set<(state: MarketEdgeRuntimeState) => void>();
  private readonly publicClient: MarketEdgePublicClient;
  private readonly dataAdapter: MarketEdgeDataAdapter;
  private mappings: MarketEdgeSymbolMapping[] = [];
  private allMappings: MarketEdgeSymbolMapping[] = [];
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

  constructor(config: Partial<MarketEdgeConfig> = {}, private readonly requestPriorityReanalysis?: (symbols: string[]) => void, dependencies?: { publicClient?: MarketEdgePublicClient; dataAdapter?: MarketEdgeDataAdapter }) {
    this.config = normalizeMarketEdgeConfig(config);
    this.kernel = new MarketEdgeKernel(this.config);
    this.store = new MarketEdgeSnapshotStore(this.config.universeSize);
    this.publicClient = dependencies?.publicClient ?? new MarketEdgePublicClient();
    this.dataAdapter = dependencies?.dataAdapter ?? new MarketEdgeDataAdapter(event => this.onData(event));
  }

  async start(spotUniverseSymbols: string[]): Promise<void> {
    if (this.running || this.config.mode === 'OFF') return;
    this.running = true;
    const generation = ++this.lifecycleGeneration;
    this.failureReason = null;
    this.universeSymbols = [...new Set(spotUniverseSymbols.map(s => s.toUpperCase()))].slice(0, this.config.universeSize);
    try {
      const [spotInfo, futuresInfo] = await Promise.all([this.publicClient.getSpotExchangeInfo(), this.publicClient.getFuturesExchangeInfo()]);
      if (!this.running || generation !== this.lifecycleGeneration) return;
      this.allMappings = buildMarketEdgeSymbolMappings(spotInfo, futuresInfo).filter(mapping => mapping.spotTradingActive);
      const requestedSymbols = new Set(this.universeSymbols);
      this.mappings = this.allMappings.filter(mapping => requestedSymbols.has(mapping.spotSymbol));
      this.activeSymbols = new Set(this.mappings.map(mapping => mapping.spotSymbol));
      const initialDetailed = this.mappings.filter(mapping => mapping.hasPerpetualPair).slice(0, this.config.detailedTopK).map(mapping => mapping.spotSymbol);
      this.detailedSymbols = [...initialDetailed].sort();
      this.lastDetailedUpdateAt = Date.now();
      this.dataAdapter.start(initialDetailed);
      this.retryAttempt = 0;
      this.calculateTimer = setInterval(() => this.calculateCycle(), 1_000);
      this.oiTimer = setInterval(() => { void this.hydrateOpenInterest(); }, 60_000);
      void this.hydrateOpenInterest();
      logger.info(`MARKET_EDGE_LIFECYCLE_AUDIT action=start mode=${this.config.mode} universeSize=${this.universeSymbols.length} mappedSymbols=${this.mappings.length} perpetualSymbols=${this.mappings.filter(m => m.hasPerpetualPair).length} directBuyPath=false futuresOrders=false`);
    } catch (error) {
      if (!this.running || generation !== this.lifecycleGeneration) return;
      this.failureReason = error instanceof Error ? error.message : String(error);
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
    if (this.allMappings.length === 0) { this.stop(); await this.start(canonical); return; }
    this.universeSymbols = canonical;
    this.mappings = this.allMappings.filter(mapping => nextSet.has(mapping.spotSymbol));
    this.activeSymbols = new Set(this.mappings.map(mapping => mapping.spotSymbol));
    this.kernel.retainSymbols(this.activeSymbols);
    this.store.retainSymbols(this.activeSymbols);
    logger.info(`MARKET_EDGE_SYMBOL_MAPPING_AUDIT action=runtime_universe_updated_incrementally configured=${this.config.universeSize} effective=${canonical.length} added=${[...nextSet].filter(symbol => !previousSet.has(symbol)).length} removed=${[...previousSet].filter(symbol => !nextSet.has(symbol)).length} rollingStatePreserved=true openPositionsAffected=false`);
    this.emit();
  }

  stop(): void {
    this.running = false;
    this.lifecycleGeneration += 1;
    if (this.calculateTimer) clearInterval(this.calculateTimer);
    if (this.oiTimer) clearInterval(this.oiTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.calculateTimer = null; this.oiTimer = null; this.retryTimer = null; this.retryAttempt = 0;
    this.dataAdapter.stop(); this.kernel.clear(); this.store.clear();
    this.activeSymbols.clear(); this.detailedSymbols = []; this.lastDetailedUpdateAt = 0;
    this.mappings = []; this.allMappings = []; this.universeSymbols = [];
    logger.info('MARKET_EDGE_LIFECYCLE_AUDIT action=stop cleanupOk=true');
    this.emit();
  }

  updateConfig(input: Partial<MarketEdgeConfig>): void {
    const previousMode = this.config.mode;
    this.config = normalizeMarketEdgeConfig({ ...this.config, ...input });
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
    const health = !this.running || this.failureReason ? 'EDGE_OFFLINE' : top.length === 0 ? 'EDGE_WARMING_UP' : top.some(row => row.health === 'EDGE_HEALTHY') ? 'EDGE_HEALTHY' : top.some(row => row.health === 'EDGE_PARTIAL') ? 'EDGE_PARTIAL' : 'EDGE_WARMING_UP';
    return { mode: this.config.mode, health, universeSize: this.config.universeSize, mappedSymbols: this.mappings.length, perpetualSymbols, detailedSymbols: Math.min(this.config.detailedTopK, perpetualSymbols), hydratedSymbols: Math.min(this.config.hydratedTopK, perpetualSymbols), highEdgeCount: top.filter(row => row.edgeScore >= 80).length, earlyOpportunityCount: top.filter(row => row.edgeScore >= 70 && row.edgeScore < 80).length, lastCalculatedAt: this.lastCalculatedAt, failureReason: this.failureReason };
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
      const snapshot = this.kernel.calculate(mapping.spotSymbol, now, this.marketBreadthBullishPct);
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
    logger.throttled('INFO', `EDGE_PERFORMANCE_AUDIT edgeUpdateDurationMs=${durationMs.toFixed(2)} edgeScoreCalculationMs=${durationMs.toFixed(2)} edgeSymbolsActive=${memory.symbols} edgeFullyHydratedSymbols=${Math.min(this.config.hydratedTopK, this.mappings.filter(mapping => mapping.hasPerpetualPair).length)} edgeOIRequests=${requests.edgeOIRequestCount} edgeOIRequestsPerMinute=${requests.edgeOIRequestsPerMinute.toFixed(2)} edgeWebSocketMessages=${streams.edgeMessagesReceived} edgeWebSocketMessagesPerSecond=${streams.edgeWebSocketMessagesPerSecond.toFixed(2)} edgeCacheHits=${requests.edgeCacheHits} edgeCacheMisses=${requests.edgeCacheMisses} scannerBlocked=false`, 'market_edge_performance', 30_000);
    logger.throttled('INFO', `EDGE_MEMORY_AUDIT symbols=${memory.symbols} rollingSamples=${memory.samples} estimatedBytes=${memory.estimatedBytes} snapshots=${memory.snapshots} cleanupOk=${String(memory.bounded && memory.outcomes.bounded)}`, 'market_edge_memory', 60_000);
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

  private scheduleInitializationRetry(): void {
    if (!this.running || this.retryTimer || this.config.mode === 'OFF') return;
    const delayMs = Math.min(60_000, 2_000 * (2 ** Math.min(this.retryAttempt, 5)));
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.running || this.config.mode === 'OFF') return;
      const universe = [...this.universeSymbols];
      this.running = false;
      logger.info(`MARKET_EDGE_LIFECYCLE_AUDIT action=retry_initialization attempt=${this.retryAttempt} delayMs=${delayMs}`);
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

  private emit(): void { const state = this.getState(); for (const listener of this.listeners) listener(state); }
}
