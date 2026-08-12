import type { Position, PositionSummary, TradingMode, CloseSnapshot } from '../types';
import { logger } from '../../utils/logger';

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private listeners: Set<(positions: Position[], reason: string, symbol?: string) => void> = new Set();
  private lastUpdateLogAt: Map<string, number> = new Map();

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  subscribe(listener: (positions: Position[], reason: string, symbol?: string) => void): () => void {
    this.listeners.add(listener);
    listener(this.getOpenPositions(), 'initial');
    return () => this.listeners.delete(listener);
  }

  getPositionBySymbol(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  hasOpenPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  addPosition(symbol: string, position: Position): void {
    this.positions.set(symbol, position);
    const bs = position.buySnapshot as any;
    logger.info(
      `POSITION_OWNER_PERSISTENCE_AUDIT: ` +
      `symbol=${symbol} ` +
      `positionId=${position.tradeId ?? bs?.tradeId ?? 'unknown'} ` +
      `stage=position_manager_add ` +
      `candidateSource=${bs?.candidateSource ?? 'unknown'} ` +
      `ownerType=${bs?.ownerType ?? position.ownerType ?? 'unknown'} ` +
      `ownerName=${bs?.ownerName ?? (position as any).ownerName ?? 'unknown'} ` +
      `scannerModule=${bs?.scannerModule ?? 'unknown'} ` +
      `selectedBy=${bs?.selectedBy ?? 'unknown'} ` +
      `executedBy=${bs?.executedBy ?? 'unknown'} ` +
      `source=${bs?.source ?? 'unknown'} ` +
      `strategySource=${bs?.strategySource ?? 'unknown'} ` +
      `executionSource=${bs?.executionSource ?? 'unknown'} ` +
      `finalExecutionStrategy=${bs?.finalExecutionStrategy ?? bs?.selectedStrategy ?? 'unknown'} ` +
      `entryRule=${bs?.entryRule ?? bs?.settingsSnapshot?.entryRule ?? 'unknown'}`
    );
    logger.info(`POSITION_MANAGER_ADD: ${symbol} mode=${position.mode} qty=${position.quantity} price=${position.avgEntryPrice}`);
    this.emit('add', symbol);
  }

  /**
   * Idempotent accounting boundary for cumulative exchange BUY updates.
   * A repeated update for the same clientOrderId is a no-op; a larger cumulative
   * executed quantity updates the one canonical position instead of creating a lot.
   */
  upsertExecutionPosition(symbol: string, incoming: Position): { position: Position; created: boolean; changed: boolean } {
    const existing = this.positions.get(symbol);
    if (!existing) {
      this.addPosition(symbol, incoming);
      return { position: incoming, created: true, changed: true };
    }
    if (!incoming.clientOrderId || existing.clientOrderId !== incoming.clientOrderId) {
      throw new Error(`POSITION_EXECUTION_IDENTITY_CONFLICT:${symbol}`);
    }
    const quantityTolerance = Math.max(1e-12, Math.max(existing.quantity, incoming.quantity) * 1e-10);
    if (incoming.quantity + quantityTolerance < existing.quantity) {
      throw new Error(`NON_MONOTONIC_EXECUTED_QUANTITY:${symbol}`);
    }
    const qtyChanged = Math.abs(incoming.quantity - existing.quantity) > quantityTolerance;
    const priceTolerance = Math.max(1e-12, Math.max(existing.avgEntryPrice, incoming.avgEntryPrice) * 1e-10);
    const priceChanged = Math.abs(incoming.avgEntryPrice - existing.avgEntryPrice) > priceTolerance;
    if (!qtyChanged && !priceChanged && existing.fillState === incoming.fillState) {
      logger.info(`LIVE_ORDER_DUPLICATE_EVENT_AUDIT tradeId=${incoming.tradeId ?? 'unknown'} symbol=${symbol} clientOrderId=${incoming.clientOrderId} exchangeOrderId=${incoming.exchangeOrderId ?? 'unknown'} executedQty=${incoming.quantity} duplicateEventDetected=true idempotentUpdateApplied=true invariantOk=true`);
      return { position: existing, created: false, changed: false };
    }
    Object.assign(existing, incoming, { openedAt: existing.openedAt });
    logger.info(`LIVE_ORDER_EXECUTION_UPDATE_AUDIT tradeId=${existing.tradeId ?? 'unknown'} symbol=${symbol} clientOrderId=${existing.clientOrderId} exchangeOrderId=${existing.exchangeOrderId ?? 'unknown'} executedQty=${existing.quantity} remainingQty=${existing.remainingQuantity ?? 0} exchangeStatus=${existing.fillState} duplicateEventDetected=false idempotentUpdateApplied=true invariantOk=true`);
    this.emit('execution_upsert', symbol);
    return { position: existing, created: false, changed: true };
  }

  updatePosition(symbol: string, patch: Partial<Position>): void {
    const existing = this.positions.get(symbol);
    if (!existing) return;
    Object.assign(existing, patch);
    const now = Date.now();
    const previousLogAt = this.lastUpdateLogAt.get(symbol) ?? 0;
    if (now - previousLogAt > 30000) {
      this.lastUpdateLogAt.set(symbol, now);
      logger.info(`POSITION_MANAGER_UPDATE: ${symbol} rateLimited=true`);
    }
    this.emit('update', symbol);
  }

  closePosition(symbol: string, closeSnapshot: CloseSnapshot): void {
    const pos = this.positions.get(symbol);
    if (!pos) {
      logger.warn(`POSITION_MANAGER_CLOSE: ${symbol} not found`);
      return;
    }
    logger.info(`POSITION_MANAGER_CLOSE: ${symbol} pnl=${closeSnapshot.pnlUsd.toFixed(2)} reason=${closeSnapshot.exitReason}`);
    this.positions.delete(symbol);
    this.lastUpdateLogAt.delete(symbol);
    this.emit('close', symbol);
  }

  removePosition(symbol: string): void {
    this.positions.delete(symbol);
    this.lastUpdateLogAt.delete(symbol);
    logger.info(`POSITION_MANAGER_CLOSE: ${symbol} removed`);
    this.emit('remove', symbol);
  }

  getExposureSummary(): PositionSummary {
    const positions = this.getOpenPositions();
    const byMode: Partial<Record<TradingMode, number>> = {};
    const byRiskGroup: Record<string, number> = {};
    const bySymbol: string[] = [];
    let totalExposure = 0;
    let unrealizedPnl = 0;
    let stalePriceCount = 0;

    for (const p of positions) {
      bySymbol.push(p.coin);
      byMode[p.mode] = (byMode[p.mode] ?? 0) + 1;
      const rg = p.buySnapshot?.riskGroup ?? 'unknown';
      byRiskGroup[rg] = (byRiskGroup[rg] ?? 0) + 1;
      totalExposure += p.avgEntryPrice * p.quantity;
      unrealizedPnl += p.unrealizedPnlPercent * p.avgEntryPrice * p.quantity / 100;
      if (p.currentPrice <= 0) stalePriceCount++;
    }

    return {
      totalOpen: positions.length,
      byMode,
      byRiskGroup,
      bySymbol,
      totalExposure,
      unrealizedPnl,
      stalePriceCount,
    };
  }

  getPositionSummary(): PositionSummary {
    return this.getExposureSummary();
  }

  clearAllPositions(force = false): void {
    if (!force && this.positions.size > 0) {
      logger.warn(`OPEN_POSITIONS_CLEAR_BLOCKED_HAS_ACTIVE_POSITIONS: count=${this.positions.size}`);
      return;
    }
    const count = this.positions.size;
    this.positions.clear();
    this.lastUpdateLogAt.clear();
    logger.info(`POSITION_MANAGER_CLEAR_ALL: ${count} positions cleared`);
    this.emit('clear');
  }

  restorePositions(positions: Position[]): void {
    logger.info(`POSITION_RESTORE_START: ${positions.length} positions`);
    for (const p of positions) {
      if (p.coin) {
        this.positions.set(p.coin, p);
        logger.info(
          `POSITION_RESTORED_AUDIT: ` +
          `symbol=${p.coin} ` +
          `positionId=${p.tradeId} ` +
          `mode=${p.mode} ` +
          `entryPrice=${p.avgEntryPrice} ` +
          `qty=${p.quantity} ` +
          `entryTime=${new Date(p.openedAt ?? 0).toISOString()} ` +
          `source=PositionManager/restore ` +
          `logCategory=INFO`
        );
      }
    }
    logger.info(`POSITION_RESTORE_SUCCESS: ${this.positions.size} positions restored`);
    this.emit('restore');
  }

  private emit(reason: string, symbol?: string): void {
    const positions = this.getOpenPositions();
    for (const listener of this.listeners) {
      try {
        listener(positions, reason, symbol);
      } catch (err) {
        logger.warn(`POSITION_MANAGER_SUBSCRIBER_FAILED: reason=${reason} symbol=${symbol ?? 'none'} error=${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
