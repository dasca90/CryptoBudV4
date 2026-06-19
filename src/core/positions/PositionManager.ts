import type { Position, PositionSummary, TradingMode, CloseSnapshot } from '../types';
import { logger } from '../../utils/logger';

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private listeners: Set<(positions: Position[], reason: string, symbol?: string) => void> = new Set();

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
    logger.info(`POSITION_MANAGER_ADD: ${symbol} mode=${position.mode} qty=${position.quantity} price=${position.avgEntryPrice}`);
    this.emit('add', symbol);
  }

  updatePosition(symbol: string, patch: Partial<Position>): void {
    const existing = this.positions.get(symbol);
    if (!existing) return;
    Object.assign(existing, patch);
    logger.info(`POSITION_MANAGER_UPDATE: ${symbol}`);
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
    this.emit('close', symbol);
  }

  removePosition(symbol: string): void {
    this.positions.delete(symbol);
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
