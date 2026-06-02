import type { TradeRecord, MLPrediction } from '../types';
import { createMLLabel } from '../ml/ml-labeler';
import { buildMLFeatures } from '../ml/ml-feature-builder';
import { evaluateTradeMLQuality } from '../ml/ml-data-quality';
import { tauriDb, InMemoryStore, detectRuntime, checkDatabaseHealth, logFallbackOnce } from './TauriBridge';
import type { DbStatus } from './TauriBridge';
import { logger } from '../../utils/logger';

export class Journal {
  private trades: TradeRecord[] = [];
  private predictions: MLPrediction[] = [];
  private maxMemoryEntries = 1000;
  private persistStore: InMemoryStore;
  private useTauri = false;
  private tauriReady = false;
  private lastSaveTime: string | null = null;
  private lastLoadTime: string | null = null;
  private saveError: string | null = null;
  private persistenceStatus: DbStatus = 'CHECKING';
  private startupDone = false;
  private openPosKey = 'cryptobud_v4:open_positions_primary';
  private openPosBackupKey = 'cryptobud_v4:open_positions_critical';
  private openPositionsHydrated = false;
  private closedTradesKey = 'cryptobud_v4:closed_trades_primary';
  private closedTradesBackupKey = 'cryptobud_v4:closed_trades_critical';
  private closedTradesHydrated = false;
  private readonly resetMarkerKey = 'cryptobud_v4:reset_meta_v1';

  private readResetMarker(): { resetScope: string; resetAt: string; resetVersion: number } | null {
    try {
      const raw = localStorage.getItem(this.resetMarkerKey);
      if (!raw) return null;
      return JSON.parse(raw) as { resetScope: string; resetAt: string; resetVersion: number };
    } catch {
      return null;
    }
  }

  private clearResetMarker(): void {
    try { localStorage.removeItem(this.resetMarkerKey); } catch { /* ignore */ }
  }

  private async consumeResetMarkerIfPresent(): Promise<void> {
    const marker = this.readResetMarker();
    if (!marker) return;
    logger.info(`RESET_MARKER_CONSUMED: resetScope=${marker.resetScope} resetAt=${marker.resetAt} resetVersion=${marker.resetVersion}`);
    if (marker.resetScope === 'reset_trading' || marker.resetScope === 'full_demo_reset') {
      this.writeOpenPosFallback([]);
      this.writeClosedTradesFallback([]);
      logger.info(`STALE_BACKUP_IGNORED_AFTER_RESET: storageKeys=${this.openPosBackupKey}|${this.closedTradesBackupKey} resetAt=${marker.resetAt}`);
      if (this.useTauri && this.tauriReady) {
        try { await tauriDb.clearOpenPositions(); } catch { /* ignore */ }
        try { await tauriDb.clearTrades(); } catch { /* ignore */ }
      }
    } else {
      logger.info(`RESET_META_IGNORED_FOR_NEWER_DATA: resetScope=${marker.resetScope} reason=non_trading_scope`);
    }
    this.clearResetMarker();
  }

