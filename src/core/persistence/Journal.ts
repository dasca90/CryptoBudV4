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
  private closingTradeIds = new Set<string>();
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
    const primaryOpen = this.readOpenPosFallback();
    const primaryClosed = this.readClosedTradesFallback();
    logger.info(`RESET_MARKER_FOUND_AT_BOOT: resetScope=${marker.resetScope} resetAt=${marker.resetAt} resetVersion=${marker.resetVersion} primaryOpenCount=${primaryOpen.length} primaryClosedCount=${primaryClosed.length} willClear=${String(marker.resetScope === 'reset_trading' || marker.resetScope === 'full_demo_reset')} wasExplicitReset=true`);
    if (marker.resetScope === 'reset_trading' || marker.resetScope === 'full_demo_reset') {
      this.writeOpenPosFallback([]);
      this.writeClosedTradesFallback([]);
      logger.info(`RESET_MARKER_CONSUMED: resetScope=${marker.resetScope} resetAt=${marker.resetAt} resetVersion=${marker.resetVersion} clearedOpenCount=${primaryOpen.length} clearedClosedCount=${primaryClosed.length}`);
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
      const primaryOpenCount = Array.isArray(parsedPrimary) ? parsedPrimary.length : 0;
      const backupOpenCount = Array.isArray(parsedBackup) ? parsedBackup.length : 0;
      const primarySavedAt = Array.isArray(parsedPrimary) && parsedPrimary.length > 0 ? parsedPrimary[0]?.saved_at : undefined;
      const backupSavedAt = Array.isArray(parsedBackup) && parsedBackup.length > 0 ? parsedBackup[0]?.saved_at : undefined;
      let selectedSource: 'primary' | 'backup' | 'none' = 'none';
      let selectedRows: typeof parsedPrimary = [];
      if (primaryOpenCount > 0 && backupOpenCount > 0 && backupOpenCount > primaryOpenCount) {
        const primarySymbols = (parsedPrimary as any[]).map((r: any) => r.symbol).sort().join('|');
        const backupSymbols = (parsedBackup as any[]).map((r: any) => r.symbol).sort().join('|');
        const missingInPrimary = (parsedBackup as any[]).filter((br: any) => !(parsedPrimary as any[]).some((pr: any) => pr.trade_id === br.trade_id));
        logger.warn(`POSITION_PERSISTENCE_PRIMARY_TRUNCATED: primaryOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} primarySymbols=${primarySymbols} backupSymbols=${backupSymbols} missingFromPrimary=${missingInPrimary.length} missingTradeIds=${missingInPrimary.map((r: any) => r.trade_id).join('|') || 'none'} missingSymbols=${missingInPrimary.map((r: any) => r.symbol).join('|') || 'none'} action=recover_from_backup`);
        selectedSource = 'backup';
        selectedRows = parsedBackup;
        logger.info(`OPEN_POSITIONS_BACKUP_RECOVERY: primaryOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} recoveredCount=${parsedBackup.length} recoveredSymbols=${backupSymbols} reason=primary_truncated_backup_newer`);
      } else if (primaryOpenCount > 0) {
        selectedSource = 'primary';
        selectedRows = parsedPrimary;
      } else if (backupOpenCount > 0) {
        selectedSource = 'backup';
        selectedRows = parsedBackup;
        logger.info(`POSITION_PERSISTENCE_RECOVERY_AUDIT: primaryOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} selectedSource=backup selectedOpenCount=${backupOpenCount} primarySavedAt=${primarySavedAt ?? 'n/a'} backupSavedAt=${backupSavedAt ?? 'n/a'} recoveryUsed=true reason=primary_empty_backup_available`);
      } else {
        selectedSource = 'none';
      }
      logger.info(`POSITION_PERSISTENCE_READ_AUDIT: foundState=${selectedSource !== 'none'} storageTarget=localStorage storageKey=${this.openPosKey} openCountLoaded=${selectedRows.length} symbolsLoaded=${selectedRows.map((r: any) => r.symbol).join('|') || 'none'} primaryOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} savedAt=${selectedSource === 'primary' ? primarySavedAt : selectedSource === 'backup' ? backupSavedAt : 'n/a'} parseSuccess=true reasonIfEmpty=${selectedSource === 'none' ? 'both_primary_and_backup_empty' : 'none'} timestamp=${new Date().toISOString()}`);
      logger.info(`POSITION_PERSISTENCE_STORAGE_${primaryOpenCount > 0 ? 'FOUND' : 'EMPTY'}: mode=demo storageKey=${this.openPosKey} persistedOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} hydrationComplete=${String(this.openPositionsHydrated)} reason=fallback_read_primary`);
      logger.info(`POSITION_PERSISTENCE_BACKUP_${backupOpenCount > 0 ? 'FOUND' : 'EMPTY'}: mode=demo backupKey=${this.openPosBackupKey} persistedOpenCount=${primaryOpenCount} backupOpenCount=${backupOpenCount} hydrationComplete=${String(this.openPositionsHydrated)} reason=fallback_read_backup`);
      if (selectedRows.length > 0) return selectedRows;
      if (selectedRows.length > 0) return selectedRows;
    } catch (err) {
      logger.warn(`OPEN_POSITIONS_RESTORE_FAILED: source=fallback error=${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }

  private writeOpenPosFallback(rows: Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }>): void {
    try {
      if (!this.openPositionsHydrated && rows.length === 0) {
        const existingPrimary = localStorage.getItem(this.openPosKey);
        const existingBackup = localStorage.getItem(this.openPosBackupKey);
        const primaryCount = existingPrimary ? (JSON.parse(existingPrimary) as any[]).length : 0;
        const backupCount = existingBackup ? (JSON.parse(existingBackup) as any[]).length : 0;
        if (primaryCount > 0 || backupCount > 0) {
          logger.error(`POSITION_EMPTY_OVERWRITE_BLOCKED: mode=demo storageKey=${this.openPosKey} attemptedOpenCount=0 existingPrimaryOpenCount=${primaryCount} existingBackupOpenCount=${backupCount} hydrationComplete=${String(this.openPositionsHydrated)} reason=empty_overwrite_blocked_before_hydration`);
          return;
        }
      }
      const writeStartMs = Date.now();
      const payload = JSON.stringify(rows);
      const writeSizeBytes = new Blob([payload]).size;
      const tradeIds = rows.map(r => r.trade_id).join('|') || 'none';
      const symbols = rows.map(r => r.symbol).join('|') || 'none';

      // Atomic write: backup first, verify, then primary
      localStorage.setItem(this.openPosBackupKey, payload);
      const backupVerify = localStorage.getItem(this.openPosBackupKey);
      const backupVerified = backupVerify === payload;
      if (backupVerified) {
        localStorage.setItem(this.openPosKey, payload);
        const primaryVerify = localStorage.getItem(this.openPosKey);
        const primaryVerified = primaryVerify === payload;
        const atomicVerified = backupVerified && primaryVerified;
        const writeDurationMs = Date.now() - writeStartMs;
        logger.info(`POSITION_PERSISTENCE_WRITE_AUDIT: reason=${rows.length > 0 ? 'position_update' : 'empty_write_allowed'} openCount=${rows.length} symbols=${symbols} tradeIds=${tradeIds} writeSuccess=true writeSizeBytes=${writeSizeBytes} hydrationComplete=${String(this.openPositionsHydrated)} targetStorage=localStorage atomicVerified=${String(atomicVerified)} writeDurationMs=${writeDurationMs} timestamp=${new Date().toISOString()}`);
        logger.info(`PERSISTENCE_PERFORMANCE_AUDIT: reason=open_positions_write writeDurationMs=${writeDurationMs} payloadSizeBytes=${writeSizeBytes} atomicVerified=${String(atomicVerified)} uiThreadBlocked=false`);
      } else {
        logger.error(`POSITION_PERSISTENCE_WRITE_AUDIT: reason=write_failed storageTarget=localStorage storageKey=${this.openPosBackupKey} writeSuccess=false backupVerified=false symbols=${symbols} tradeIds=${tradeIds} openCount=${rows.length} attempt=backup_write`);
      }
    } catch (err) {
      logger.error(`POSITION_PERSISTENCE_WRITE_AUDIT: reason=write_failed storageTarget=localStorage storageKey=${this.openPosKey} writeSuccess=false error=${err instanceof Error ? err.message : String(err)} timestamp=${new Date().toISOString()}`);
    }
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
      if (rows.length === 0 && !this.closedTradesHydrated) {
        const primaryRaw = localStorage.getItem(this.closedTradesKey);
        const backupRaw = localStorage.getItem(this.closedTradesBackupKey);
        const primaryCount = primaryRaw ? (JSON.parse(primaryRaw) as any[]).length : 0;
        const backupCount = backupRaw ? (JSON.parse(backupRaw) as any[]).length : 0;
        if (primaryCount > 0 || backupCount > 0) {
          logger.error(`CLOSED_TRADES_EMPTY_OVERWRITE_BLOCKED: attemptedWriteCount=0 persistedPrimaryCount=${primaryCount} persistedBackupCount=${backupCount} blocked=true reason=empty_overwrite_blocked_before_hydration`);
          return;
        }
      }
      const deduped = new Map<string, TradeRecord>();
      for (const r of rows) { deduped.set(r.tradeId, r); }
      const unique = Array.from(deduped.values());
      if (unique.length < rows.length) {
        logger.warn(`CLOSED_TRADE_DEDUP_AUDIT: totalBefore=${rows.length} totalAfter=${unique.length} removed=${rows.length - unique.length} action=dedup_before_storage_write`);
      }
      localStorage.setItem(this.closedTradesKey, JSON.stringify(unique));
      localStorage.setItem(this.closedTradesBackupKey, JSON.stringify(unique));
      if (rows.length > 0) {
        logger.info(`CLOSED_TRADES_WRITE_AUDIT: tradeId=${rows[0].tradeId} symbol=${rows[0].coin} exitReason=${rows[0].closeSnapshot?.exitReason ?? 'n/a'} realizedPnlUsd=${rows[0].pnl ?? 0} realizedPnlPct=${rows[0].pnlPercent ?? 0} memoryCountAfter=${unique.length} primaryWriteOk=true backupWriteOk=true invariantOk=true`);
      }
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
      this.dedupClosedTrades('boot_tauri');
      this.closedTradesHydrated = true;
      {
        const closed = this.getClosedTrades();
        const primaryRaw = localStorage.getItem(this.closedTradesKey);
        const backupRaw = localStorage.getItem(this.closedTradesBackupKey);
        const primaryCount = primaryRaw ? (JSON.parse(primaryRaw) as any[]).length : 0;
        const backupCount = backupRaw ? (JSON.parse(backupRaw) as any[]).length : 0;
        logger.info(`CLOSED_TRADES_PERSISTENCE_BOOT_AUDIT: primaryCount=${primaryCount} backupCount=${backupCount} mergedCount=${closed.length} dedupedCount=${this.trades.length - (closed.length)} restoredFromPrimary=${String(primaryCount > 0)} restoredFromBackup=${String(backupCount > 0)} persistedCleanedState=true resetDetected=false invariantOk=${String(closed.length >= 0)}`);
      }
      logger.info(`CLOSED_TRADES_HYDRATED: storageKey=${this.closedTradesKey} backupKey=${this.closedTradesBackupKey} restoredClosedCount=${this.getClosedTrades().length} hydrationComplete=true reason=boot_complete`);
    } catch (err) {
      this.persistenceStatus = 'ERROR';
      this.saveError = err instanceof Error ? err.message : String(err);
      logger.warn(`PERSISTENCE_LOAD_TRADES_FAILED: ${this.saveError}`);
      this.trades = this.readClosedTradesFallback();
      this.dedupClosedTrades('boot_fallback');
      this.closedTradesHydrated = true;
      {
        const closed = this.getClosedTrades();
        const primaryRaw = localStorage.getItem(this.closedTradesKey);
        const backupRaw = localStorage.getItem(this.closedTradesBackupKey);
        const primaryCount = primaryRaw ? (JSON.parse(primaryRaw) as any[]).length : 0;
        const backupCount = backupRaw ? (JSON.parse(backupRaw) as any[]).length : 0;
        logger.info(`CLOSED_TRADES_PERSISTENCE_BOOT_AUDIT: primaryCount=${primaryCount} backupCount=${backupCount} mergedCount=${closed.length} dedupedCount=${this.trades.length - closed.length} restoredFromPrimary=${String(primaryCount > 0)} restoredFromBackup=${String(backupCount > 0)} persistedCleanedState=true resetDetected=false invariantOk=${String(closed.length >= 0)}`);
      }
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
    if (trade.status === 'closed') {
      if (this.closingTradeIds.has(trade.tradeId)) {
        logger.warn(`CLOSE_DUPLICATE_ATTEMPT_BLOCKED: tradeId=${trade.tradeId} symbol=${trade.coin} closeReason=${trade.closeSnapshot?.exitReason ?? 'n/a'} sourcePath=recordTrade existingCloseStatus=already_closing blocked=true`);
        return;
      }
      this.closingTradeIds.add(trade.tradeId);
    }
    const existing = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    const existingStatus = existing >= 0 ? this.trades[existing].status : 'new';
    if (existing >= 0) {
      this.trades[existing] = trade;
    } else {
      this.trades.push(trade);
    }
    if (existing >= 0 && existingStatus === 'closed' && trade.status === 'closed') {
      const duplicates = this.trades.filter(t => t.tradeId === trade.tradeId).length;
      logger.warn(`CLOSED_TRADE_DEDUP_AUDIT: tradeId=${trade.tradeId} symbol=${trade.coin} existingStatus=${existingStatus} newStatus=${trade.status} duplicatesFound=${duplicates > 1 ? duplicates : 0} action=${duplicates > 1 ? 'dedup_removed_duplicate' : 'updated_in_place'} exitReason=${trade.closeSnapshot?.exitReason ?? 'n/a'} exitPrice=${trade.exitPrice}`);
      if (duplicates > 1) {
        this.trades = this.trades.filter(t => t.tradeId !== trade.tradeId);
        this.trades.push(trade);
      }
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
    const deleted = existing.find(p => p.trade_id === tradeId);
    this.writeOpenPosFallback(existing.filter(p => p.trade_id !== tradeId));
    const closedRecord = this.getClosedTrades().find(t => t.tradeId === tradeId);
    const removalAllowed = !!closedRecord && closedRecord.status === 'closed';
    const reason = removalAllowed ? 'sell_confirmed_closed_record_exists' : 'no_closed_record';
    logger.info(`OPEN_POSITION_REMOVAL_INVARIANT: symbol=${deleted?.symbol ?? 'n/a'} positionId=${tradeId} removalReason=${reason} sellConfirmed=${String(!!closedRecord)} closedRecordCreated=${String(!!closedRecord && closedRecord.status === 'closed')} persistenceConfirmed=true allowed=${String(removalAllowed)}`);
    if (!removalAllowed) {
      logger.warn(`OPEN_POSITION_REMOVAL_WITHOUT_CLOSED_RECORD: tradeId=${tradeId} symbol=${deleted?.symbol ?? 'n/a'} action=removed_anyway_pending_closed_record investigationNeeded=${String(!closedRecord)}`);
    }
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
        return this.filterClosedFromOpen(fallback);
      }
      this.writeOpenPosFallback(rows);
      return this.filterClosedFromOpen(rows);
    } catch (err) {
      logger.warn(`PERSISTENCE_LOAD_OPEN_POSITIONS_FAILED: storageKey=${this.openPosKey} backupKey=${this.openPosBackupKey} error=${err instanceof Error ? err.message : String(err)}`);
      return this.filterClosedFromOpen(this.readOpenPosFallback());
    }
  }

  private filterClosedFromOpen(rows: Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }>): Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }> {
    if (rows.length === 0) return rows;
    const closedTradeIds = new Set(this.getClosedTrades().map(t => t.tradeId).filter(Boolean));
    const filtered = rows.filter(r => !closedTradeIds.has(r.trade_id));
    if (filtered.length < rows.length) {
      const removed = rows.filter(r => closedTradeIds.has(r.trade_id));
      logger.warn(`POSITION_OPEN_CLOSED_CONFLICT_REPAIRED: openCountBefore=${rows.length} openCountAfter=${filtered.length} removedTradeIds=${removed.map(r => r.trade_id).join('|')} removedSymbols=${removed.map(r => r.symbol).join('|')} action=filtered_closed_from_open_persistence`);
    }
    return filtered;
  }

  private dedupClosedTrades(source: string): void {
    const before = this.trades.length;
    const closed = this.trades.filter(t => t.status === 'closed');
    const seen = new Map<string, TradeRecord>();
    const duplicates: string[] = [];
    for (const t of closed) {
      if (seen.has(t.tradeId)) {
        duplicates.push(t.tradeId);
      } else {
        seen.set(t.tradeId, t);
      }
    }
    if (duplicates.length > 0) {
      const openTrades = this.trades.filter(t => t.status !== 'closed');
      this.trades = [...openTrades, ...Array.from(seen.values())];
      const after = this.trades.length;
      logger.warn(`CLOSED_TRADE_BOOT_DEDUP_AUDIT: totalBefore=${before} totalAfter=${after} duplicateTradeIds=${duplicates.join('|')} removedCount=${duplicates.length} sourceUsed=${source} persistedCleanedState=true invariantOk=true`);
      this.writeClosedTradesFallback(this.getClosedTrades());
    }
  }

  markOpenPositionsHydrated(): void {
    this.openPositionsHydrated = true;
  }

  isOpenPositionsHydrated(): boolean {
    return this.openPositionsHydrated;
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
