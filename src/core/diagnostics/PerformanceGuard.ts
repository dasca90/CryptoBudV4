import { logger } from '../../utils/logger';

export type PerfSeverity = 'INFO' | 'WARN' | 'ERROR';

export interface PerformanceWarning {
  code: string;
  severity: PerfSeverity;
  message: string;
  module: string;
  createdAt: string;
  recommendation: string;
}

export const PERFORMANCE_WARNING_CODES = {
  SCANNER_SLOW: 'PERF_SCANNER_SLOW',
  SCALPER_SLOW: 'PERF_SCALPER_SLOW',
  LOG_COUNT_HIGH: 'PERF_LOG_COUNT_HIGH',
  CHART_POINTS_HIGH: 'PERF_CHART_POINTS_HIGH',
  SNAPSHOT_HISTORY_HIGH: 'PERF_SNAPSHOT_HISTORY_HIGH',
  MARKET_CACHE_HIGH: 'PERF_MARKET_CACHE_HIGH',
  STALE_LOCKS: 'PERF_STALE_LOCKS',
  DUPLICATE_SUBSCRIPTION: 'PERF_DUPLICATE_SUBSCRIPTION',
  PERSISTENCE_SLOW: 'PERF_PERSISTENCE_SLOW',
} as const;

export class PerformanceGuard {
  private warnings: PerformanceWarning[] = [];
  private maxWarnings = 200;
  private maxChartPointsPerSymbol = 200;
  private maxEquityHistory = 500;
  private maxScannerSnapshots = 20;
  private maxScalperSnapshots = 20;
  private scannerSlowThresholdMs = 5000;
  private scalperSlowThresholdMs = 1000;
  private logWarningThreshold = 1500;
  private cacheWarningThreshold = 1000;

  addWarning(code: string, severity: PerfSeverity, message: string, module: string, recommendation: string): void {
    const warning: PerformanceWarning = {
      code, severity, message, module,
      createdAt: new Date().toISOString(),
      recommendation,
    };
    this.warnings.push(warning);
    if (this.warnings.length > this.maxWarnings) this.warnings.shift();
    logger.warn(`[${code}] ${message}`);
  }

  getWarnings(): PerformanceWarning[] { return [...this.warnings]; }
  getRecentWarnings(n = 20): PerformanceWarning[] { return this.warnings.slice(-n); }

  checkScannerDuration(durationMs: number): void {
    if (durationMs > this.scannerSlowThresholdMs) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.SCANNER_SLOW, 'WARN',
        `Scanner scan took ${durationMs.toFixed(0)}ms (threshold: ${this.scannerSlowThresholdMs}ms)`,
        'MarketScanner',
        'Reduce universe size or increase scan interval'
      );
    }
  }

  checkScalperTickDuration(durationMs: number): void {
    if (durationMs > this.scalperSlowThresholdMs) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.SCALPER_SLOW, 'WARN',
        `Scalper tick took ${durationMs.toFixed(0)}ms (threshold: ${this.scalperSlowThresholdMs}ms)`,
        'ScalperRuntime',
        'Reduce watchlist size or increase tick interval'
      );
    }
  }

  checkLogCount(currentCount: number): void {
    if (currentCount > this.logWarningThreshold) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.LOG_COUNT_HIGH, 'WARN',
        `Log count: ${currentCount} (threshold: ${this.logWarningThreshold})`,
        'Logger',
        'Reduce verbose logging or clear logs'
      );
    }
  }

  checkChartPoints(symbolCount: number, pointsPerSymbol: number): void {
    if (pointsPerSymbol > this.maxChartPointsPerSymbol) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.CHART_POINTS_HIGH, 'INFO',
        `Chart points per symbol: ${pointsPerSymbol} (cap: ${this.maxChartPointsPerSymbol})`,
        'UIStore',
        'Chart data is correctly capped'
      );
    }
  }

  checkSnapshotCount(type: 'scanner' | 'scalper', count: number): void {
    const cap = type === 'scanner' ? this.maxScannerSnapshots : this.maxScalperSnapshots;
    if (count > cap) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.SNAPSHOT_HISTORY_HIGH, 'INFO',
        `${type} snapshot history: ${count} (cap: ${cap})`,
        type === 'scanner' ? 'MarketScanner' : 'ScalperRuntime',
        `Snapshot history correctly capped at ${cap}`
      );
    }
  }

  checkMarketCacheSize(size: number): void {
    if (size > this.cacheWarningThreshold) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.MARKET_CACHE_HIGH, 'WARN',
        `Market data cache size: ${size} (threshold: ${this.cacheWarningThreshold})`,
        'MarketDataFeed',
        'Market data cache may be growing unbounded'
      );
    }
  }

  checkPersistenceDuration(durationMs: number): void {
    if (durationMs > 1000) {
      this.addWarning(
        PERFORMANCE_WARNING_CODES.PERSISTENCE_SLOW, 'WARN',
        `Persistence save took ${durationMs.toFixed(0)}ms`,
        'Journal',
        'Check SQLite performance or reduce save frequency'
      );
    }
  }
}
