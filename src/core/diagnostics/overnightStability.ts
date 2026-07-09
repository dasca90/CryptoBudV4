import { MEMORY_PRESSURE_CRITICAL_THRESHOLD } from './memoryLifecycle';

export type OvernightMemoryStatus = 'Measuring' | 'Warm-up' | 'Stable' | 'Growing' | 'Pressure';

export const OVERNIGHT_STARTUP_GRACE_MS = 60_000;
export const OVERNIGHT_GROWTH_WARMUP_MS = 2 * 60 * 60 * 1000;

export interface OvernightStabilitySnapshot {
  uptimeHours: number;
  activeTab: string;
  scannerRunning: boolean;
  autoBotsEnabled: boolean;
  openPositionsCount: number;
  closedPositionsCount: number;
  jsHeapUsed: number | null;
  visibleLogCount: number;
  internalAuditCount: number;
  airScannerMounted: boolean;
  activeIntervalsCount: number;
  activeSubscriptionsCount: number;
  memoryPressureActive: boolean;
  memoryPressureLevel?: 'normal' | 'warning' | 'critical';
  pressureReason: string;
  memoryGrowthReason: string;
  memoryGrowthWarmupActive: boolean;
  isStartupGracePeriodActive: boolean;
  lastMemoryBufferTrimAt: number | null;
  lastStartupRecoveryAt: number | null;
  lastRuntimeCleanupAt: number | null;
  lastAirScannerCleanupAt: number | null;
  memoryStatus: OvernightMemoryStatus;
  updatedAt: number;
}

const bootedAt = Date.now();
let baselineHeapUsed: number | null = null;
let latestSnapshot: OvernightStabilitySnapshot = {
  uptimeHours: 0,
  activeTab: 'trade',
  scannerRunning: false,
  autoBotsEnabled: false,
  openPositionsCount: 0,
  closedPositionsCount: 0,
  jsHeapUsed: null,
  visibleLogCount: 0,
  internalAuditCount: 0,
  airScannerMounted: false,
  activeIntervalsCount: 0,
  activeSubscriptionsCount: 0,
  memoryPressureActive: false,
  memoryPressureLevel: 'normal',
  pressureReason: 'none',
  memoryGrowthReason: 'none_detected',
  memoryGrowthWarmupActive: true,
  isStartupGracePeriodActive: true,
  lastMemoryBufferTrimAt: null,
  lastStartupRecoveryAt: null,
  lastRuntimeCleanupAt: null,
  lastAirScannerCleanupAt: null,
  memoryStatus: 'Stable',
  updatedAt: bootedAt,
};

export function getOvernightStabilityBootedAt(): number {
  return bootedAt;
}

export function classifyOvernightMemory(input: {
  jsHeapUsed: number | null;
  memoryPressureActive: boolean;
  memoryPressureLevel?: 'normal' | 'warning' | 'critical';
  isStartupGracePeriodActive?: boolean;
  memoryGrowthWarmupActive?: boolean;
  heapRatio?: number | null;
}): OvernightMemoryStatus {
  const criticalHeap = input.memoryPressureLevel === 'critical'
    || (input.heapRatio != null && input.heapRatio >= MEMORY_PRESSURE_CRITICAL_THRESHOLD);
  if (input.isStartupGracePeriodActive && !criticalHeap) return 'Measuring';
  if (input.memoryPressureActive) return 'Pressure';
  if (input.jsHeapUsed == null || baselineHeapUsed == null || baselineHeapUsed <= 0) return 'Stable';
  const growthBytes = input.jsHeapUsed - baselineHeapUsed;
  const growthRatio = input.jsHeapUsed / baselineHeapUsed;
  const growing = growthBytes > 50 * 1024 * 1024 && growthRatio > 1.15;
  if (growing && input.memoryGrowthWarmupActive) return 'Warm-up';
  return growing ? 'Growing' : 'Stable';
}

export function updateOvernightStabilitySnapshot(input: Omit<OvernightStabilitySnapshot, 'memoryStatus' | 'updatedAt'>): OvernightStabilitySnapshot {
  if (input.jsHeapUsed != null && baselineHeapUsed == null) {
    baselineHeapUsed = input.jsHeapUsed;
  }
  latestSnapshot = {
    ...input,
    memoryStatus: classifyOvernightMemory({
      jsHeapUsed: input.jsHeapUsed,
      memoryPressureActive: input.memoryPressureActive,
      memoryPressureLevel: input.memoryPressureLevel,
      isStartupGracePeriodActive: input.isStartupGracePeriodActive,
      memoryGrowthWarmupActive: input.memoryGrowthWarmupActive,
    }),
    updatedAt: Date.now(),
  };
  return latestSnapshot;
}

export function getOvernightStabilitySnapshot(): OvernightStabilitySnapshot {
  return latestSnapshot;
}

export function formatOvernightStabilityAudit(snapshot: OvernightStabilitySnapshot): string {
  return `OVERNIGHT_STABILITY_AUDIT: uptimeHours=${snapshot.uptimeHours.toFixed(2)} activeTab=${snapshot.activeTab} scannerRunning=${String(snapshot.scannerRunning)} autoBotsEnabled=${String(snapshot.autoBotsEnabled)} openPositionsCount=${snapshot.openPositionsCount} closedPositionsCount=${snapshot.closedPositionsCount} jsHeapUsed=${snapshot.jsHeapUsed ?? 'n/a'} visibleLogCount=${snapshot.visibleLogCount} internalAuditCount=${snapshot.internalAuditCount} airScannerMounted=${String(snapshot.airScannerMounted)} activeIntervalsCount=${snapshot.activeIntervalsCount} activeSubscriptionsCount=${snapshot.activeSubscriptionsCount} memoryPressureActive=${String(snapshot.memoryPressureActive)} memoryStatus=${snapshot.memoryStatus} pressureReason=${snapshot.pressureReason} memoryGrowthReason=${snapshot.memoryGrowthReason} memoryGrowthWarmupActive=${String(snapshot.memoryGrowthWarmupActive)} isStartupGracePeriodActive=${String(snapshot.isStartupGracePeriodActive)} lastMemoryBufferTrimAt=${snapshot.lastMemoryBufferTrimAt ?? 'never'} lastStartupRecoveryAt=${snapshot.lastStartupRecoveryAt ?? 'never'} lastRuntimeCleanupAt=${snapshot.lastRuntimeCleanupAt ?? 'never'} lastAirScannerCleanupAt=${snapshot.lastAirScannerCleanupAt ?? 'never'}`;
}