  private readOpenPosFallback(): Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }> {
    try {
      const primary = localStorage.getItem(this.openPosKey);
      const backup = localStorage.getItem(this.openPosBackupKey);
      const parsedPrimary = primary ? JSON.parse(primary) : [];
      const parsedBackup = backup ? JSON.parse(backup) : [];
      logger.info(`POSITION_PERSISTENCE_STORAGE_${Array.isArray(parsedPrimary) && parsedPrimary.length > 0 ? 'FOUND' : 'EMPTY'}: mode=demo storageKey=${this.openPosKey} persistedOpenCount=${Array.isArray(parsedPrimary) ? parsedPrimary.length : 0} backupOpenCount=${Array.isArray(parsedBackup) ? parsedBackup.length : 0} hydrationComplete=${String(this.openPositionsHydrated)} reason=fallback_read_primary`);
      logger.info(`POSITION_PERSISTENCE_BACKUP_${Array.isArray(parsedBackup) && parsedBackup.length > 0 ? 'FOUND' : 'EMPTY'}: mode=demo backupKey=${this.openPosBackupKey} persistedOpenCount=${Array.isArray(parsedPrimary) ? parsedPrimary.length : 0} backupOpenCount=${Array.isArray(parsedBackup) ? parsedBackup.length : 0} hydrationComplete=${String(this.openPositionsHydrated)} reason=fallback_read_backup`);
      if (Array.isArray(parsedPrimary) && parsedPrimary.length > 0) return parsedPrimary;
      if (Array.isArray(parsedBackup) && parsedBackup.length > 0) {
        logger.info(`OPEN_POSITIONS_RESTORED_FROM_CRITICAL_BACKUP: mode=demo storageKey=${this.openPosKey} backupKey=${this.openPosBackupKey} persistedOpenCount=${Array.isArray(parsedPrimary) ? parsedPrimary.length : 0} backupOpenCount=${parsedBackup.length} positionManagerOpenCount=0 uiOpenRowsCount=0 restoredSymbols=${parsedBackup.map(p => p.symbol).join('|') || 'none'} resetMetaDetected=false resetApplied=false hydrationComplete=${String(this.openPositionsHydrated)} reason=primary_empty_backup_available`);
        return parsedBackup;
      }
    } catch (err) {
      logger.warn(`OPEN_POSITIONS_RESTORE_FAILED: source=fallback error=${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }

  private writeOpenPosFallback(rows: Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }>): void {
    try {
      localStorage.setItem(this.openPosKey, JSON.stringify(rows));
      localStorage.setItem(this.openPosBackupKey, JSON.stringify(rows));
    } catch { /* ignore */ }
  }

  private readClosedTradesFallback(): TradeRecord[] {
    try {
      const primary = localStorage.getItem(this.closedTradesKey);
      const backup = localStorage.getItem(this.closedTradesBackupKey);
      const parsedPrimary = primary ? JSON.parse(primary) as TradeRecord[] : [];
      const parsedBackup = backup ? JSON.parse(backup) as TradeRecord[] : [];
      logger.info(`CLOSED_TRADES_STORAGE_${parsedPrimary.length > 0 ? 'FOUND' : 'EMPTY'}: storageKey=${this.closedTradesKey} persistedClosedCount=${parsedPrimary.length} backupClosedCount=${parsedBackup.length} hydrationComplete=${String(this.closedTradesHydrated)} reason=fallback_read_primary`);
      logger.info(`CLOSED_TRADES_BACKUP_${parsedBackup.length > 0 ? 'FOUND' : 'EMPTY'}: backupKey=${this.closedTradesBackupKey} persistedClosedCount=${parsedPrimary.length} backupClosedCount=${parsedBackup.length} hydrationComplete=${String(this.closedTradesHydrated)} reason=fallback_read_backup`);
      if (parsedPrimary.length > 0) return parsedPrimary;
      if (parsedBackup.length > 0) {
        logger.info(`CLOSED_TRADES_RESTORED_FROM_CRITICAL_BACKUP: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} persistedClosedCount=${parsedPrimary.length} backupClosedCount=${parsedBackup.length} restoredClosedCount=${parsedBackup.length} hydrationComplete=${String(this.closedTradesHydrated)} reason=primary_empty_backup_available`);
        return parsedBackup;
      }
    } catch (err) {
      logger.warn(`CLOSED_TRADES_RESTORE_FAILED: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} error=${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }

  private writeClosedTradesFallback(rows: TradeRecord[]): void {
    try {
      localStorage.setItem(this.closedTradesKey, JSON.stringify(rows));
      localStorage.setItem(this.closedTradesBackupKey, JSON.stringify(rows));
    } catch { /* ignore */ }
  }

  private syncClosedTradesFallbackFromMemory(): void {
    if (!this.closedTradesHydrated) {
      logger.warn(`CLOSED_TRADES_WRITE_BLOCKED_BEFORE_HYDRATION: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} persistedClosedCount=unknown backupClosedCount=unknown restoredClosedCount=${this.getClosedTrades().length} hydrationComplete=false reason=boot_not_hydrated`);
      return;
    }
    this.writeClosedTradesFallback(this.getClosedTrades());
  }

  constructor() {
    this.persistStore = new InMemoryStore();
  }

  getPersistenceStatus(): DbStatus {
    return this.persistenceStatus;
  }

  getDbInfo() {
    return {
      status: this.persistenceStatus,
      tradeCount: this.trades.length,
      openPositionCount: this.trades.filter(t => t.status === 'open').length,
      lastSaveTime: this.lastSaveTime,
      lastLoadTime: this.lastLoadTime,
      saveError: this.saveError,
      useTauri: this.tauriReady && this.useTauri,
    };
  }

  async loadTrades(): Promise<void> {
    if (this.startupDone) return;
    this.startupDone = true;

    logger.info('PERSISTENCE_START');
    logger.info(`CLOSED_TRADES_PERSISTENCE_BOOT_START: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} persistedClosedCount=0 backupClosedCount=0 restoredClosedCount=0 hydrationComplete=${String(this.closedTradesHydrated)} reason=startup`);

    // Phase 1: detect runtime with retries (500ms, 1500ms)
    logger.info('DB_HEALTH_CHECK_RETRY: attempt 1');
    const hasTauri = await detectRuntime();

    if (!hasTauri) {
      this.useTauri = false;
      this.tauriReady = true;
      this.persistenceStatus = 'FALLBACK';
      logger.info('DB_HEALTH_CHECK_FINAL: FALLBACK — no Tauri runtime detected');
      logFallbackOnce((m) => logger.info(m));
      await this.consumeResetMarkerIfPresent();
      this.trades = this.readClosedTradesFallback();
      this.closedTradesHydrated = true;
      return;
    }

    // Phase 2: health check — invoke actually works
    const dbHealthy = await checkDatabaseHealth();

    if (!dbHealthy) {
      this.useTauri = false;
      this.tauriReady = true;
      this.persistenceStatus = 'ERROR';
      this.saveError = 'Database health check failed';
      logger.warn('PERSISTENCE_DB_ERROR_TAURI_INVOKE_FAILED: Tauri detected but invoke failed');
      this.trades = this.readClosedTradesFallback();
      this.closedTradesHydrated = true;
      return;
    }

    // Phase 3: Tauri + DB working
    this.useTauri = true;
    this.tauriReady = true;
    this.persistenceStatus = 'OK';
    logger.info('PERSISTENCE_DB_OK');
    await this.consumeResetMarkerIfPresent();

    try {
      const loaded = await tauriDb.getTrades();
      this.trades = loaded;
      const loadedClosed = loaded.filter(t => t.status === 'closed');
      if (loadedClosed.length > 0) {
        this.writeClosedTradesFallback(loadedClosed);
        logger.info(`CLOSED_TRADES_RESTORED: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} restoredClosedCount=${loadedClosed.length} hydrationComplete=false reason=tauri_load_trades`);
      }
      else {
        const fallbackClosed = this.readClosedTradesFallback();
        if (fallbackClosed.length > 0) {
          const byId = new Map<string, TradeRecord>();
          for (const t of loaded) byId.set(t.tradeId, t);
          for (const t of fallbackClosed) byId.set(t.tradeId, t);
          this.trades = Array.from(byId.values());
          logger.warn(`CLOSED_TRADES_PERSISTENCE_MISMATCH: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} persistedClosedCount=0 backupClosedCount=${fallbackClosed.length} restoredClosedCount=${fallbackClosed.length} hydrationComplete=false reason=tauri_empty_fallback_nonempty`);
        }
      }
      this.lastLoadTime = new Date().toISOString();
      logger.info(`PERSISTENCE_LOAD_TRADES_SUCCESS: loaded ${this.trades.length} trades`);
      this.closedTradesHydrated = true;
      logger.info(`CLOSED_TRADES_HYDRATED: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} restoredClosedCount=${this.getClosedTrades().length} hydrationComplete=true reason=boot_complete`);
    } catch (err) {
      this.persistenceStatus = 'ERROR';
      this.saveError = err instanceof Error ? err.message : String(err);
      logger.warn(`PERSISTENCE_LOAD_TRADES_FAILED: ${this.saveError}`);
      this.trades = this.readClosedTradesFallback();
      this.closedTradesHydrated = true;
      logger.info(`CLOSED_TRADES_HYDRATED: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} restoredClosedCount=${this.getClosedTrades().length} hydrationComplete=true reason=load_failed_fallback_used`);
    }
  }

  private async persistTrade(trade: TradeRecord): Promise<void> {
    if (this.startupDone && this.useTauri) {
      try {
        await tauriDb.saveTrade(trade);
        this.lastSaveTime = new Date().toISOString();
        this.saveError = null;
        logger.info(`PERSISTENCE_SAVE_TRADE_SUCCESS: ${trade.tradeId}`);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.saveError = message;
        logger.warn(`PERSISTENCE_SAVE_TRADE_FAILED: ${trade.tradeId} - ${message}`);
        if (message.includes('Tauri runtime not available')) {
          this.useTauri = false;
        }
      }
    }
    await this.persistStore.saveTrade(trade);
    this.lastSaveTime = new Date().toISOString();
    if (trade.status === 'closed') this.syncClosedTradesFallbackFromMemory();
  }

  private async persistUpdate(trade: TradeRecord): Promise<void> {
    if (this.startupDone && this.useTauri) {
      try {
        await tauriDb.updateTrade(trade);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`PERSISTENCE_UPDATE_TRADE_FAILED: ${trade.tradeId} - ${message}`);
        if (message.includes('Tauri runtime not available')) {
          this.useTauri = false;
        }
      }
    }
    this.persistStore.updateTrade(trade);
    if (trade.status === 'closed') this.syncClosedTradesFallbackFromMemory();
  }

  async recordTrade(trade: TradeRecord): Promise<void> {
    const existing = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    if (existing >= 0) {
      this.trades[existing] = trade;
    } else {
      this.trades.push(trade);
    }
    if (this.trades.length > this.maxMemoryEntries) this.trades.shift();

    await this.persistTrade(trade);
    if (trade.status === 'closed') this.syncClosedTradesFallbackFromMemory();
  }

  async updateTrade(trade: TradeRecord): Promise<void> {
    const idx = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    if (idx >= 0) this.trades[idx] = trade;
    else this.trades.push(trade);

    await this.persistUpdate(trade);
    if (trade.status === 'closed') this.syncClosedTradesFallbackFromMemory();
  }

  async recordPrediction(pred: MLPrediction): Promise<void> {
    this.predictions.push(pred);
    if (this.predictions.length > this.maxMemoryEntries) this.predictions.shift();
  }

  getTrades(coin?: string): TradeRecord[] {
    return coin ? this.trades.filter(t => t.coin === coin) : [...this.trades];
  }

  getClosedTrades(coin?: string): TradeRecord[] {
    const closed = this.trades.filter(t => t.status === 'closed');
    return coin ? closed.filter(t => t.coin === coin) : closed;
  }

  getOpenTrades(coin?: string): TradeRecord[] {
    const open = this.trades.filter(t => t.status === 'open');
    return coin ? open.filter(t => t.coin === coin) : open;
  }

  getPredictions(coin?: string): MLPrediction[] {
    return coin ? this.predictions.filter(p => p.coin === coin) : [...this.predictions];
  }

  clear(): void {
    this.trades = [];
    this.predictions = [];
  }

  getPersistenceKeys(): {
    openPrimary: string;
    openBackup: string;
    closedPrimary: string;
    closedBackup: string;
  } {
    return {
      openPrimary: this.openPosKey,
      openBackup: this.openPosBackupKey,
      closedPrimary: this.closedTradesKey,
      closedBackup: this.closedTradesBackupKey,
    };
  }

  async clearTradingPersistence(): Promise<void> {
    logger.info('CLOSED_TRADES_RESET_START');
    this.trades = [];
    this.predictions = [];
    this.writeOpenPosFallback([]);
    this.writeClosedTradesFallback([]);
    logger.info('CLOSED_TRADES_RESET_STORAGE_CLEARED');
    logger.info('CLOSED_TRADES_RESET_BACKUP_CLEARED');
    if (this.useTauri && this.tauriReady) {
      try {
        await tauriDb.clearOpenPositions();
      } catch (err) {
        logger.warn(`RESET_CLEAR_OPEN_POSITIONS_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        await tauriDb.clearTrades();
      } catch (err) {
        logger.warn(`RESET_CLEAR_TRADES_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.persistStore.clear();
    logger.info('CLOSED_TRADES_RESET_RUNTIME_CLEARED');
    logger.info('CLOSED_TRADES_RESET_COMPLETE');
  }

  async getPersistenceCounts(): Promise<{
    openPrimaryCount: number;
    openBackupCount: number;
    closedPrimaryCount: number;
    closedBackupCount: number;
    tauriOpenCount: number;
    tauriTradeCount: number;
  }> {
    let openPrimaryCount = 0;
    let openBackupCount = 0;
    let closedPrimaryCount = 0;
    let closedBackupCount = 0;
    try {
      const o1 = localStorage.getItem(this.openPosKey);
      const o2 = localStorage.getItem(this.openPosBackupKey);
      const c1 = localStorage.getItem(this.closedTradesKey);
      const c2 = localStorage.getItem(this.closedTradesBackupKey);
      openPrimaryCount = Array.isArray(o1 ? JSON.parse(o1) : []) ? (o1 ? JSON.parse(o1).length : 0) : 0;
      openBackupCount = Array.isArray(o2 ? JSON.parse(o2) : []) ? (o2 ? JSON.parse(o2).length : 0) : 0;
      closedPrimaryCount = Array.isArray(c1 ? JSON.parse(c1) : []) ? (c1 ? JSON.parse(c1).length : 0) : 0;
      closedBackupCount = Array.isArray(c2 ? JSON.parse(c2) : []) ? (c2 ? JSON.parse(c2).length : 0) : 0;
    } catch { /* ignore */ }
    let tauriOpenCount = 0;
    let tauriTradeCount = 0;
    if (this.useTauri && this.tauriReady) {
      try { tauriOpenCount = await tauriDb.getOpenPositionCount(); } catch { /* ignore */ }
      try { tauriTradeCount = await tauriDb.getTradeCount(); } catch { /* ignore */ }
    }
    return { openPrimaryCount, openBackupCount, closedPrimaryCount, closedBackupCount, tauriOpenCount, tauriTradeCount };
  }

  async saveOpenPosition(tradeId: string, symbol: string, positionJson: string, buySnapshotJson?: string): Promise<void> {
    if (!this.openPositionsHydrated) {
      logger.warn(`POSITION_PERSISTENCE_WRITE_BLOCKED_BEFORE_HYDRATION: mode=demo storageKey=${this.openPosKey} backupKey=${this.openPosBackupKey} attemptedWrite=open_position_save symbol=${symbol} hydrationComplete=false reason=boot_not_hydrated`);
      return;
    }
    const existing = await this.loadOpenPositions();
    const next = [...existing.filter(p => p.trade_id !== tradeId), { trade_id: tradeId, symbol, position_json: positionJson, buy_snapshot_json: buySnapshotJson ?? null }];
    this.writeOpenPosFallback(next);
    if (!this.useTauri || !this.tauriReady) return;
    try {
      await tauriDb.saveOpenPosition(tradeId, symbol, positionJson, buySnapshotJson);
    } catch (err) {
      logger.warn(`PERSISTENCE_SAVE_OPEN_POSITION_FAILED: ${symbol} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async deleteOpenPosition(tradeId: string): Promise<void> {
    if (!this.openPositionsHydrated) {
      logger.warn(`POSITION_PERSISTENCE_WRITE_BLOCKED_BEFORE_HYDRATION: mode=demo storageKey=${this.openPosKey} backupKey=${this.openPosBackupKey} attemptedWrite=open_position_delete tradeId=${tradeId} hydrationComplete=false reason=boot_not_hydrated`);
      return;
    }
    const existing = await this.loadOpenPositions();
    this.writeOpenPosFallback(existing.filter(p => p.trade_id !== tradeId));
    if (!this.useTauri || !this.tauriReady) return;
    try {
      await tauriDb.deleteOpenPosition(tradeId);
    } catch (err) {
      logger.warn(`PERSISTENCE_DELETE_OPEN_POSITION_FAILED: ${tradeId} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async loadOpenPositions(): Promise<Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }>> {
    if (!this.useTauri || !this.tauriReady) return this.readOpenPosFallback();
    try {
      const rows = await tauriDb.getOpenPositions();
      if (rows.length === 0) {
        const fallback = this.readOpenPosFallback();
        if (fallback.length > 0) {
          logger.warn(`POSITION_PERSISTENCE_MISMATCH: mode=demo storageKey=${this.openPosKey} backupKey=${this.openPosBackupKey} persistedOpenCount=0 backupOpenCount=${fallback.length} hydrationComplete=${String(this.openPositionsHydrated)} reason=primary_empty_backup_nonempty`);
        }
        return fallback;
      }
      this.writeOpenPosFallback(rows);
      return rows;
    } catch (err) {
      logger.warn(`PERSISTENCE_LOAD_OPEN_POSITIONS_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return this.readOpenPosFallback();
    }
  }

  markOpenPositionsHydrated(): void {
    this.openPositionsHydrated = true;
  }

  isClosedTradesHydrated(): boolean {
    return this.closedTradesHydrated;
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      trades: this.trades.map(t => ({
        entryRiskSnapshot: (t.buySnapshot as any)?.entryConfigSnapshot?.riskParams
          ?? (t.buySnapshot as any)?.settingsSnapshot?.entryConfigSnapshot?.riskParams
          ?? null,
        tradeId: t.tradeId,
        coin: t.coin, mode: t.mode, side: t.side,
        adapter: t.adapter,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        quantity: t.quantity, pnl: t.pnl, pnlPercent: t.pnlPercent,
        entryTime: t.entryTime, exitTime: t.exitTime,
        status: t.status,
        strategy: t.strategy,
        mlConfidence: t.mlConfidence,
        prediction: t.prediction,
        dataQuality: t.mlQuality?.dataQuality,
        mlUse: t.mlQuality?.mlUse,
        trainingEligible: t.trainingEligible,
      })),
      summary: this.computeSummary(),
      mlSummary: this.computeMLSummary(),
    }, null, 2);
  }

  async exportMLData(): Promise<string> {
    const rows: ReturnType<typeof buildMLFeatures>[] = [];
    for (const t of this.trades) {
      if (t.closeSnapshot) {
        const withLabel = { ...t, mlLabel: t.mlLabel ?? createMLLabel(t) };
        const withQuality = { ...withLabel, mlQuality: t.mlQuality ?? evaluateTradeMLQuality(withLabel) };
        rows.push(buildMLFeatures(withQuality));
      }
    }

    const counts = this.computeMLCounts();

    return JSON.stringify({
      schemaVersion: 'cryptobud-v4-ml-dataset-v1',
      exportedAt: new Date().toISOString(),
      counts,
      rows,
    }, null, 2);
  }

  async exportTrainingRows(): Promise<string> {
    const rows: ReturnType<typeof buildMLFeatures>[] = [];
    for (const t of this.trades) {
      if (t.closeSnapshot && t.mlQuality?.trainingEligible) {
        rows.push(buildMLFeatures(t));
      }
    }
    return JSON.stringify({ schemaVersion: 'cryptobud-v4-ml-dataset-v1', exportedAt: new Date().toISOString(), rows }, null, 2);
  }

  async exportAdvisoryRows(): Promise<string> {
    const rows: ReturnType<typeof buildMLFeatures>[] = [];
    for (const t of this.trades) {
      if (t.closeSnapshot && t.mlQuality?.mlUse === 'advisory_only') {
        rows.push(buildMLFeatures(t));
      }
    }
    return JSON.stringify({ schemaVersion: 'cryptobud-v4-ml-dataset-v1', exportedAt: new Date().toISOString(), rows }, null, 2);
  }

  async exportExcludedRows(): Promise<string> {
    const rows: ReturnType<typeof buildMLFeatures>[] = [];
    for (const t of this.trades) {
      if (t.closeSnapshot && t.mlQuality?.mlUse === 'excluded') {
        rows.push(buildMLFeatures(t));
      }
    }
    return JSON.stringify({ schemaVersion: 'cryptobud-v4-ml-dataset-v1', exportedAt: new Date().toISOString(), rows }, null, 2);
  }

  computeSummary(): Record<string, unknown> {
    const closed = this.getClosedTrades();
    const wins = closed.filter(t => (t.pnl || 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);

    return {
      totalTrades: closed.length,
      wins: wins.length,
      losses: closed.length - wins.length,
      winRate: closed.length > 0 ? Math.round(wins.length / closed.length * 10000) / 100 : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgPnl: closed.length > 0 ? Math.round(totalPnl / closed.length * 100) / 100 : 0,
    };
  }

  computeMLSummary(): Record<string, unknown> {
    const closed = this.getClosedTrades();
    const good = closed.filter(t => t.mlQuality?.dataQuality === 'GOOD');
    const medium = closed.filter(t => t.mlQuality?.dataQuality === 'MEDIUM');
    const bad = closed.filter(t => t.mlQuality?.dataQuality === 'BAD');
    const training = closed.filter(t => t.mlQuality?.trainingEligible);
    const advisory = closed.filter(t => t.mlQuality?.mlUse === 'advisory_only');
    const excluded = closed.filter(t => t.mlQuality?.mlUse === 'excluded');

    return {
      totalClosed: closed.length,
      good: good.length,
      medium: medium.length,
      bad: bad.length,
      trainingEligible: training.length,
      advisoryOnly: advisory.length,
      excluded: excluded.length,
    };
  }

  computeMLCounts(): Record<string, number> {
    const closed = this.getClosedTrades();
    return {
      totalTrades: closed.length,
      trainingEligible: closed.filter(t => t.mlQuality?.trainingEligible).length,
      advisoryOnly: closed.filter(t => t.mlQuality?.mlUse === 'advisory_only').length,
      excluded: closed.filter(t => t.mlQuality?.mlUse === 'excluded').length,
      good: closed.filter(t => t.mlQuality?.dataQuality === 'GOOD').length,
      medium: closed.filter(t => t.mlQuality?.dataQuality === 'MEDIUM').length,
      bad: closed.filter(t => t.mlQuality?.dataQuality === 'BAD').length,
    };
  }
}
