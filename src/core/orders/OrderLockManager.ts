import type { OrderLock, LockResult, OrderLockStatus, OrderSide, TradingMode, ExecutionAdapterType, OrderLockDiagnostics } from '../types';
import { logger } from '../../utils/logger';

let _lockIdCounter = 0;
function nextLockId(): string {
  return `lock_${Date.now()}_${++_lockIdCounter}`;
}

export function getDefaultLockTTL(side: OrderSide, mode: TradingMode): number {
  if (mode === 'SCALPER') return side === 'BUY' ? 10000 : 10000;
  return 30000;
}

export class OrderLockManager {
  private locks: Map<string, OrderLock> = new Map();

  acquireLock(input: {
    symbol: string;
    side: OrderSide;
    mode: TradingMode;
    adapter: ExecutionAdapterType;
    reason: string;
    ttl?: number;
    ownerId?: string;
    tradeId?: string;
  }): LockResult {
    const now = Date.now();

    // Check existing active locks for same symbol+side
    const existing = this.findActiveLock(input.symbol, input.side);
    if (existing) {
      const reason = existing.side === 'BUY' ? 'ORDER_LOCK_DUPLICATE_BUY' : 'ORDER_LOCK_DUPLICATE_SELL';
      logger.warn(`ORDER_LOCK_BLOCKED: ${input.symbol} ${input.side} — ${reason}`);
      return {
        acquired: false,
        lock: null,
        reason,
        existingLock: existing,
      };
    }

    const ttl = input.ttl ?? getDefaultLockTTL(input.side, input.mode);
    const lock: OrderLock = {
      lockId: nextLockId(),
      symbol: input.symbol,
      side: input.side,
      mode: input.mode,
      adapter: input.adapter,
      reason: input.reason,
      createdAt: now,
      expiresAt: now + ttl,
      status: 'ACTIVE',
      ownerId: input.ownerId,
      tradeId: input.tradeId,
    };

    this.locks.set(lock.lockId, lock);
    logger.info(`ORDER_LOCK_ACQUIRED: ${input.symbol} ${input.side} (${input.mode}) lockId=${lock.lockId} ttl=${ttl}ms`);

    return {
      acquired: true,
      lock,
      reason: 'ORDER_LOCK_ACQUIRED',
      existingLock: null,
    };
  }

  releaseLock(lockId: string, reason: string): void {
    const lock = this.locks.get(lockId);
    if (!lock) return;
    lock.status = 'RELEASED';
    logger.info(`ORDER_LOCK_RELEASED: ${lock.symbol} ${lock.side} lockId=${lockId} reason=${reason}`);
    this.locks.delete(lockId);
  }

  releaseLocksForSymbol(symbol: string): void {
    for (const [id, lock] of this.locks) {
      if (lock.symbol === symbol && lock.status === 'ACTIVE') {
        lock.status = 'RELEASED';
        this.locks.delete(id);
      }
    }
    logger.info(`ORDER_LOCK_RELEASED: all locks for ${symbol}`);
  }

  hasActiveLock(symbol: string, side?: OrderSide): boolean {
    for (const lock of this.locks.values()) {
      if (lock.status !== 'ACTIVE') continue;
      if (lock.symbol !== symbol) continue;
      if (side !== undefined && lock.side !== side) continue;
      if (Date.now() > lock.expiresAt) continue;
      return true;
    }
    return false;
  }

  private findActiveLock(symbol: string, side: OrderSide): OrderLock | undefined {
    for (const lock of this.locks.values()) {
      if (lock.status !== 'ACTIVE') continue;
      if (lock.symbol !== symbol) continue;
      if (lock.side !== side) continue;
      if (Date.now() > lock.expiresAt) continue;
      return lock;
    }
    return undefined;
  }

  cleanupStaleLocks(now: number = Date.now()): void {
    let staleCleaned = 0;
    let expiredCleaned = 0;
    for (const [id, lock] of this.locks) {
      if (lock.status !== 'ACTIVE') continue;
      if (now > lock.expiresAt) {
        lock.status = 'EXPIRED';
        this.locks.delete(id);
        if (lock.expiresAt < now - 60000) {
          expiredCleaned++;
        } else {
          staleCleaned++;
        }
      }
    }

    if (staleCleaned > 0 || expiredCleaned > 0) {
      logger.info(`ORDER_LOCK_STALE_CLEANED: ${staleCleaned} stale, ${expiredCleaned} expired`);
      logger.info(`ORDER_LOCK_CLEANUP_SUMMARY: ${this.locks.size} active remaining`);
    }
  }

  getActiveLocks(): OrderLock[] {
    const now = Date.now();
    return Array.from(this.locks.values()).filter(l => l.status === 'ACTIVE' && now <= l.expiresAt);
  }

  getDiagnostics(): OrderLockDiagnostics {
    const active = this.getActiveLocks();
    const bySymbol: Record<string, number> = {};
    const byMode: Record<TradingMode, number> = { AUTO: 0, MANUAL: 0, SCALPER: 0 };

    for (const l of active) {
      bySymbol[l.symbol] = (bySymbol[l.symbol] ?? 0) + 1;
      byMode[l.mode] = (byMode[l.mode] ?? 0) + 1;
    }

    return {
      activeLocks: active.length,
      bySymbol,
      byMode,
      staleCleaned: 0,
      expiredCleaned: 0,
    };
  }

  releaseAllLocks(): void {
    const count = this.locks.size;
    for (const [id] of this.locks) {
      this.locks.delete(id);
    }
    logger.info(`ORDER_LOCKS_RELEASE_ALL: ${count} locks released`);
  }

  clearExpiredLocks(): void {
    let count = 0;
    for (const [id, lock] of this.locks) {
      if (lock.status !== 'ACTIVE' || Date.now() > lock.expiresAt + 60000) {
        this.locks.delete(id);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`ORDER_LOCKS_CLEANED_ON_STARTUP: ${count} expired locks removed`);
    }
  }
}
