import { logger, type LoggerStats } from '../../utils/logger';
import type { PositionManager } from '../positions/PositionManager';
import type { OrderLockManager } from '../orders/OrderLockManager';

export type HealthStatus = 'GOOD' | 'WARNING' | 'BAD';

export interface DiagnosticsSnapshot {
  createdAt: string;
  uptimeMs: number;
  logCount: number;
  warningCount: number;
  errorCount: number;
  activeIntervals: number;
  activeSubscriptions: number;
  activeOrderLocks: number;
  openPositions: number;
  scannerSnapshotCount: number;
  scalperSnapshotCount: number;
  chartPointCount: number;
  marketDataCacheSize: number;
  memoryEstimateMb: number | null;
  lastScannerDurationMs: number | null;
  lastScalperTickDurationMs: number | null;
  lastPersistenceSaveMs: number | null;
  healthStatus: HealthStatus;
  warnings: string[];
  recommendations: string[];
}

export class DiagnosticsEngine {
  private startedAt = Date.now();
  private positionManager: PositionManager | null = null;
  private orderLockManager: OrderLockManager | null = null;
  private warningCount = 0;
  private errorCount = 0;
  private warnings: string[] = [];
  private maxWarnings = 200;
  private lastScannerDurationMs: number | null = null;
  private lastScalperTickDurationMs: number | null = null;
  private lastPersistenceSaveMs: number | null = null;

  constructor() {
    // Subscribe to logger to count warnings/errors
    logger.subscribe((entry) => {
      if (entry.level === 'WARN') this.warningCount++;
      if (entry.level === 'ERROR') this.errorCount++;
    });
  }

  setPositionManager(pm: PositionManager): void { this.positionManager = pm; }
  setOrderLockManager(olm: OrderLockManager): void { this.orderLockManager = olm; }
  setLastScannerDuration(ms: number): void { this.lastScannerDurationMs = ms; }
  setLastScalperTickDuration(ms: number): void { this.lastScalperTickDurationMs = ms; }
  setLastPersistenceSaveMs(ms: number): void { this.lastPersistenceSaveMs = ms; }

  addWarning(warning: string): void {
    this.warnings.push(warning);
    if (this.warnings.length > this.maxWarnings) this.warnings.shift();
  }

  getWarnings(): string[] { return [...this.warnings]; }

  snapshot(extras?: Partial<DiagnosticsSnapshot>): DiagnosticsSnapshot {
    const stats = logger.getStats();
    const now = Date.now();
    const uptimeMs = now - this.startedAt;

    const openPositions = this.positionManager?.getOpenPositions().length ?? 0;
    const activeOrderLocks = this.orderLockManager?.getActiveLocks().length ?? 0;

    const diagWarnings: string[] = [];
    const recommendations: string[] = [];

    if (stats.currentLogCount > 1500) {
      diagWarnings.push(`Log count high: ${stats.currentLogCount}/${stats.maxLogCount}`);
      recommendations.push('Consider clearing logs or reducing verbose logging');
    }

    if (openPositions > 5) {
      diagWarnings.push(`Open positions: ${openPositions}`);
    }

    if (stats.totalSuppressed > 0) {
      diagWarnings.push(`Suppressed ${stats.totalSuppressed} duplicate log messages`);
    }

    let healthStatus: HealthStatus = 'GOOD';
    if (diagWarnings.length > 0) healthStatus = 'WARNING';
    if (this.errorCount > 10 || stats.currentLogCount >= stats.maxLogCount) healthStatus = 'BAD';

    return {
      createdAt: new Date().toISOString(),
      uptimeMs,
      logCount: stats.currentLogCount,
      warningCount: this.warningCount,
      errorCount: this.errorCount,
      activeIntervals: extras?.activeIntervals ?? 0,
      activeSubscriptions: extras?.activeSubscriptions ?? 0,
      activeOrderLocks,
      openPositions,
      scannerSnapshotCount: extras?.scannerSnapshotCount ?? 0,
      scalperSnapshotCount: extras?.scalperSnapshotCount ?? 0,
      chartPointCount: extras?.chartPointCount ?? 0,
      marketDataCacheSize: extras?.marketDataCacheSize ?? 0,
      memoryEstimateMb: null,
      lastScannerDurationMs: this.lastScannerDurationMs,
      lastScalperTickDurationMs: this.lastScalperTickDurationMs,
      lastPersistenceSaveMs: this.lastPersistenceSaveMs,
      healthStatus,
      warnings: diagWarnings,
      recommendations,
    };
  }
}
